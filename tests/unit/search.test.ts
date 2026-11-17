import { describe, expect, it } from "vitest";
import type {
  Chapter,
  ChapterDocument,
  Criterion,
} from "../../src/domain/chapters";
import {
  normalizeSearchQuery,
  searchChapters,
  SEARCH_MAX_MATCHES_PER_RESULT,
} from "../../src/domain/search";
import { createDefaultVerification } from "../../src/domain/verificationTypes";

function chapter(id: string, input: Partial<Chapter> = {}): Chapter {
  return {
    id,
    parentId: input.parentId ?? null,
    title: input.title ?? id,
    description: input.description ?? "",
    finalLevel: input.finalLevel ?? false,
    verification: input.verification ?? createDefaultVerification(),
    criteria: input.criteria ?? [],
    commits: input.commits ?? [],
    childIds: input.childIds ?? [],
  };
}

function document(chapters: Chapter[]): ChapterDocument {
  return {
    byId: Object.fromEntries(chapters.map((item) => [item.id, item])),
    rootIds: chapters.filter((item) => !item.parentId).map((item) => item.id),
  };
}

function criterion(id: string, text: string): Criterion {
  return { id, text, checked: false };
}

describe("search query normalization", () => {
  it("trims, collapses and enforces the 2-200 character range", () => {
    expect(normalizeSearchQuery("  reset   email ")).toBe("reset email");
    expect(normalizeSearchQuery("ab")).toBe("ab");
    expect(normalizeSearchQuery("a")).toBeNull();
    expect(normalizeSearchQuery("   ")).toBeNull();
    expect(normalizeSearchQuery("x".repeat(200))).toBe("x".repeat(200));
    expect(normalizeSearchQuery("x".repeat(201))).toBeNull();
    expect(normalizeSearchQuery(42)).toBeNull();
  });
});

describe("document search", () => {
  it("matches titles, descriptions, criteria, commits and verification text", () => {
    const doc = document([
      chapter("title", { title: "Password reset" }),
      chapter("description", { description: "Send a reset email." }),
      chapter("criterion", { criteria: [criterion("c1", "Reset by email")] }),
      chapter("commit", { commits: ["4f2a9c1"] }),
      chapter("auto", {
        verification: {
          ...createDefaultVerification(),
          auto: { command: "npm test reset" },
        },
      }),
      chapter("human", {
        verification: {
          ...createDefaultVerification(),
          human: { instructions: "Check the reset email" },
        },
      }),
      chapter("ai", {
        verification: {
          ...createDefaultVerification(),
          ai: { instructions: "Verify reset delivery" },
        },
      }),
    ]);

    expect(
      searchChapters(doc, "reset").results.map((r) => r.chapterId),
    ).toEqual(["title", "criterion", "description", "auto", "human", "ai"]);
    expect(searchChapters(doc, "4f2a").results[0].matches[0]).toMatchObject({
      field: "commit",
      commit: "4f2a9c1",
      ranges: [[0, 4]],
    });
    expect(searchChapters(doc, "4F2A9C1").results[0].matches[0].field).toBe(
      "commit",
    );
  });

  it("requires every query term to match somewhere in the same chapter", () => {
    const doc = document([
      chapter("both", {
        title: "Alpha",
        description: "Beta appears here.",
      }),
      chapter("only-alpha", { title: "Alpha" }),
      chapter("only-beta", { description: "Beta appears here." }),
    ]);

    expect(searchChapters(doc, "alpha beta").results).toHaveLength(1);
    expect(searchChapters(doc, "alpha beta").results[0].chapterId).toBe("both");
    expect(searchChapters(doc, "alpha missing").results).toEqual([]);
  });

  it("ranks exact commits, commit prefixes, titles, criteria, descriptions and verification", () => {
    const doc = document([
      chapter("title", { title: "abc1234" }),
      chapter("criterion", { criteria: [criterion("c1", "abc1234")] }),
      chapter("description", { description: "abc1234" }),
      chapter("verification", {
        verification: {
          ...createDefaultVerification(),
          auto: { command: "abc1234" },
        },
      }),
      chapter("commit", { commits: ["abc1234"] }),
    ]);

    expect(
      searchChapters(doc, "abc1234").results.map((r) => r.chapterId),
    ).toEqual(["commit", "title", "criterion", "description", "verification"]);
    expect(searchChapters(doc, "abc1").results.map((r) => r.chapterId)).toEqual(
      ["commit", "title", "criterion", "description", "verification"],
    );
  });

  it("returns path, snippets and highlight ranges", () => {
    const longDescription =
      "Start of a long description that eventually mentions the unique phrase in the middle and then continues with more text after it.";
    const doc: ChapterDocument = {
      byId: {
        parent: chapter("parent", { title: "Parent", childIds: ["child"] }),
        child: chapter("child", {
          title: "Child",
          parentId: "parent",
          description: longDescription,
        }),
      },
      rootIds: ["parent"],
    };

    const result = searchChapters(doc, "unique phrase").results[0];
    expect(result.path).toEqual([
      { id: "parent", title: "Parent" },
      { id: "child", title: "Child" },
    ]);
    expect(result.matches[0].snippet).toContain("unique phrase");
    expect(result.matches[0].snippet.length).toBeLessThanOrEqual(162);
    const [start, end] = result.matches[0].ranges[0];
    expect(result.matches[0].snippet.slice(start, end)).toBe("unique");
  });

  it("caps match entries per result but reports the full match count", () => {
    const criteria = Array.from({ length: 8 }, (_, index) =>
      criterion(`c${index}`, "needle"),
    );
    const doc = document([chapter("many", { criteria })]);

    const result = searchChapters(doc, "needle").results[0];
    expect(result.matchCount).toBe(criteria.length);
    expect(result.matches).toHaveLength(SEARCH_MAX_MATCHES_PER_RESULT);
  });

  it("paginates results and caps a very large result set", () => {
    const chapters = Array.from({ length: 2001 }, (_, index) =>
      chapter(`chapter-${index}`, { title: "needle" }),
    );
    const doc = document(chapters);

    const first = searchChapters(doc, "needle", { limit: 100 });
    expect(first.total).toBe(2000);
    expect(first.truncated).toBe(true);
    expect(first.results).toHaveLength(100);

    const last = searchChapters(doc, "needle", {
      limit: 20,
      offset: 1990,
    });
    expect(last.total).toBe(2000);
    expect(last.results).toHaveLength(10);
    expect(last.results[0].chapterId).toBe("chapter-1990");
  });

  it("does not mutate the document", () => {
    const doc = document([
      chapter("one", {
        title: "Reset",
        criteria: [criterion("c1", "Reset email")],
        commits: ["4f2a9c1"],
      }),
    ]);
    const before = JSON.stringify(doc);
    searchChapters(doc, "reset");
    expect(JSON.stringify(doc)).toBe(before);
  });
});

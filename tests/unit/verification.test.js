import { describe, expect, it } from "vitest";
import {
  MAX_AI_INSTRUCTIONS,
  MAX_AUTO_COMMAND,
  MAX_HUMAN_INSTRUCTIONS,
  createDefaultVerification,
  getCoverageRows,
  getVerificationChapters,
  isAutomated,
  isVerificationEligible,
  normalizeVerification,
  summarizeVerification,
} from "../../src/domain/verification.js";
import {
  createChapter,
  createEmptyDocument,
  insertChapter,
} from "../../src/domain/chapters.js";

function rule(mode, content) {
  return {
    mode,
    auto: { command: mode === "auto" ? content : "" },
    human: { instructions: mode === "human" ? content : "" },
    ai: { instructions: mode === "ai" ? content : "" },
  };
}

function documentWithVerification() {
  let document = insertChapter(
    createEmptyDocument(),
    createChapter({ id: "root", title: "Root", parentId: null }),
  );
  document = insertChapter(
    document,
    createChapter({
      id: "auto",
      title: "Automated",
      parentId: "root",
      verification: rule("auto", "npm test child"),
      commits: ["4f2a9c1"],
    }),
  );
  document = insertChapter(
    document,
    createChapter({
      id: "missing-command",
      title: "Missing command",
      parentId: "root",
      verification: rule("auto", "  "),
    }),
  );
  document = insertChapter(
    document,
    createChapter({
      id: "human",
      title: "Human",
      parentId: "root",
      verification: rule("human", "Check by hand"),
    }),
  );
  document = insertChapter(
    document,
    createChapter({
      id: "ai",
      title: "AI",
      parentId: "root",
      verification: rule("ai", "Inspect it"),
    }),
  );
  return document;
}

describe("verification normalization", () => {
  it("creates the default human rule", () => {
    expect(createDefaultVerification()).toEqual({
      mode: "human",
      auto: { command: "" },
      human: { instructions: "" },
      ai: { instructions: "" },
    });
  });

  it("repairs missing and malformed rules field by field", () => {
    expect(normalizeVerification(null)).toEqual(createDefaultVerification());
    expect(normalizeVerification({ mode: "nope", auto: "bad" })).toEqual(
      createDefaultVerification(),
    );

    const normalized = normalizeVerification({
      mode: "auto",
      auto: { command: "  npm test\n  login  " },
      human: { instructions: "  Human text  " },
      ai: { instructions: "  AI text\nsecond line  " },
    });
    expect(normalized.mode).toBe("auto");
    expect(normalized.auto.command).toBe("npm test login");
    expect(normalized.human.instructions).toBe("Human text");
    expect(normalized.ai.instructions).toBe("AI text\nsecond line");
  });

  it("clamps each field to its limit", () => {
    const normalized = normalizeVerification({
      auto: { command: "x".repeat(MAX_AUTO_COMMAND + 10) },
      human: { instructions: "h".repeat(MAX_HUMAN_INSTRUCTIONS + 10) },
      ai: { instructions: "a".repeat(MAX_AI_INSTRUCTIONS + 10) },
    });
    expect(normalized.auto.command).toHaveLength(MAX_AUTO_COMMAND);
    expect(normalized.human.instructions).toHaveLength(MAX_HUMAN_INSTRUCTIONS);
    expect(normalized.ai.instructions).toHaveLength(MAX_AI_INSTRUCTIONS);
  });
});

describe("verification coverage", () => {
  it("eligibility depends on having a parent chapter", () => {
    const document = documentWithVerification();
    expect(isVerificationEligible(document.byId.root)).toBe(false);
    expect(isVerificationEligible(document.byId.auto)).toBe(true);
  });

  it("counts only auto-test chapters with a command", () => {
    const document = documentWithVerification();
    expect(isAutomated(document.byId.auto)).toBe(true);
    expect(isAutomated(document.byId["missing-command"])).toBe(false);
    expect(isAutomated(document.byId.human)).toBe(false);

    const summary = summarizeVerification(document);
    expect(summary).toEqual({
      total: 4,
      automated: 1,
      human: 1,
      ai: 1,
      incompleteAuto: 1,
      percent: 25,
    });
    expect(getVerificationChapters(document)).toHaveLength(4);
    expect(
      getVerificationChapters(document).map((chapter) => chapter.id),
    ).toEqual(["auto", "missing-command", "human", "ai"]);
  });

  it("builds coverage rows with chapter paths and no root chapters", () => {
    const rows = getCoverageRows(documentWithVerification());
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({
      chapterId: "auto",
      chapterTitle: "Automated",
      chapterPath: "Root › Automated",
      command: "npm test child",
      automated: true,
      incompleteAuto: false,
      criterionCount: 0,
      commits: ["4f2a9c1"],
    });
    expect(rows[1].incompleteAuto).toBe(true);
    expect(rows[1].commits).toEqual([]);
    expect(rows[2].mode).toBe("human");
    expect(rows[3].mode).toBe("ai");
  });

  it("returns an empty summary when there are no eligible chapters", () => {
    const document = insertChapter(
      createEmptyDocument(),
      createChapter({ id: "root", title: "Root" }),
    );
    expect(summarizeVerification(document)).toEqual({
      total: 0,
      automated: 0,
      human: 0,
      ai: 0,
      incompleteAuto: 0,
      percent: 0,
    });
    expect(getCoverageRows(document)).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import {
  createChapter,
  patchChapter,
  type Chapter,
  type ChapterDocument,
} from "../../src/domain/chapters";
import { patchCriterion } from "../../src/domain/criteria";
import {
  applyCriterionSync,
  emptyCriterionSync,
  reconcileCriterionLinks,
} from "../../src/domain/criterionLinks";

type ChapterInput = Partial<Chapter> & { id: string };

function documentOf(chapters: ChapterInput[]): ChapterDocument {
  const byId: Record<string, Chapter> = {};
  for (const input of chapters) byId[input.id] = createChapter(input);
  for (const input of chapters) {
    byId[input.id].childIds = chapters
      .filter((candidate) => (candidate.parentId ?? null) === input.id)
      .map((candidate) => candidate.id);
  }
  return {
    byId,
    rootIds: chapters
      .filter((candidate) => candidate.parentId == null)
      .map((candidate) => candidate.id),
  };
}

const linkedText = "Reset email\n\nThe email contains one unique link.";

function pairDocument(
  overrides: {
    text?: string;
    title?: string;
    description?: string;
    criterionId?: string;
    chapterId?: string | undefined;
    childIds?: string[];
    criteria?: Chapter["criteria"];
  } = {},
): ChapterDocument {
  const text = overrides.text ?? linkedText;
  const criterionId = overrides.criterionId ?? "c1";
  const criterion: Chapter["criteria"][number] = {
    id: criterionId,
    text,
    checked: false,
  };
  if (overrides.chapterId !== undefined)
    criterion.chapterId = overrides.chapterId;
  else criterion.chapterId = "kid";

  return documentOf([
    { id: "root", title: "Root" },
    {
      id: "parent",
      parentId: "root",
      title: "Parent",
      criteria: overrides.criteria ?? [criterion],
    },
    {
      id: "kid",
      parentId: "parent",
      title: overrides.title ?? "Reset email",
      description: overrides.description ?? text,
      childIds: overrides.childIds,
    },
  ]);
}

describe("criterion links: link repair", () => {
  it("drops a link to a missing chapter", () => {
    const next = pairDocument({ chapterId: "missing" });
    const result = reconcileCriterionLinks(pairDocument(), next);
    expect(result.document.byId.parent.criteria[0].chapterId).toBeUndefined();
    expect(result.sync.removedSubchapters).toEqual([]);
    expect(result.sync.removedCriteria).toEqual([]);
  });

  it("drops a self-link and a non-child link", () => {
    const selfLinked = documentOf([
      {
        id: "parent",
        title: "Parent",
        criteria: [
          { id: "c1", text: "Self", checked: false, chapterId: "parent" },
        ],
      },
    ]);
    expect(
      reconcileCriterionLinks(selfLinked, selfLinked).document.byId.parent
        .criteria[0].chapterId,
    ).toBeUndefined();

    const grandchild = documentOf([
      {
        id: "parent",
        title: "Parent",
        criteria: [
          { id: "c1", text: "Deep", checked: false, chapterId: "deep" },
        ],
      },
      { id: "child", parentId: "parent", title: "Child" },
      { id: "deep", parentId: "child", title: "Deep" },
    ]);
    expect(
      reconcileCriterionLinks(grandchild, grandchild).document.byId.parent
        .criteria[0].chapterId,
    ).toBeUndefined();
  });

  it("keeps the first claim when two criteria name the same chapter", () => {
    const next = pairDocument({
      criteria: [
        { id: "c1", text: linkedText, checked: false, chapterId: "kid" },
        { id: "c2", text: "Second", checked: false, chapterId: "kid" },
      ],
    });
    const result = reconcileCriterionLinks(pairDocument(), next);
    expect(result.document.byId.parent.criteria[0].chapterId).toBe("kid");
    expect(result.document.byId.parent.criteria[1].chapterId).toBeUndefined();
    expect(result.sync.removedSubchapters).toEqual([]);
  });
});

describe("criterion links: removal cascades", () => {
  it("deletes the subchapter subtree when the criterion is removed", () => {
    const previous = documentOf([
      { id: "root", title: "Root" },
      {
        id: "parent",
        parentId: "root",
        title: "Parent",
        criteria: [
          { id: "c1", text: linkedText, checked: true, chapterId: "kid" },
        ],
      },
      {
        id: "kid",
        parentId: "parent",
        title: "Reset email",
        description: linkedText,
        criteria: [
          { id: "inner", text: "Inner", checked: false, chapterId: "grand" },
        ],
      },
      { id: "grand", parentId: "kid", title: "Inner", description: "Inner" },
    ]);
    const next = patchChapter(previous, "parent", {
      criteria: previous.byId.parent.criteria.filter(
        (item) => item.id !== "c1",
      ),
    });

    const result = reconcileCriterionLinks(previous, next);
    expect(result.document.byId.kid).toBeUndefined();
    expect(result.document.byId.grand).toBeUndefined();
    expect(result.document.byId.parent.childIds).toEqual([]);
    expect(result.sync.removedSubchapters).toEqual([
      {
        id: "kid",
        parentId: "parent",
        criterionId: "c1",
        title: "Reset email",
      },
    ]);
    expect(result.removedChapterIds.sort()).toEqual(["grand", "kid"]);
    expect(result.activity).toEqual([
      {
        message: "Deleted subchapter from success criterion",
        chapterId: null,
        chapterName: "Reset email",
      },
    ]);
  });

  it("deletes the criterion when its subchapter is removed", () => {
    const previous = pairDocument();
    const next = documentOf([
      { id: "root", title: "Root" },
      {
        id: "parent",
        parentId: "root",
        title: "Parent",
        criteria: previous.byId.parent.criteria,
      },
    ]);
    const result = reconcileCriterionLinks(previous, next);
    expect(result.document.byId.parent.criteria).toEqual([]);
    expect(result.sync.removedCriteria).toEqual([
      { chapterId: "parent", criterionId: "c1", text: linkedText },
    ]);
    expect(result.sync.removedSubchapters).toEqual([]);
  });

  it("treats a removed link as a detach and keeps both records", () => {
    const previous = pairDocument();
    const next = pairDocument({ chapterId: undefined, criteria: [] });
    // Build the detached document explicitly: the criterion stays, without a link.
    const detached = patchChapter(next, "parent", {
      criteria: [{ id: "c1", text: linkedText, checked: false }],
    });
    const result = reconcileCriterionLinks(previous, detached);
    expect(result.document.byId.kid).toBeDefined();
    expect(result.document.byId.parent.criteria[0].chapterId).toBeUndefined();
    expect(result.sync.removedSubchapters).toEqual([]);
    expect(result.sync.removedCriteria).toEqual([]);
  });

  it("detaches instead of deleting when the chapter was moved", () => {
    const previous = pairDocument();
    const next = documentOf([
      { id: "root", title: "Root" },
      {
        id: "parent",
        parentId: "root",
        title: "Parent",
        criteria: previous.byId.parent.criteria,
      },
      {
        id: "kid",
        parentId: "root",
        title: "Reset email",
        description: linkedText,
      },
    ]);
    const result = reconcileCriterionLinks(previous, next);
    expect(result.document.byId.kid.parentId).toBe("root");
    expect(result.document.byId.parent.criteria[0].chapterId).toBeUndefined();
    expect(result.sync.removedSubchapters).toEqual([]);
  });

  it("keeps a chapter claimed by another criterion", () => {
    const previous = pairDocument();
    const next = patchChapter(previous, "parent", {
      criteria: [
        { id: "c2", text: linkedText, checked: false, chapterId: "kid" },
        { id: "c1", text: "Gone", checked: false },
      ],
    });
    const result = reconcileCriterionLinks(previous, next);
    expect(result.document.byId.kid).toBeDefined();
    expect(result.document.byId.parent.criteria[1].chapterId).toBeUndefined();
    expect(result.sync.removedSubchapters).toEqual([]);
  });
});

describe("criterion links: mirror sync", () => {
  it("is idempotent and does not touch an already consistent pair", () => {
    const previous = pairDocument();
    const result = reconcileCriterionLinks(previous, previous);
    expect(result.document).toBe(previous);
    expect(result.sync).toEqual(emptyCriterionSync());
    expect(result.activity).toEqual([]);
  });

  it("mirrors a criterion text edit into the subchapter", () => {
    const previous = pairDocument();
    const next = patchCriterion(previous, "parent", "c1", {
      text: "New title\n\nNew details.",
    });
    const result = reconcileCriterionLinks(previous, next);
    expect(result.document.byId.kid.title).toBe("New title");
    expect(result.document.byId.kid.description).toBe(
      "New title\n\nNew details.",
    );
    expect(result.document.byId.parent.criteria[0].text).toBe(
      "New title\n\nNew details.",
    );
    expect(result.sync.updatedSubchapters).toEqual([
      {
        id: "kid",
        parentId: "parent",
        criterionId: "c1",
        title: "New title",
        description: "New title\n\nNew details.",
      },
    ]);
  });

  it("mirrors a subchapter description edit into the criterion", () => {
    const previous = pairDocument();
    const next = patchChapter(previous, "kid", {
      description: "Only the description changed.",
    });
    const result = reconcileCriterionLinks(previous, next);
    expect(result.document.byId.parent.criteria[0].text).toBe(
      "Only the description changed.",
    );
    expect(result.document.byId.kid.title).toBe(
      "Only the description changed.",
    );
  });

  it("rewrites only the first line for a subchapter title edit", () => {
    const previous = pairDocument();
    const next = patchChapter(previous, "kid", { title: "New title" });
    const result = reconcileCriterionLinks(previous, next);
    expect(result.document.byId.parent.criteria[0].text).toBe(
      "New title\n\nThe email contains one unique link.",
    );
    expect(result.document.byId.kid.description).toBe(
      "New title\n\nThe email contains one unique link.",
    );
    expect(result.document.byId.kid.title).toBe("New title");
  });

  it("lets the criterion win when both sides changed", () => {
    const previous = pairDocument();
    let next = patchChapter(previous, "kid", {
      title: "Chapter title",
      description: "Chapter description",
    });
    next = patchCriterion(next, "parent", "c1", { text: "Criterion text" });
    const result = reconcileCriterionLinks(previous, next);
    expect(result.document.byId.parent.criteria[0].text).toBe("Criterion text");
    expect(result.document.byId.kid.title).toBe("Criterion text");
    expect(result.document.byId.kid.description).toBe("Criterion text");
  });

  it("uses the criterion text for a new link and overwrites the chapter", () => {
    const previous = documentOf([
      { id: "parent", title: "Parent", criteria: [] },
      {
        id: "kid",
        parentId: "parent",
        title: "Existing",
        description: "Existing content",
      },
    ]);
    const next = patchChapter(previous, "parent", {
      criteria: [
        {
          id: "c1",
          text: "Criterion content",
          checked: false,
          chapterId: "kid",
        },
      ],
    });
    const result = reconcileCriterionLinks(previous, next);
    expect(result.document.byId.kid.title).toBe("Criterion content");
    expect(result.document.byId.kid.description).toBe("Criterion content");
    expect(result.sync.updatedSubchapters).toHaveLength(1);
  });

  it("clamps derived titles and handles empty text", () => {
    const previous = pairDocument();
    const long = "x".repeat(260);
    const result = reconcileCriterionLinks(
      previous,
      patchCriterion(previous, "parent", "c1", { text: long }),
    );
    expect(result.document.byId.kid.title).toHaveLength(200);

    const empty = reconcileCriterionLinks(
      previous,
      patchCriterion(previous, "parent", "c1", { text: "" }),
    );
    expect(empty.document.byId.kid.title).toBe("Untitled chapter");
    expect(empty.document.byId.kid.description).toBe("");
  });

  it("does not mutate its inputs and is order-independent", () => {
    const previous = pairDocument();
    const next = patchCriterion(previous, "parent", "c1", { text: "Changed" });
    const beforePrevious = structuredClone(previous);
    const beforeNext = structuredClone(next);

    const result = reconcileCriterionLinks(previous, next);
    expect(previous).toEqual(beforePrevious);
    expect(next).toEqual(beforeNext);

    const reordered: ChapterDocument = {
      byId: Object.fromEntries(Object.entries(previous.byId).reverse()),
      rootIds: previous.rootIds,
    };
    const first = reconcileCriterionLinks(previous, next);
    const second = reconcileCriterionLinks(reordered, next);
    expect(second.document.byId.kid.title).toBe(first.document.byId.kid.title);
    expect(second.sync).toEqual(first.sync);
    expect(result.document.byId.kid.title).toBe(first.document.byId.kid.title);
  });
});

describe("criterion links: applying a save response", () => {
  it("removes cascaded chapters from a dirty document", () => {
    const snapshot = pairDocument();
    const current = patchChapter(snapshot, "kid", {
      description: "Edited while saving",
    });
    const incoming = patchChapter(snapshot, "parent", { criteria: [] });
    const removed = reconcileCriterionLinks(snapshot, incoming);
    const next = applyCriterionSync(
      current,
      snapshot,
      removed.document,
      removed.sync,
    );
    expect(next.byId.kid).toBeUndefined();
    expect(next.byId.parent.criteria).toEqual([]);
  });

  it("applies mirror updates unless the field is being edited", () => {
    const snapshot = pairDocument();
    const source = reconcileCriterionLinks(
      snapshot,
      patchCriterion(snapshot, "parent", "c1", {
        text: "Server text\n\nServer details",
      }),
    ).document;
    const sync = {
      updatedSubchapters: [
        {
          id: "kid",
          parentId: "parent",
          criterionId: "c1",
          title: "Server text",
          description: "Server text\n\nServer details",
        },
      ],
      removedSubchapters: [],
      removedCriteria: [],
    };

    const untouched = applyCriterionSync(snapshot, snapshot, source, sync);
    expect(untouched.byId.kid.title).toBe("Server text");

    const editing = patchChapter(snapshot, "kid", {
      description: "User is typing here",
    });
    const preserved = applyCriterionSync(editing, snapshot, source, sync);
    expect(preserved.byId.kid.description).toBe("User is typing here");
    expect(preserved.byId.kid.title).toBe("Server text");
  });
});

describe("criterion links: stored drift", () => {
  it("repairs a drifted pair from the criterion text", () => {
    const drifted = pairDocument({ description: "Old mirror" });
    const result = reconcileCriterionLinks(drifted, drifted);
    expect(result.document.byId.kid.description).toBe(linkedText);
    expect(result.document.byId.kid.title).toBe("Reset email");
    expect(result.sync.updatedSubchapters).toHaveLength(1);
  });
});

describe("criterion links: relinking", () => {
  it("keeps a criterion relinked to a surviving chapter in the same write", () => {
    const previous = pairDocument();
    const next = documentOf([
      { id: "root", title: "Root" },
      {
        id: "parent",
        parentId: "root",
        title: "Parent",
        criteria: [
          { id: "c1", text: linkedText, checked: false, chapterId: "newer" },
        ],
      },
      {
        id: "newer",
        parentId: "parent",
        title: "Reset email",
        description: linkedText,
      },
    ]);
    const result = reconcileCriterionLinks(previous, next);
    expect(result.document.byId.parent.criteria[0].chapterId).toBe("newer");
    expect(result.sync.removedCriteria).toEqual([]);
    expect(result.sync.removedSubchapters).toEqual([]);
  });
});

describe("criterion links: criterion-only updates", () => {
  it("reports a criterion text update when the chapter fields did not change", () => {
    const text = "Same title\n\nOld details.";
    const previous = pairDocument({ text, title: "Same title" });
    const next = patchChapter(previous, "kid", {
      description: "Same title\n\nNew details.",
    });
    const result = reconcileCriterionLinks(previous, next);
    expect(result.document.byId.parent.criteria[0].text).toBe(
      "Same title\n\nNew details.",
    );
    expect(result.document.byId.kid.description).toBe(
      "Same title\n\nNew details.",
    );
    expect(result.document.byId.kid.title).toBe("Same title");
    expect(result.sync.updatedSubchapters).toEqual([
      {
        id: "kid",
        parentId: "parent",
        criterionId: "c1",
        title: "Same title",
        description: "Same title\n\nNew details.",
      },
    ]);
  });
});

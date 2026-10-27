import { describe, expect, it } from "vitest";
import {
  collectSubtreeIds,
  createChapter,
  createEmptyDocument,
  deleteSubtree,
  duplicateSubtree,
  getDefaultId,
  getPath,
  insertChapter,
  isDescendant,
  moveChapter,
  moveCriterion,
  patchChapter,
  reorderCriteria,
  setCriteria,
  walkChapters,
} from "../../src/domain/chapters.js";

function fixture() {
  let document = createEmptyDocument();
  document = insertChapter(document, createChapter({ id: "a", title: "A" }));
  document = insertChapter(
    document,
    createChapter({ id: "a1", parentId: "a", title: "A1" }),
  );
  document = insertChapter(
    document,
    createChapter({ id: "a1x", parentId: "a1", title: "A1X" }),
  );
  document = insertChapter(
    document,
    createChapter({ id: "a2", parentId: "a", title: "A2" }),
  );
  document = insertChapter(document, createChapter({ id: "b", title: "B" }));
  return document;
}

describe("chapter document", () => {
  it("keeps an ordered root list and parent links", () => {
    const document = fixture();
    expect(document.rootIds).toEqual(["a", "b"]);
    expect(document.byId.a.childIds).toEqual(["a1", "a2"]);
    expect(document.byId.a1.parentId).toBe("a");
    expect(getPath(document, "a1x").map((chapter) => chapter.id)).toEqual([
      "a",
      "a1",
      "a1x",
    ]);
  });

  it("falls back to the first root for unknown selected ids", () => {
    const document = fixture();
    expect(getDefaultId(document, "a2")).toBe("a2");
    expect(getDefaultId(document, "missing")).toBe("a");
    expect(getDefaultId(createEmptyDocument(), "missing")).toBeNull();
  });

  it("inserts at an explicit index and ignores duplicate ids", () => {
    let document = fixture();
    document = insertChapter(document, createChapter({ id: "c", title: "C" }), {
      index: 1,
    });
    expect(document.rootIds).toEqual(["a", "c", "b"]);
    const unchanged = insertChapter(
      document,
      createChapter({ id: "c", title: "Duplicate" }),
    );
    expect(unchanged).toBe(document);
  });

  it("shares untouched chapter records when patching one chapter", () => {
    const document = fixture();
    const next = patchChapter(document, "a1", { title: "Renamed" });
    expect(next).not.toBe(document);
    expect(next.byId.a1.title).toBe("Renamed");
    expect(next.byId.a).toBe(document.byId.a);
    expect(next.byId.b).toBe(document.byId.b);
    expect(next.rootIds).toBe(document.rootIds);
  });

  it("walks the document in display order and survives cycles", () => {
    const document = fixture();
    expect(walkChapters(document).map((chapter) => chapter.id)).toEqual([
      "a",
      "a1",
      "a1x",
      "a2",
      "b",
    ]);

    const cyclic = {
      ...document,
      byId: {
        ...document.byId,
        a: {
          ...document.byId.a,
          childIds: [...document.byId.a.childIds, "a"],
        },
      },
    };
    expect(walkChapters(cyclic).map((chapter) => chapter.id)).toEqual([
      "a",
      "a1",
      "a1x",
      "a2",
      "b",
    ]);
  });

  it("deletes a subtree, its links and nothing else", () => {
    let document = fixture();
    document = setCriteria(document, "b", [
      { id: "c1", text: "linked", checked: false, chapterId: "a1x" },
      { id: "c2", text: "kept", checked: false, chapterId: "a2" },
    ]);
    const { document: next, removedIds } = deleteSubtree(document, "a1");
    expect(removedIds).toEqual(["a1", "a1x"]);
    expect(next.byId.a1).toBeUndefined();
    expect(next.byId.a1x).toBeUndefined();
    expect(next.byId.a.childIds).toEqual(["a2"]);
    expect(next.byId.b.criteria[0]).not.toHaveProperty("chapterId");
    expect(next.byId.b.criteria[1].chapterId).toBe("a2");
  });

  it("moves chapters and rejects cycles", () => {
    const document = fixture();
    const moved = moveChapter(document, "a2", null, 0);
    expect(moved.rootIds).toEqual(["a2", "a", "b"]);
    expect(moved.byId.a.childIds).toEqual(["a1"]);
    expect(moved.byId.a2.parentId).toBeNull();

    const intoGrandchild = moveChapter(document, "a", "a1x");
    expect(intoGrandchild).toBe(document);
    expect(isDescendant(document, "a", "a1x")).toBe(true);
    expect(isDescendant(document, "b", "a1x")).toBe(false);
  });

  it("reorders criteria by index or id", () => {
    let document = fixture();
    document = setCriteria(document, "b", [
      { id: "one", text: "1", checked: false },
      { id: "two", text: "2", checked: false },
      { id: "three", text: "3", checked: false },
    ]);
    expect(
      reorderCriteria(document, "b", 0, 2).byId.b.criteria.map((c) => c.id),
    ).toEqual(["two", "three", "one"]);
    expect(
      moveCriterion(document, "b", "three", 0).byId.b.criteria.map((c) => c.id),
    ).toEqual(["three", "one", "two"]);
    expect(reorderCriteria(document, "b", 0, 99)).toBe(document);
  });

  it("duplicates a subtree with fresh ids and remapped links", () => {
    const document = fixture();
    let counter = 0;
    const newId = () => `new-${(counter += 1)}`;
    const withCriteria = setCriteria(document, "a", [
      { id: "crit", text: "criterion", checked: false, chapterId: "a1" },
    ]);
    const { document: next, chapterId } = duplicateSubtree(
      withCriteria,
      "a1",
      newId,
    );

    expect(chapterId).toBe("new-1");
    expect(next.byId.a.childIds).toEqual(["a1", "new-1", "a2"]);
    const copy = next.byId["new-1"];
    expect(copy.title).toBe("A1");
    expect(copy.childIds).toEqual(["new-2"]);
    expect(next.byId["new-2"].parentId).toBe("new-1");
    expect(next.byId.a.criteria[0].chapterId).toBe("a1");
    expect(collectSubtreeIds(next, "new-1")).toEqual(["new-1", "new-2"]);
  });
});

import { describe, expect, it } from "vitest";
import {
  addCriterion,
  applyCreatedSubchapters,
  createCriterion,
  createSubchapterFromCriterion,
  criterionProgress,
  deriveCriterionTitle,
  patchCriterion,
  removeCriterion,
  toggleCriterion,
} from "../../src/domain/criteria.js";
import {
  createChapter,
  createEmptyDocument,
  getChapter,
  insertChapter,
} from "../../src/domain/chapters.js";

function documentWithChapter() {
  const document = insertChapter(
    createEmptyDocument(),
    createChapter({ id: "parent", title: "Parent" }),
  );
  return document;
}

describe("criterion titles", () => {
  it.each([
    ["Plain title", "Plain title"],
    ["## Heading", "Heading"],
    ["> Quoted", "Quoted"],
    ["- list item", "list item"],
    ["1. numbered", "numbered"],
    ["**Bold** and *italic*", "Bold and italic"],
    ["`code` and ~~old~~", "code and old"],
    ["[Label](https://example.com)", "Label"],
    ["![Shot](https://example.com/a.png)", "Shot"],
    ["  spaced  ", "spaced"],
  ])("derives %j as %j", (input, expected) => {
    expect(deriveCriterionTitle(input)).toBe(expected);
  });

  it("uses the first line only", () => {
    expect(deriveCriterionTitle("First line\nSecond **line**")).toBe(
      "First line",
    );
  });

  it("falls back for formatting-only input", () => {
    expect(deriveCriterionTitle("****")).toBe("Untitled chapter");
    expect(deriveCriterionTitle("")).toBe("Untitled chapter");
  });
});

describe("criteria", () => {
  it("links an added criterion to its new subchapter", () => {
    const criterion = createCriterion({ id: "c1", text: "Do the thing" });
    const subchapter = createSubchapterFromCriterion({
      id: "s1",
      text: "Do the thing",
    });
    const next = addCriterion(
      documentWithChapter(),
      "parent",
      criterion,
      subchapter,
    );

    expect(next.byId.parent.criteria).toEqual([
      {
        id: "c1",
        text: "Do the thing",
        checked: false,
        chapterId: "s1",
      },
    ]);
    expect(next.byId.s1.parentId).toBe("parent");
    expect(next.byId.s1.description).toBe("Do the thing");
    expect(next.byId.parent.childIds).toEqual(["s1"]);
  });

  it("adds a criterion without a subchapter", () => {
    const next = addCriterion(
      documentWithChapter(),
      "parent",
      createCriterion({ id: "c1", text: "Standalone" }),
    );
    expect(next.byId.parent.criteria[0]).not.toHaveProperty("chapterId");
    expect(next.byId.parent.childIds).toEqual([]);
  });

  it("applies server-created subchapters to a local document", () => {
    const base = addCriterion(
      documentWithChapter(),
      "parent",
      createCriterion({ id: "c1", text: "Ship it" }),
    );
    const source = addCriterion(
      documentWithChapter(),
      "parent",
      createCriterion({ id: "c1", text: "Ship it" }),
      createSubchapterFromCriterion({ id: "s1", text: "Ship it" }),
    );
    const applied = applyCreatedSubchapters(
      base,
      [{ id: "s1", parentId: "parent", criterionId: "c1" }],
      source,
    );
    expect(applied.byId.parent.childIds).toEqual(["s1"]);
    expect(applied.byId.parent.criteria[0].chapterId).toBe("s1");
    expect(applied.byId.s1.description).toBe("Ship it");
    expect(applied.byId.s1.parentId).toBe("parent");

    const again = applyCreatedSubchapters(
      applied,
      [{ id: "s1", parentId: "parent", criterionId: "c1" }],
      source,
    );
    expect(again).toBe(applied);

    const withoutCriterion = applyCreatedSubchapters(
      documentWithChapter(),
      [{ id: "s1", parentId: "parent", criterionId: "missing" }],
      source,
    );
    expect(withoutCriterion.byId.s1).toBeUndefined();
  });

  it("does not apply a generated chapter after the criterion was deleted", () => {
    const base = documentWithChapter();
    const source = addCriterion(
      documentWithChapter(),
      "parent",
      createCriterion({ id: "c1", text: "Ship it" }),
      createSubchapterFromCriterion({ id: "s1", text: "Ship it" }),
    );
    const applied = applyCreatedSubchapters(
      base,
      [{ id: "s1", parentId: "parent", criterionId: "c1" }],
      source,
    );
    expect(applied).toBe(base);
  });

  it("patches, toggles and removes criteria without touching chapters", () => {
    let document = addCriterion(
      documentWithChapter(),
      "parent",
      createCriterion({ id: "c1", text: "One" }),
      createSubchapterFromCriterion({ id: "s1", text: "One" }),
    );
    document = patchCriterion(document, "parent", "c1", { text: "Updated" });
    expect(document.byId.parent.criteria[0].text).toBe("Updated");

    document = toggleCriterion(document, "parent", "c1");
    expect(document.byId.parent.criteria[0].checked).toBe(true);
    expect(criterionProgress(document.byId.parent)).toEqual({
      done: 1,
      total: 1,
    });

    document = removeCriterion(document, "parent", "c1");
    expect(document.byId.parent.criteria).toEqual([]);
    expect(getChapter(document, "s1")).not.toBeNull();

    expect(removeCriterion(document, "parent", "missing")).toBe(document);
    expect(toggleCriterion(document, "parent", "missing")).toBe(document);
  });
});

describe("criterion titles: limits", () => {
  it("clamps a long derived title to the chapter title limit", () => {
    expect(deriveCriterionTitle("x".repeat(300))).toHaveLength(200);
  });
});

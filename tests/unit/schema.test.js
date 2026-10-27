import { describe, expect, it } from "vitest";
import {
  SCHEMA_VERSION,
  createProject,
  createSampleWorkspace,
  normalizeActivity,
  normalizeDocument,
  normalizeWorkspace,
} from "../../src/domain/schema.js";

const ids = () => {
  let counter = 0;
  return () => `generated-${(counter += 1)}`;
};

describe("document normalization", () => {
  it("converts the phase 1 nested shape into a normalized document", () => {
    const { document, issues } = normalizeDocument(
      [
        {
          id: "root",
          title: "Root",
          description: "Hello",
          finalLevel: true,
          criteria: [
            { id: "c1", text: "one", checked: true, chapterId: "kid" },
          ],
          children: [
            {
              id: "kid",
              title: "Kid",
              description: "Kid description",
              criteria: [],
              children: [],
            },
          ],
        },
      ],
      { newId: ids() },
    );

    expect(issues).toEqual([]);
    expect(document.rootIds).toEqual(["root"]);
    expect(document.byId.root.parentId).toBeNull();
    expect(document.byId.kid.parentId).toBe("root");
    expect(document.byId.root.childIds).toEqual(["kid"]);
    expect(document.byId.root.finalLevel).toBe(true);
    expect(document.byId.root.criteria[0].chapterId).toBe("kid");
  });

  it("repairs missing, duplicate and invalid data", () => {
    const { document, issues } = normalizeDocument(
      [
        {
          id: "root",
          title: "   ",
          description: 42,
          criteria: [
            { id: "dup", text: "first" },
            { id: "dup", text: "second" },
            { id: "bad" },
            "not a criterion",
          ],
          children: [
            { id: "kid", title: "Kid", children: "not an array" },
            { id: "kid", title: "Duplicate kid id" },
          ],
        },
      ],
      { newId: ids() },
    );

    expect(issues.length).toBeGreaterThan(3);
    expect(document.byId.root.title).toBe("Untitled chapter");
    expect(document.byId.root.description).toBe("");
    expect(document.byId.root.criteria).toHaveLength(2);
    expect(document.byId.root.criteria[1].id).not.toBe("dup");
    expect(document.byId.root.childIds).toHaveLength(2);
    expect(document.byId.root.childIds[1]).not.toBe("kid");
    expect(document.byId.root.childIds.every((id) => document.byId[id])).toBe(
      true,
    );
  });

  it("drops dangling links and recovers orphans", () => {
    const { document, issues } = normalizeDocument(
      {
        chapters: {
          rootIds: ["root", "missing"],
          byId: {
            root: {
              id: "root",
              title: "Root",
              childIds: ["missing-child", "root"],
              criteria: [
                { id: "c1", text: "dangling", chapterId: "gone" },
                { id: "c2", text: "kept", chapterId: "orphan" },
              ],
            },
            orphan: { id: "orphan", title: "Orphan", childIds: [] },
          },
        },
      },
      { newId: ids() },
    );

    expect(issues.length).toBeGreaterThan(0);
    expect(document.rootIds).toEqual(["root", "orphan"]);
    expect(document.byId.root.childIds).toEqual([]);
    expect(document.byId.root.criteria[0]).not.toHaveProperty("chapterId");
    expect(document.byId.root.criteria[1].chapterId).toBe("orphan");
  });

  it("returns an empty document for unusable input", () => {
    const { document, issues } = normalizeDocument("nope");
    expect(document).toEqual({ byId: {}, rootIds: [] });
    expect(issues).toHaveLength(1);
  });
});

describe("activity normalization", () => {
  it("keeps valid entries, repairs invalid ones and caps the history", () => {
    const now = () => "2026-01-01T00:00:00.000Z";
    const entries = Array.from({ length: 120 }, (_, index) => ({
      id: `e${index}`,
      message: `message ${index}`,
      chapterId: "root",
      chapterName: "Root",
      time: index === 0 ? "not a date" : "2026-01-02T00:00:00.000Z",
    }));
    entries.push({ id: "bad", time: "2026-01-02T00:00:00.000Z" });

    const { events, issues } = normalizeActivity(entries, {
      now,
      newId: ids(),
    });

    expect(events).toHaveLength(100);
    expect(events[0].time).toBe(now());
    expect(issues.length).toBeGreaterThan(0);
    expect(normalizeActivity(null).events).toEqual([]);
    expect(normalizeActivity("nope").issues).toHaveLength(1);
  });
});

describe("workspace", () => {
  it("creates the sample workspace with a usable selection", () => {
    const workspace = createSampleWorkspace();
    expect(workspace.schemaVersion).toBe(SCHEMA_VERSION);
    expect(workspace.selectedId).toBe("password-reset");
    expect(workspace.chapters.byId["password-reset"]).toBeDefined();
    expect(workspace.events).toEqual([]);
  });

  it("normalizes a whole legacy workspace payload", () => {
    const { workspace } = normalizeWorkspace(
      {
        chapters: [
          { id: "one", title: "One", criteria: [], children: [] },
          { id: "two", title: "Two", criteria: [], children: [] },
        ],
        selectedId: "two",
        events: [
          {
            id: "e1",
            message: "Created chapter",
            time: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
      { newId: ids() },
    );
    expect(workspace.selectedId).toBe("two");
    expect(workspace.events).toHaveLength(1);
    expect(workspace.chapters.rootIds).toEqual(["one", "two"]);
  });

  it("sanitizes project metadata", () => {
    expect(createProject({ name: "  Custom  ", account: "ABC" })).toEqual({
      id: "website",
      name: "Custom",
      account: "AB",
    });
    expect(createProject(null).name).toBe("Website project");
  });
});

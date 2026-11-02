import { describe, expect, it } from "vitest";
import {
  SCHEMA_VERSION,
  createEmptyProjectIndex,
  createSampleWorkspace,
  createWorkspace,
  normalizeActivity,
  normalizeDocument,
  normalizeProjectExport,
  normalizeProjectIndex,
  normalizeWorkspace,
  serializeProjectExport,
} from "../../src/domain/schema.js";
import {
  MAX_PROJECTS,
  deriveInitials,
  normalizeProject,
  summarizeDocument,
} from "../../src/domain/projects.js";
import {
  createChapter,
  createEmptyDocument,
  insertChapter,
} from "../../src/domain/chapters.js";

const ids = () => {
  let counter = 0;
  return () => `generated-${(counter += 1)}`;
};

const fixedNow = () => "2026-01-01T00:00:00.000Z";

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
    const entries = Array.from({ length: 120 }, (_, index) => ({
      id: `e${index}`,
      message: `message ${index}`,
      chapterId: "root",
      chapterName: "Root",
      time: index === 0 ? "not a date" : "2026-01-02T00:00:00.000Z",
    }));
    entries.push({ id: "bad", time: "2026-01-02T00:00:00.000Z" });

    const { events, issues } = normalizeActivity(entries, {
      now: fixedNow,
      newId: ids(),
    });

    expect(events).toHaveLength(100);
    expect(events[0].time).toBe(fixedNow());
    expect(issues.length).toBeGreaterThan(0);
    expect(normalizeActivity(null).events).toEqual([]);
    expect(normalizeActivity("nope").issues).toHaveLength(1);
  });
});

describe("workspace", () => {
  it("creates the sample workspace with a usable selection", () => {
    const workspace = createSampleWorkspace();
    expect(workspace.schemaVersion).toBe(SCHEMA_VERSION);
    expect(workspace.projectId).toBe("website");
    expect(workspace.selectedId).toBe("password-reset");
    expect(workspace.chapters.byId["password-reset"]).toBeDefined();
    expect(workspace.events).toEqual([]);
  });

  it("normalizes a whole legacy workspace payload with a project id", () => {
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
            time: fixedNow(),
          },
        ],
      },
      { newId: ids(), projectId: "legacy-project" },
    );
    expect(workspace.projectId).toBe("legacy-project");
    expect(workspace.selectedId).toBe("two");
    expect(workspace.events).toHaveLength(1);
    expect(workspace.chapters.rootIds).toEqual(["one", "two"]);
  });
});

describe("projects", () => {
  it("derives initials and normalizes project metadata", () => {
    expect(deriveInitials("Website project")).toBe("WP");
    expect(deriveInitials("W")).toBe("W");
    expect(deriveInitials("")).toBe("P");

    const project = normalizeProject(
      {
        name: "  Custom  ",
        account: "abc",
        color: "teal",
        description: "  Description  ",
      },
      { id: "custom", newId: ids(), now: fixedNow },
    );
    expect(project).toEqual({
      id: "custom",
      name: "Custom",
      initials: "AB",
      color: "teal",
      description: "Description",
      createdAt: fixedNow(),
      updatedAt: fixedNow(),
    });

    const fallback = normalizeProject(null, {
      id: "fallback",
      newId: ids(),
      now: fixedNow,
    });
    expect(fallback.name).toBe("Untitled project");
    expect(fallback.initials).toBe("UP");
    expect(fallback.color).toBe("indigo");
  });

  it("summarizes chapters, criteria and completion", () => {
    let document = createEmptyDocument();
    document = insertChapter(
      document,
      createChapter({
        id: "one",
        title: "One",
        criteria: [
          { id: "c1", text: "a", checked: true },
          { id: "c2", text: "b", checked: false },
        ],
      }),
    );
    document = insertChapter(
      document,
      createChapter({
        id: "two",
        title: "Two",
        criteria: [{ id: "c3", text: "c", checked: true }],
      }),
    );
    expect(summarizeDocument(document)).toEqual({
      chapterCount: 2,
      criterionCount: 3,
      checkedCount: 2,
    });
  });

  it("repairs a project index and falls back to a usable active id", () => {
    const { index, issues } = normalizeProjectIndex(
      {
        activeProjectId: "missing",
        projectIds: ["one", "missing", "one"],
        projects: {
          one: {
            name: "One",
            initials: "O",
            chapterCount: 2,
            criterionCount: 3,
            checkedCount: 1,
          },
          two: { name: "Two" },
        },
      },
      { newId: ids(), now: fixedNow },
    );

    expect(index.schemaVersion).toBe(SCHEMA_VERSION);
    expect(index.activeProjectId).toBe("one");
    expect(index.projectIds).toEqual(["one", "two"]);
    expect(index.projects.one.chapterCount).toBe(2);
    expect(index.projects.one.criterionCount).toBe(3);
    expect(index.projects.two.chapterCount).toBe(0);
    expect(issues.length).toBeGreaterThan(0);
    expect(createEmptyProjectIndex().projectIds).toEqual([]);
  });

  it("caps a saved catalog at the project limit", () => {
    const projects = {};
    const projectIds = [];
    for (let index = 0; index < MAX_PROJECTS + 2; index += 1) {
      const id = `project-${index}`;
      projectIds.push(id);
      projects[id] = { name: `Project ${index}` };
    }
    const { index, issues } = normalizeProjectIndex(
      { activeProjectId: projectIds[0], projectIds, projects },
      { newId: ids(), now: fixedNow },
    );
    expect(index.projectIds).toHaveLength(MAX_PROJECTS);
    expect(issues.join(" ")).toContain("first");
  });

  it("normalizes the project export format and legacy workspace exports", () => {
    const chapters = insertChapter(
      createEmptyDocument(),
      createChapter({
        id: "one",
        title: "One",
        criteria: [{ id: "c1", text: "a", checked: true }],
      }),
    );
    const workspace = createWorkspace({
      projectId: "source",
      chapters,
      events: [],
      selectedId: "one",
    });
    const project = normalizeProject(
      { name: "Source" },
      { id: "source", newId: ids(), now: fixedNow },
    );
    const exported = serializeProjectExport(project, workspace, fixedNow());
    expect(exported.format).toBe("layers-project");

    const imported = normalizeProjectExport(exported, {
      newId: ids(),
      now: fixedNow,
    });
    expect(imported.project.name).toBe("Source");
    expect(imported.workspace.chapters.byId.one.title).toBe("One");
    expect(imported.workspace.selectedId).toBe("one");
    expect(imported.issues).toEqual([]);

    const legacy = normalizeProjectExport(
      {
        schemaVersion: 3,
        project: { id: "website", name: "Website", account: "W" },
        chapters: {
          byId: {
            one: { id: "one", title: "Legacy", criteria: [], childIds: [] },
          },
          rootIds: ["one"],
        },
        events: [{ id: "e1", message: "Old event", time: fixedNow() }],
        selectedId: "one",
      },
      { newId: ids(), now: fixedNow },
    );
    expect(legacy.project.name).toBe("Website");
    expect(legacy.project.initials).toBe("W");
    expect(legacy.workspace.events).toHaveLength(1);
    expect(legacy.workspace.chapters.byId.one.title).toBe("Legacy");
  });
});

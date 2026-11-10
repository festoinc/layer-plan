import { describe, expect, it } from "vitest";
import {
  STORAGE_KEYS,
  createMemoryStorage,
  projectKeys,
} from "../../src/store/persistence.js";
import { createCatalogRepository } from "../../src/store/catalogRepository.js";
import { MAX_PROJECTS } from "../../src/domain/projects.js";

const fixedNow = () => "2026-01-01T00:00:00.000Z";

function idFactory() {
  let counter = 0;
  return () => `new-${(counter += 1)}`;
}

function catalog(storage, options = {}) {
  return createCatalogRepository({
    storage,
    debounceMs: 0,
    windowObject: null,
    now: fixedNow,
    newId: idFactory(),
    ...options,
  });
}

function readJson(storage, key) {
  return JSON.parse(storage.getItem(key));
}

describe("project catalog", () => {
  it("seeds two projects on first load and clears legacy keys", () => {
    const storage = createMemoryStorage();
    storage.setItem("layers:doc:v3", "{}");
    storage.setItem("layers-chapters-v2", "[]");
    storage.setItem("layers:projects:v4", "{}");
    storage.setItem("layers:project:website:doc:v4", "{}");
    const projects = catalog(storage);
    const { index, notices } = projects.load();

    expect(index.projectIds).toEqual(["website", "mobile"]);
    expect(index.activeProjectId).toBe("website");
    expect(projects.listProjects().map((project) => project.name)).toEqual([
      "Website project",
      "Mobile app",
    ]);
    expect(notices[0].message).toContain("Project storage reset");
    expect(storage.getItem("layers:doc:v3")).toBeNull();
    expect(storage.getItem("layers-chapters-v2")).toBeNull();
    expect(storage.getItem("layers:projects:v4")).toBeNull();
    expect(storage.getItem("layers:project:website:doc:v4")).toBeNull();
    expect(projects.getProjectGuidelines("website")).toContain("npm test");
    expect(storage.getItem(projectKeys("website").settings)).toBeTruthy();
    expect(storage.getItem(STORAGE_KEYS.index)).toBeTruthy();
    expect(storage.getItem(projectKeys("website").document)).toBeTruthy();
    expect(storage.getItem(projectKeys("mobile").document)).toBeTruthy();
  });

  it("creates a project with an Overview chapter and activity", () => {
    const storage = createMemoryStorage();
    const projects = catalog(storage);
    projects.load();

    const result = projects.createProject({
      name: "  Internal tools  ",
      initials: "it",
      color: "amber",
      testGuidelines: "Run the internal suite.",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const project = result.value;
    expect(project.name).toBe("Internal tools");
    expect(project.initials).toBe("IT");
    expect(project.color).toBe("amber");
    expect(project.chapterCount).toBe(1);
    expect(projects.getActiveProjectId()).toBe(project.id);
    expect(projects.listProjects()).toHaveLength(3);

    const document = readJson(storage, projectKeys(project.id).document);
    expect(Object.values(document.chapters.byId)[0].title).toBe("Overview");
    const activity = readJson(storage, projectKeys(project.id).activity);
    expect(activity.events[0].message).toBe("Created project");
    expect(projects.getProjectGuidelines(project.id)).toBe(
      "Run the internal suite.",
    );
  });

  it("updates metadata and records the change in the project activity", () => {
    const storage = createMemoryStorage();
    const projects = catalog(storage);
    projects.load();

    const result = projects.updateProject("website", {
      name: "Marketing site",
      initials: "MS",
      color: "sky",
      description: "Public pages",
      testGuidelines: "Run the marketing checks.",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe("Marketing site");
    expect(result.value.initials).toBe("MS");
    expect(result.value.color).toBe("sky");
    expect(result.value.description).toBe("Public pages");

    const activity = readJson(storage, projectKeys("website").activity);
    expect(activity.events[0].message).toContain("Marketing site");
    expect(projects.getProjectGuidelines("website")).toBe(
      "Run the marketing checks.",
    );

    const invalid = projects.updateProject("website", { name: "   " });
    expect(invalid.ok).toBe(false);
  });

  it("duplicates a project with independent content and fresh activity", () => {
    const storage = createMemoryStorage();
    const projects = catalog(storage);
    projects.load();

    const result = projects.duplicateProject("website");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.name).toBe("Website project copy");
    expect(result.value.chapterCount).toBe(
      projects.getProject("website").chapterCount,
    );
    expect(projects.getActiveProjectId()).toBe(result.value.id);

    const source = readJson(storage, projectKeys("website").document);
    const copy = readJson(storage, projectKeys(result.value.id).document);
    expect(copy.chapters.rootIds).toEqual(source.chapters.rootIds);
    expect(copy.chapters.byId).toEqual(source.chapters.byId);
    expect(copy.projectId).toBe(result.value.id);

    const activity = readJson(storage, projectKeys(result.value.id).activity);
    expect(activity.events).toHaveLength(1);
    expect(activity.events[0].message).toContain("Duplicated from");
    expect(projects.getProjectGuidelines(result.value.id)).toBe(
      projects.getProjectGuidelines("website"),
    );
  });

  it("deletes the active project, chooses the next one and removes its keys", () => {
    const storage = createMemoryStorage();
    const projects = catalog(storage);
    projects.load();

    const result = projects.deleteProject("website");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.activeProjectId).toBe("mobile");
    expect(projects.getProject("website")).toBeNull();
    expect(storage.getItem(projectKeys("website").document)).toBeNull();
    expect(storage.getItem(projectKeys("website").activity)).toBeNull();
    expect(storage.getItem(projectKeys("website").ui)).toBeNull();
  });

  it("allows deleting the last project without reseeding on reload", () => {
    const storage = createMemoryStorage();
    const projects = catalog(storage);
    projects.load();
    expect(projects.deleteProject("website").ok).toBe(true);
    expect(projects.deleteProject("mobile").ok).toBe(true);
    expect(projects.listProjects()).toEqual([]);
    expect(projects.getActiveProjectId()).toBeNull();

    const reopened = catalog(storage);
    const { index, notices } = reopened.load();
    expect(index.projectIds).toEqual([]);
    expect(notices).toEqual([]);
    expect(reopened.listProjects()).toEqual([]);
  });

  it("exports and re-imports a complete project", () => {
    const storage = createMemoryStorage();
    const projects = catalog(storage);
    projects.load();

    const json = projects.exportProject("website");
    expect(json).toBeTruthy();
    const parsed = JSON.parse(json);
    expect(parsed.format).toBe("layers-project");
    expect(parsed.formatVersion).toBe(3);
    expect(parsed.project.name).toBe("Website project");
    expect(parsed.testGuidelines).toContain("npm test");
    expect(parsed.chapters.byId["password-reset"]).toBeDefined();
    expect(parsed.ui.selectedId).toBe("password-reset");

    const result = projects.importProject(json);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe("Website project (imported)");
    expect(result.value.chapterCount).toBe(
      projects.getProject("website").chapterCount,
    );
    expect(projects.getActiveProjectId()).toBe(result.value.id);

    const imported = readJson(storage, projectKeys(result.value.id).document);
    expect(imported.chapters.byId["password-reset"].title).toBe(
      "Password reset",
    );
    const activity = readJson(storage, projectKeys(result.value.id).activity);
    expect(activity.events[0].message).toContain("Imported project");
  });

  it("imports a phase 2 workspace export", () => {
    const storage = createMemoryStorage();
    const projects = catalog(storage);
    projects.load();

    const result = projects.importProject(
      JSON.stringify({
        schemaVersion: 3,
        project: { id: "website", name: "Legacy website", account: "LW" },
        chapters: {
          byId: {
            one: {
              id: "one",
              title: "Legacy chapter",
              criteria: [],
              childIds: [],
            },
          },
          rootIds: ["one"],
        },
        events: [{ id: "e1", message: "Old event", time: fixedNow() }],
        selectedId: "one",
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe("Legacy website (imported)");
    expect(result.value.initials).toBe("LW");
    expect(projects.getProjectGuidelines(result.value.id)).toBe("");
    const document = readJson(storage, projectKeys(result.value.id).document);
    expect(document.chapters.byId.one.title).toBe("Legacy chapter");
    const activity = readJson(storage, projectKeys(result.value.id).activity);
    expect(activity.events.some((event) => event.message === "Old event")).toBe(
      true,
    );
  });

  it("rejects invalid or empty imports", () => {
    const projects = catalog(createMemoryStorage());
    projects.load();
    expect(projects.importProject("{").ok).toBe(false);
    expect(projects.importProject(JSON.stringify({ chapters: [] })).ok).toBe(
      false,
    );
  });

  it("enforces the project limit", () => {
    const storage = createMemoryStorage();
    const projectsMap = {};
    const projectIds = [];
    for (let index = 0; index < MAX_PROJECTS; index += 1) {
      const id = `p-${index}`;
      projectIds.push(id);
      projectsMap[id] = { name: `Project ${index}` };
    }
    storage.setItem(
      STORAGE_KEYS.index,
      JSON.stringify({
        activeProjectId: projectIds[0],
        projectIds,
        projects: projectsMap,
      }),
    );
    const projects = catalog(storage);
    projects.load();
    const result = projects.createProject({ name: "Too many" });
    expect(result.ok).toBe(false);
    expect(result.issues.join(" ")).toContain(String(MAX_PROJECTS));
  });

  it("backs up a corrupt catalog and restores the samples", () => {
    const storage = createMemoryStorage();
    storage.setItem(STORAGE_KEYS.index, "{not json");
    const projects = catalog(storage);
    const { index, notices } = projects.load();

    expect(index.projectIds).toEqual(["website", "mobile"]);
    expect(notices[0].backupKey).toBeTruthy();
    expect(storage.getItem(notices[0].backupKey)).toBe("{not json");
  });

  it("recovers a corrupt project document without losing the catalog entry", () => {
    const storage = createMemoryStorage();
    const projects = catalog(storage);
    projects.load();
    storage.setItem(projectKeys("website").document, "{not json");

    const repository = projects.createProjectRepository("website");
    const { workspace, notices } = repository.load();
    expect(workspace.chapters.rootIds).toEqual([]);
    expect(notices[0].backupKey).toBeTruthy();
    expect(projects.getProject("website")).not.toBeNull();
  });

  it("updates the catalog when a project repository flushes document changes", () => {
    const storage = createMemoryStorage();
    const projects = catalog(storage);
    projects.load();
    const repository = projects.createProjectRepository("website");
    const { workspace } = repository.load();

    const chapters = {
      byId: {
        only: {
          id: "only",
          parentId: null,
          title: "Only",
          description: "",
          finalLevel: false,
          criteria: [{ id: "c1", text: "Criterion", checked: true }],
          childIds: [],
        },
      },
      rootIds: ["only"],
    };
    repository.save(
      { ...workspace, chapters, selectedId: "only" },
      { immediate: true },
    );
    const summary = projects.getProject("website");
    expect(summary.chapterCount).toBe(1);
    expect(summary.criterionCount).toBe(1);
    expect(summary.checkedCount).toBe(1);
    expect(summary.updatedAt).toBe(fixedNow());
  });

  it("refreshes from index changes made by another tab", () => {
    const storage = createMemoryStorage();
    const first = catalog(storage);
    first.load();
    const second = catalog(storage);
    second.load();

    first.createProject({ name: "From another tab" });
    second.handleStorageEvent({ key: STORAGE_KEYS.index });
    expect(second.listProjects().map((project) => project.name)).toContain(
      "From another tab",
    );
  });
});

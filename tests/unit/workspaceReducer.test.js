import { describe, expect, it } from "vitest";
import { createWorkspace, createId } from "../../src/domain/schema.js";
import {
  insertChapter,
  createChapter,
  createEmptyDocument,
} from "../../src/domain/chapters.js";
import {
  IMMEDIATE_ACTIONS,
  workspaceReducer,
} from "../../src/store/workspaceReducer.js";

const time = "2026-01-01T12:00:00.000Z";

function baseState() {
  let chapters = createEmptyDocument();
  chapters = insertChapter(
    chapters,
    createChapter({
      id: "parent",
      title: "Parent",
      criteria: [{ id: "c1", text: "Existing", checked: false }],
    }),
  );
  return createWorkspace({ chapters, selectedId: "parent" });
}

describe("workspace reducer: commits", () => {
  it("links a commit newest first and records activity", () => {
    const state = baseState();
    const next = workspaceReducer(state, {
      type: "addCommit",
      id: "parent",
      hash: "ABC1234",
      activityId: "a1",
      time,
    });

    expect(next.chapters.byId.parent.commits).toEqual(["abc1234"]);
    expect(next.events[0]).toMatchObject({
      id: "a1",
      message: "Linked commit abc1234",
      chapterId: "parent",
      chapterName: "Parent",
      time,
    });
    expect(state.chapters.byId.parent.commits).toEqual([]);
  });

  it("ignores invalid, duplicate and missing-chapter commits", () => {
    const state = baseState();
    expect(
      workspaceReducer(state, {
        type: "addCommit",
        id: "parent",
        hash: "not-a-hash",
      }),
    ).toBe(state);
    expect(
      workspaceReducer(state, {
        type: "addCommit",
        id: "missing",
        hash: "abc1234",
      }),
    ).toBe(state);

    const linked = workspaceReducer(state, {
      type: "addCommit",
      id: "parent",
      hash: "abc1234",
    });
    expect(
      workspaceReducer(linked, {
        type: "addCommit",
        id: "parent",
        hash: "ABC1234",
      }),
    ).toBe(linked);
  });

  it("removes a commit and records activity", () => {
    const linked = workspaceReducer(baseState(), {
      type: "addCommit",
      id: "parent",
      hash: "abc1234",
      activityId: "a1",
      time,
    });
    const next = workspaceReducer(linked, {
      type: "removeCommit",
      id: "parent",
      hash: "ABC1234",
      activityId: "a2",
      time,
    });

    expect(next.chapters.byId.parent.commits).toEqual([]);
    expect(next.events[0]).toMatchObject({
      id: "a2",
      message: "Removed commit abc1234",
      chapterId: "parent",
      chapterName: "Parent",
      time,
    });
    expect(
      workspaceReducer(next, {
        type: "removeCommit",
        id: "parent",
        hash: "abc1234",
      }),
    ).toBe(next);
  });

  it("persists commit actions immediately", () => {
    expect(IMMEDIATE_ACTIONS.has("addCommit")).toBe(true);
    expect(IMMEDIATE_ACTIONS.has("removeCommit")).toBe(true);
  });
});

describe("workspace reducer", () => {
  it("creates chapters with an activity entry and selects them", () => {
    const next = workspaceReducer(baseState(), {
      type: "createChapter",
      id: "new",
      parentId: "parent",
      title: "  New chapter  ",
      activityId: "a1",
      time,
    });

    expect(next.chapters.byId.new.title).toBe("New chapter");
    expect(next.chapters.byId.new.parentId).toBe("parent");
    expect(next.selectedId).toBe("new");
    expect(next.events[0]).toMatchObject({
      id: "a1",
      message: "Created subchapter",
      chapterId: "new",
      time,
    });
  });

  it("ignores empty chapter titles", () => {
    const state = baseState();
    expect(
      workspaceReducer(state, {
        type: "createChapter",
        title: "   ",
        parentId: null,
      }),
    ).toBe(state);
  });

  it("records an added criterion and its subchapter, newest first", () => {
    const next = workspaceReducer(baseState(), {
      type: "addCriterion",
      chapterId: "parent",
      text: "  **Ship it** today  ",
      criterionId: "c2",
      subchapterId: "s1",
      activityId: "a1",
      subchapterActivityId: "a2",
      time,
    });

    expect(next.chapters.byId.parent.criteria.at(-1)).toEqual({
      id: "c2",
      text: "**Ship it** today",
      checked: false,
      chapterId: "s1",
    });
    expect(next.chapters.byId.s1.title).toBe("Ship it today");
    expect(next.events.map((event) => event.message)).toEqual([
      "Created subchapter from success criterion",
      "Added criterion: **Ship it** today",
    ]);
  });

  it("does not create subchapters for final-level chapters", () => {
    const state = workspaceReducer(baseState(), {
      type: "setChapterField",
      id: "parent",
      field: "finalLevel",
      value: true,
    });
    const next = workspaceReducer(state, {
      type: "addCriterion",
      chapterId: "parent",
      text: "Stay here",
      criterionId: "c2",
      subchapterId: "s1",
      activityId: "a1",
      subchapterActivityId: "a2",
      time,
    });

    expect(next.chapters.byId.parent.childIds).toEqual([]);
    expect(next.chapters.byId.s1).toBeUndefined();
    expect(next.events).toHaveLength(1);
  });

  it("logs the previous text when toggling and removing", () => {
    let state = baseState();
    state = workspaceReducer(state, {
      type: "toggleCriterion",
      chapterId: "parent",
      criterionId: "c1",
      activityId: "a1",
      time,
    });
    expect(state.chapters.byId.parent.criteria[0].checked).toBe(true);
    expect(state.events[0].message).toBe("Completed criterion: Existing");

    state = workspaceReducer(state, {
      type: "toggleCriterion",
      chapterId: "parent",
      criterionId: "c1",
      activityId: "a2",
      time,
    });
    expect(state.events[0].message).toBe("Unchecked criterion: Existing");

    state = workspaceReducer(state, {
      type: "removeCriterion",
      chapterId: "parent",
      criterionId: "c1",
      activityId: "a3",
      time,
    });
    expect(state.events[0].message).toBe("Removed criterion: Existing");
    expect(state.chapters.byId.parent.criteria).toEqual([]);
  });

  it("updates chapter verification mode and text", () => {
    let state = workspaceReducer(baseState(), {
      type: "setChapterVerificationMode",
      chapterId: "parent",
      mode: "auto",
      activityId: "a1",
      time,
    });
    expect(state.chapters.byId.parent.verification.mode).toBe("auto");
    expect(state.events[0].message).toBe("Set Auto-test verification: Parent");

    const events = state.events;
    state = workspaceReducer(state, {
      type: "setChapterVerificationText",
      chapterId: "parent",
      field: "auto",
      value: "npm test parent",
    });
    expect(state.chapters.byId.parent.verification.auto.command).toBe(
      "npm test parent",
    );
    expect(state.events).toBe(events);

    state = workspaceReducer(state, {
      type: "setChapterVerificationText",
      chapterId: "parent",
      field: "human",
      value: "Manual check",
    });
    expect(state.chapters.byId.parent.verification.human.instructions).toBe(
      "Manual check",
    );
  });

  it("deletes a chapter subtree and its linked parent criterion", () => {
    let state = baseState();
    state = workspaceReducer(state, {
      type: "addCriterion",
      chapterId: "parent",
      text: "Enter password",
      criterionId: "c2",
      subchapterId: "s1",
      activityId: "a1",
      subchapterActivityId: "a2",
      time,
    });
    state = workspaceReducer(state, {
      type: "addCriterion",
      chapterId: "s1",
      text: "Check 6 digits",
      criterionId: "c3",
      subchapterId: "s2",
      activityId: "a3",
      subchapterActivityId: "a4",
      time,
    });
    expect(state.chapters.byId.parent.criteria.map((item) => item.id)).toEqual([
      "c1",
      "c2",
    ]);

    state = workspaceReducer(state, {
      type: "deleteChapter",
      id: "s1",
      activityId: "a5",
      time,
    });
    expect(state.chapters.byId.s1).toBeUndefined();
    expect(state.chapters.byId.s2).toBeUndefined();
    expect(state.chapters.byId.parent.criteria.map((item) => item.id)).toEqual([
      "c1",
    ]);
    expect(state.selectedId).toBe("parent");
    expect(state.events[0]).toMatchObject({
      message: "Deleted chapter: Enter password",
      chapterId: null,
      chapterName: "Enter password",
    });
  });

  it("caps activity at one hundred entries", () => {
    let state = baseState();
    for (let index = 0; index < 120; index += 1) {
      state = workspaceReducer(state, {
        type: "logActivity",
        message: `Entry ${index}`,
        id: `e${index}`,
        time,
      });
    }
    expect(state.events).toHaveLength(100);
    expect(state.events[0].message).toBe("Entry 119");
  });

  it("validates fields and unknown chapters", () => {
    const state = baseState();
    expect(
      workspaceReducer(state, {
        type: "setChapterField",
        id: "parent",
        field: "unknown",
        value: "x",
      }),
    ).toBe(state);
    expect(
      workspaceReducer(state, {
        type: "setChapterField",
        id: "missing",
        field: "title",
        value: "x",
      }),
    ).toBe(state);
    expect(workspaceReducer(state, { type: "select", id: "missing" })).toBe(
      state,
    );
    expect(workspaceReducer(state, { type: "select", id: "parent" })).toBe(
      state,
    );
  });

  it("keeps an existing chapters edit identity for unrelated fields", () => {
    const state = baseState();
    const next = workspaceReducer(state, {
      type: "setChapterField",
      id: "parent",
      field: "description",
      value: "Text",
    });
    expect(next.chapters.byId.parent.description).toBe("Text");
    expect(next.chapters.byId.parent.criteria).toBe(
      state.chapters.byId.parent.criteria,
    );
    expect(next.events).toBe(state.events);
  });

  it("replaces only the activity history for canonical server events", () => {
    const state = baseState();
    const events = [
      {
        id: "server-1",
        message: "Server event",
        chapterId: null,
        chapterName: "Parent",
        time,
      },
    ];
    const next = workspaceReducer(state, { type: "replaceActivity", events });
    expect(next.events).toEqual(events);
    expect(next.chapters).toBe(state.chapters);
    expect(next.selectedId).toBe(state.selectedId);
  });

  it("replaces the workspace on import and repairs the selection", () => {
    const next = workspaceReducer(baseState(), {
      type: "replaceWorkspace",
      workspace: createWorkspace({
        chapters: insertChapter(
          createEmptyDocument(),
          createChapter({ id: "only", title: "Only" }),
        ),
        selectedId: "gone",
      }),
    });
    expect(next.selectedId).toBe("only");
    expect(next.chapters.rootIds).toEqual(["only"]);
  });

  it("generates ids when callers omit them", () => {
    const next = workspaceReducer(baseState(), {
      type: "logActivity",
      message: "No explicit id",
    });
    expect(next.events[0].id).toBeTruthy();
    expect(next.events[0].chapterName).toBe("Parent");
    expect(createId()).not.toBe(createId());
  });
});

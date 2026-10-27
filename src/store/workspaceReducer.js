import { appendActivity, createActivityEntry } from "../domain/activity.js";
import {
  createChapter,
  getChapter,
  getDefaultId,
  insertChapter,
  patchChapter,
} from "../domain/chapters.js";
import {
  addCriterion as addCriterionToDocument,
  createCriterion,
  createSubchapterFromCriterion,
  patchCriterion,
  removeCriterion as removeCriterionFromDocument,
  toggleCriterion as toggleCriterionInDocument,
} from "../domain/criteria.js";
import { createId } from "../domain/schema.js";

/**
 * @typedef {import("../domain/schema.js").Workspace} Workspace
 * @typedef {import("../domain/chapters.js").Chapter} Chapter
 */

/**
 * Actions that are written to storage synchronously. Text editing is the only
 * debounced case; structural changes and checkboxes are small and must survive
 * an immediate reload.
 */
export const IMMEDIATE_ACTIONS = new Set([
  "createChapter",
  "addCriterion",
  "setCriterionText",
  "toggleCriterion",
  "removeCriterion",
  "logActivity",
  "replaceWorkspace",
]);

const nowIso = () => new Date().toISOString();

/**
 * @param {Workspace} state
 * @param {string|null} chapterId
 * @returns {Chapter|null}
 */
function chapterOf(state, chapterId) {
  return getChapter(state.chapters, chapterId);
}

/**
 * @param {Workspace} state
 * @param {{ id?: string, message: string, chapterId?: string|null, chapterName?: string, time?: string }} input
 * @returns {Workspace}
 */
function withActivity(state, input) {
  const chapterId = input.chapterId ?? state.selectedId;
  const chapter = chapterOf(state, chapterId);
  const entry = createActivityEntry({
    id: input.id ?? createId(),
    message: input.message,
    chapterId,
    chapterName: input.chapterName ?? chapter?.title ?? "Untitled chapter",
    time: input.time ?? nowIso(),
  });
  return { ...state, events: appendActivity(state.events, entry) };
}

/**
 * @param {Workspace} state
 * @param {any} action
 * @returns {Workspace}
 */
export function workspaceReducer(state, action) {
  switch (action.type) {
    case "select": {
      if (!action.id || !state.chapters.byId[action.id]) return state;
      if (state.selectedId === action.id) return state;
      return { ...state, selectedId: action.id };
    }

    case "createChapter": {
      const title = String(action.title ?? "").trim();
      if (!title) return state;
      const chapter = createChapter({
        id: action.id ?? createId(),
        parentId: action.parentId ?? null,
        title,
        description: action.description ?? "",
      });
      const chapters = insertChapter(state.chapters, chapter);
      if (chapters === state.chapters) return state;
      const next = { ...state, chapters, selectedId: chapter.id };
      return withActivity(next, {
        id: action.activityId,
        message: chapter.parentId ? "Created subchapter" : "Created chapter",
        chapterId: chapter.id,
        chapterName: chapter.title,
        time: action.time,
      });
    }

    case "setChapterField": {
      if (!["title", "description", "finalLevel"].includes(action.field)) {
        return state;
      }
      const current = chapterOf(state, action.id);
      if (!current) return state;
      const value =
        action.field === "finalLevel"
          ? Boolean(action.value)
          : String(action.value);
      const currentValue =
        action.field === "finalLevel"
          ? current.finalLevel
          : action.field === "title"
            ? current.title
            : current.description;
      if (currentValue === value) return state;
      const chapters = patchChapter(state.chapters, action.id, {
        [action.field]: value,
      });
      return { ...state, chapters };
    }

    case "logActivity":
      return withActivity(state, action);

    case "addCriterion": {
      const text = String(action.text ?? "").trim();
      if (!text) return state;
      const chapter = chapterOf(state, action.chapterId);
      if (!chapter) return state;

      const criterion = createCriterion({
        id: action.criterionId ?? createId(),
        text,
      });
      const subchapter =
        chapter.finalLevel || action.createSubchapter === false
          ? null
          : createSubchapterFromCriterion({
              id: action.subchapterId ?? createId(),
              text,
            });

      const chapters = addCriterionToDocument(
        state.chapters,
        chapter.id,
        criterion,
        subchapter,
      );
      const next = { ...state, chapters };
      const added = withActivity(next, {
        id: action.activityId,
        message: `Added criterion: ${text}`,
        chapterId: chapter.id,
        chapterName: chapter.title,
        time: action.time,
      });
      if (!subchapter) return added;
      return withActivity(added, {
        id: action.subchapterActivityId,
        message: "Created subchapter from success criterion",
        chapterId: subchapter.id,
        chapterName: subchapter.title,
        time: action.time,
      });
    }

    case "setCriterionText": {
      const current = chapterOf(state, action.chapterId)?.criteria.find(
        (criterion) => criterion.id === action.criterionId,
      );
      if (!current) return state;
      const text = String(action.text ?? "");
      if (current.text === text) return state;
      return {
        ...state,
        chapters: patchCriterion(
          state.chapters,
          action.chapterId,
          action.criterionId,
          {
            text,
          },
        ),
      };
    }

    case "toggleCriterion": {
      const current = chapterOf(state, action.chapterId)?.criteria.find(
        (criterion) => criterion.id === action.criterionId,
      );
      if (!current) return state;
      const chapters = toggleCriterionInDocument(
        state.chapters,
        action.chapterId,
        action.criterionId,
      );
      return withActivity(
        { ...state, chapters },
        {
          id: action.activityId,
          message: `${current.checked ? "Unchecked" : "Completed"} criterion: ${current.text}`,
          chapterId: action.chapterId,
          chapterName: chapterOf(state, action.chapterId)?.title,
          time: action.time,
        },
      );
    }

    case "removeCriterion": {
      const current = chapterOf(state, action.chapterId)?.criteria.find(
        (criterion) => criterion.id === action.criterionId,
      );
      if (!current) return state;
      const chapters = removeCriterionFromDocument(
        state.chapters,
        action.chapterId,
        action.criterionId,
      );
      if (chapters === state.chapters) return state;
      return withActivity(
        { ...state, chapters },
        {
          id: action.activityId,
          message: `Removed criterion: ${current.text}`,
          chapterId: action.chapterId,
          chapterName: chapterOf(state, action.chapterId)?.title,
          time: action.time,
        },
      );
    }

    case "replaceWorkspace": {
      const workspace = action.workspace;
      if (!workspace) return state;
      return {
        ...workspace,
        selectedId: getDefaultId(workspace.chapters, workspace.selectedId),
      };
    }

    default:
      return state;
  }
}

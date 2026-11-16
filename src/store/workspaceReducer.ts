import {
  appendActivity,
  createActivityEntry,
  type ActivityEntry,
} from "../domain/activity";
import {
  Chapter,
  createChapter,
  deleteSubtree,
  getChapter,
  getDefaultId,
  insertChapter,
  patchChapter,
} from "../domain/chapters";
import {
  addCommit as addCommitToChapter,
  normalizeCommitHash,
  removeCommit as removeCommitFromChapter,
} from "../domain/commits";
import {
  addCriterion as addCriterionToDocument,
  createCriterion,
  createSubchapterFromCriterion,
  patchCriterion,
  removeCriterion as removeCriterionFromDocument,
  toggleCriterion as toggleCriterionInDocument,
} from "../domain/criteria";
import { createId, Workspace } from "../domain/schema";
import {
  VerificationMode,
  VerificationTextField,
  verificationModeLabel,
} from "../domain/verification";

export type { Workspace, Chapter };

/**
 * Actions that are written to storage synchronously. Text editing is the only
 * debounced case; structural changes and checkboxes are small and must survive
 * an immediate reload.
 */
export const IMMEDIATE_ACTIONS = new Set<string>([
  "createChapter",
  "deleteChapter",
  "addCriterion",
  "setCriterionText",
  "setChapterVerificationMode",
  "addCommit",
  "removeCommit",
  "toggleCriterion",
  "removeCriterion",
  "logActivity",
  "replaceWorkspace",
]);

const nowIso = () => new Date().toISOString();

function chapterOf(state: Workspace, chapterId: string | null): Chapter | null {
  return getChapter(state.chapters, chapterId);
}

interface ActivityInput {
  id?: string;
  message: string;
  chapterId?: string | null;
  chapterName?: string;
  time?: string;
}

function withActivity(state: Workspace, input: ActivityInput): Workspace {
  const chapterId =
    input.chapterId === undefined ? state.selectedId : input.chapterId;
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

export type WorkspaceAction =
  | { type: "select"; id: string }
  | {
      type: "createChapter";
      id?: string;
      parentId?: string | null;
      title: string;
      description?: string;
      activityId?: string;
      time?: string;
    }
  | {
      type: "setChapterField";
      id: string;
      field: "title" | "description" | "finalLevel" | string;
      value: string | boolean;
    }
  | {
      type: "deleteChapter";
      id: string;
      activityId?: string;
      time?: string;
    }
  | {
      type: "addCommit";
      id: string;
      hash: string;
      activityId?: string;
      time?: string;
    }
  | {
      type: "removeCommit";
      id: string;
      hash: string;
      activityId?: string;
      time?: string;
    }
  | {
      type: "logActivity";
      message: string;
      chapterId?: string | null;
      chapterName?: string;
      id?: string;
      time?: string;
    }
  | {
      type: "addCriterion";
      chapterId: string;
      text: string;
      criterionId?: string;
      subchapterId?: string;
      createSubchapter?: boolean;
      activityId?: string;
      subchapterActivityId?: string;
      time?: string;
    }
  | {
      type: "setCriterionText";
      chapterId: string;
      criterionId: string;
      text: string;
    }
  | {
      type: "setChapterVerificationMode";
      chapterId: string;
      mode: VerificationMode;
      activityId?: string;
      time?: string;
    }
  | {
      type: "setChapterVerificationText";
      chapterId: string;
      field: VerificationTextField;
      value: string;
    }
  | {
      type: "toggleCriterion";
      chapterId: string;
      criterionId: string;
      activityId?: string;
      time?: string;
    }
  | {
      type: "removeCriterion";
      chapterId: string;
      criterionId: string;
      activityId?: string;
      time?: string;
    }
  | {
      type: "replaceActivity";
      events: ActivityEntry[];
    }
  | {
      type: "replaceWorkspace";
      workspace: Workspace;
    };

export function workspaceReducer(
  state: Workspace,
  action: WorkspaceAction,
): Workspace {
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

    case "deleteChapter": {
      const current = chapterOf(state, action.id);
      if (!current) return state;
      const { document, removedIds } = deleteSubtree(state.chapters, action.id);
      if (!removedIds.length) return state;
      const selectedId = getDefaultId(document, current.parentId);
      return withActivity(
        { ...state, chapters: document, selectedId },
        {
          id: action.activityId,
          message: `Deleted chapter: ${current.title}`,
          chapterId: null,
          chapterName: current.title,
          time: action.time,
        },
      );
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

    case "addCommit": {
      const current = chapterOf(state, action.id);
      const hash = normalizeCommitHash(action.hash);
      if (!current || !hash) return state;
      const commits = addCommitToChapter(current.commits, hash);
      if (commits === current.commits) return state;
      const chapters = patchChapter(state.chapters, action.id, { commits });
      return withActivity(
        { ...state, chapters },
        {
          id: action.activityId,
          message: `Linked commit ${hash}`,
          chapterId: action.id,
          chapterName: current.title,
          time: action.time,
        },
      );
    }

    case "removeCommit": {
      const current = chapterOf(state, action.id);
      const hash = normalizeCommitHash(action.hash);
      if (!current || !hash) return state;
      const commits = removeCommitFromChapter(current.commits, hash);
      if (commits === current.commits) return state;
      const chapters = patchChapter(state.chapters, action.id, { commits });
      return withActivity(
        { ...state, chapters },
        {
          id: action.activityId,
          message: `Removed commit ${hash}`,
          chapterId: action.id,
          chapterName: current.title,
          time: action.time,
        },
      );
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

    case "setChapterVerificationMode": {
      const current = chapterOf(state, action.chapterId);
      if (!current || current.verification.mode === action.mode) return state;
      const chapters = patchChapter(state.chapters, action.chapterId, {
        verification: { ...current.verification, mode: action.mode },
      });
      if (chapters === state.chapters) return state;
      return withActivity(
        { ...state, chapters },
        {
          id: action.activityId,
          message: `Set ${verificationModeLabel(action.mode)} verification: ${current.title}`,
          chapterId: action.chapterId,
          chapterName: current.title,
          time: action.time,
        },
      );
    }

    case "setChapterVerificationText": {
      const current = chapterOf(state, action.chapterId);
      if (!current) return state;
      const currentValue =
        action.field === "auto"
          ? current.verification.auto.command
          : action.field === "human"
            ? current.verification.human.instructions
            : current.verification.ai.instructions;
      if (currentValue === action.value) return state;
      const verification =
        action.field === "auto"
          ? {
              ...current.verification,
              auto: { ...current.verification.auto, command: action.value },
            }
          : action.field === "human"
            ? {
                ...current.verification,
                human: {
                  ...current.verification.human,
                  instructions: action.value,
                },
              }
            : {
                ...current.verification,
                ai: {
                  ...current.verification.ai,
                  instructions: action.value,
                },
              };
      return {
        ...state,
        chapters: patchChapter(state.chapters, action.chapterId, {
          verification,
        }),
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

    case "replaceActivity": {
      return { ...state, events: action.events.slice(0, 100) };
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

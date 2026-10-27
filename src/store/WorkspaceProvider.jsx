import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  downloadJson,
  createRepository,
  STORAGE_STATUS,
} from "./persistence.js";
import { IMMEDIATE_ACTIONS, workspaceReducer } from "./workspaceReducer.js";
import { createId } from "../domain/schema.js";

/** @typedef {import("../domain/schema.js").Workspace} Workspace */

const WorkspaceContext = createContext(null);

/**
 * Only checkbox/structural edits bypass the debounce. Typing in the title or
 * description is debounced so a large document is not serialized per keystroke.
 *
 * @param {{ type: string, field?: string }} action
 * @returns {boolean}
 */
function shouldSaveImmediately(action) {
  if (action.type === "setChapterField") return action.field === "finalLevel";
  return IMMEDIATE_ACTIONS.has(action.type);
}

/**
 * @param {{
 *   repository?: ReturnType<typeof createRepository>,
 *   children: React.ReactNode,
 * }} props
 */
export function WorkspaceProvider({
  repository: providedRepository,
  children,
}) {
  const [repository] = useState(() => providedRepository ?? createRepository());
  const [initial] = useState(() => repository.load());
  const [state, rawDispatch] = useReducer(workspaceReducer, initial.workspace);
  const [status, setStatus] = useState(() => repository.status());
  const [notices, setNotices] = useState(() => initial.notices);
  const lastAction = useRef(/** @type {any} */ (null));
  const skipNextSave = useRef(true);

  const dispatch = useCallback((action) => {
    lastAction.current = action;
    rawDispatch(action);
  }, []);

  useEffect(() => {
    const unsubscribe = repository.onStatusChange((next) => setStatus(next));
    return unsubscribe;
  }, [repository]);

  useEffect(() => {
    const unsubscribe = repository.subscribe(({ workspace, notices: next }) => {
      if (workspace) {
        lastAction.current = { type: "replaceWorkspace" };
        rawDispatch({ type: "replaceWorkspace", workspace });
      }
      if (next?.length) setNotices(next);
    });
    return unsubscribe;
  }, [repository]);

  useEffect(() => {
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    repository.save(state, {
      immediate: shouldSaveImmediately(lastAction.current ?? {}),
    });
  }, [state, repository]);

  useEffect(() => {
    return () => {
      repository.flush();
    };
  }, [repository]);

  const actions = useMemo(
    () => ({
      select: (id) => dispatch({ type: "select", id }),
      createChapter: ({ id = createId(), parentId = null, title }) => {
        dispatch({
          type: "createChapter",
          id,
          parentId,
          title,
          activityId: createId(),
          time: new Date().toISOString(),
        });
        return id;
      },
      setChapterField: (id, field, value) =>
        dispatch({ type: "setChapterField", id, field, value }),
      addCriterion: (chapterId, text) =>
        dispatch({
          type: "addCriterion",
          chapterId,
          text,
          criterionId: createId(),
          subchapterId: createId(),
          activityId: createId(),
          subchapterActivityId: createId(),
          time: new Date().toISOString(),
        }),
      setCriterionText: (chapterId, criterionId, text) =>
        dispatch({ type: "setCriterionText", chapterId, criterionId, text }),
      toggleCriterion: (chapterId, criterionId) =>
        dispatch({
          type: "toggleCriterion",
          chapterId,
          criterionId,
          activityId: createId(),
          time: new Date().toISOString(),
        }),
      removeCriterion: (chapterId, criterionId) =>
        dispatch({
          type: "removeCriterion",
          chapterId,
          criterionId,
          activityId: createId(),
          time: new Date().toISOString(),
        }),
      logActivity: (message, { chapterId, chapterName } = {}) =>
        dispatch({
          type: "logActivity",
          message,
          chapterId,
          chapterName,
          id: createId(),
          time: new Date().toISOString(),
        }),
      dismissNotices: () => setNotices([]),
      retrySave: () => repository.flush(),
      flushSave: () => repository.flush(),
      importWorkspace: (text) => {
        const { workspace, issues } = repository.parseImport(text);
        if (!workspace.chapters.rootIds.length) {
          return {
            ok: false,
            issues: issues.length ? issues : ["The file has no chapters."],
          };
        }
        lastAction.current = { type: "replaceWorkspace" };
        rawDispatch({ type: "replaceWorkspace", workspace });
        if (issues.length) {
          setNotices([
            {
              level: "info",
              message: `Imported workspace with repairs: ${issues.slice(0, 3).join(" ")}`,
            },
          ]);
        }
        return { ok: true, issues };
      },
    }),
    [dispatch, repository],
  );

  const exportWorkspace = useCallback(() => {
    downloadJson(repository.exportWorkspace(state));
  }, [repository, state]);

  const value = useMemo(
    () => ({
      state,
      status,
      notices,
      project: state.project,
      ...actions,
      exportWorkspace,
    }),
    [state, status, notices, actions, exportWorkspace],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error("useWorkspace must be used inside a WorkspaceProvider.");
  }
  return context;
}

export { STORAGE_STATUS };

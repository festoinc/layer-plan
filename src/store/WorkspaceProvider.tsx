import {
  createContext,
  ReactNode,
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
  Repository,
  StorageNotice,
  RepositoryStatus,
} from "./persistence";
import {
  IMMEDIATE_ACTIONS,
  workspaceReducer,
  WorkspaceAction,
} from "./workspaceReducer";
import { createId, Project, Workspace } from "../domain/schema";

export interface WorkspaceActions {
  select: (id: string) => void;
  createChapter: (input: {
    id?: string;
    parentId?: string | null;
    title: string;
  }) => string;
  setChapterField: (
    id: string,
    field: "title" | "description" | "finalLevel" | string,
    value: string | boolean,
  ) => void;
  addCriterion: (chapterId: string, text: string) => void;
  setCriterionText: (
    chapterId: string,
    criterionId: string,
    text: string,
  ) => void;
  toggleCriterion: (chapterId: string, criterionId: string) => void;
  removeCriterion: (chapterId: string, criterionId: string) => void;
  logActivity: (
    message: string,
    options?: { chapterId?: string | null; chapterName?: string },
  ) => void;
  dismissNotices: () => void;
  retrySave: () => void;
  flushSave: () => void;
  importWorkspace: (text: string) => { ok: boolean; issues: string[] };
  exportWorkspace: () => void;
}

export interface WorkspaceStatusContextValue {
  status: RepositoryStatus;
  notices: StorageNotice[];
}

export interface WorkspaceContextValue extends WorkspaceActions {
  state: Workspace;
  status: RepositoryStatus;
  notices: StorageNotice[];
  project: Project;
}

const WorkspaceStateContext = createContext<Workspace | null>(null);
const WorkspaceActionsContext = createContext<WorkspaceActions | null>(null);
const WorkspaceStatusContext =
  createContext<WorkspaceStatusContextValue | null>(null);

function shouldSaveImmediately(action: {
  type?: string;
  field?: string;
}): boolean {
  if (action.type === "setChapterField") return action.field === "finalLevel";
  return Boolean(action.type && IMMEDIATE_ACTIONS.has(action.type));
}

export interface WorkspaceProviderProps {
  repository?: Repository;
  children: ReactNode;
}

export function WorkspaceProvider({
  repository: providedRepository,
  children,
}: WorkspaceProviderProps) {
  const [repository] = useState(() => providedRepository ?? createRepository());
  const [initial] = useState(() => repository.load());
  const [state, rawDispatch] = useReducer(workspaceReducer, initial.workspace);
  const [status, setStatus] = useState(() => repository.status());
  const [notices, setNotices] = useState(() => initial.notices);
  const lastAction = useRef<WorkspaceAction | null>(null);
  const skipNextSave = useRef(true);
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const dispatch = useCallback((action: WorkspaceAction) => {
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
        lastAction.current = { type: "replaceWorkspace", workspace };
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

  const exportWorkspace = useCallback(() => {
    downloadJson(repository.exportWorkspace(stateRef.current));
  }, [repository]);

  const actions: WorkspaceActions = useMemo(
    () => ({
      select: (id: string) => dispatch({ type: "select", id }),
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
        lastAction.current = { type: "replaceWorkspace", workspace };
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
      exportWorkspace,
    }),
    [dispatch, repository, exportWorkspace],
  );

  const statusValue = useMemo<WorkspaceStatusContextValue>(
    () => ({ status, notices }),
    [status, notices],
  );

  return (
    <WorkspaceActionsContext.Provider value={actions}>
      <WorkspaceStatusContext.Provider value={statusValue}>
        <WorkspaceStateContext.Provider value={state}>
          {children}
        </WorkspaceStateContext.Provider>
      </WorkspaceStatusContext.Provider>
    </WorkspaceActionsContext.Provider>
  );
}

export function useWorkspaceState(): Workspace {
  const context = useContext(WorkspaceStateContext);
  if (!context) {
    throw new Error(
      "useWorkspaceState must be used inside a WorkspaceProvider.",
    );
  }
  return context;
}

export function useWorkspaceActions(): WorkspaceActions {
  const context = useContext(WorkspaceActionsContext);
  if (!context) {
    throw new Error(
      "useWorkspaceActions must be used inside a WorkspaceProvider.",
    );
  }
  return context;
}

export function useWorkspaceStatus(): WorkspaceStatusContextValue {
  const context = useContext(WorkspaceStatusContext);
  if (!context) {
    throw new Error(
      "useWorkspaceStatus must be used inside a WorkspaceProvider.",
    );
  }
  return context;
}

export function useWorkspace(): WorkspaceContextValue {
  const state = useWorkspaceState();
  const { status, notices } = useWorkspaceStatus();
  const actions = useWorkspaceActions();
  return useMemo(
    () => ({
      state,
      status,
      notices,
      project: state.project,
      ...actions,
    }),
    [state, status, notices, actions],
  );
}

export { STORAGE_STATUS };

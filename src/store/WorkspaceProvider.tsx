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
  createProjectRepository,
  STORAGE_STATUS,
  ProjectRepository,
  StorageNotice,
  RepositoryStatus,
} from "./persistence";
import {
  IMMEDIATE_ACTIONS,
  workspaceReducer,
  WorkspaceAction,
} from "./workspaceReducer";
import { createId, Workspace } from "../domain/schema";

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
}

export interface WorkspaceStatusContextValue {
  status: RepositoryStatus;
  notices: StorageNotice[];
}

export interface WorkspaceContextValue extends WorkspaceActions {
  state: Workspace;
  status: RepositoryStatus;
  notices: StorageNotice[];
  projectId: string;
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
  repository?: ProjectRepository;
  repositoryFactory?: (projectId: string) => ProjectRepository;
  projectId?: string;
  children: ReactNode;
}

export function WorkspaceProvider({
  repository: providedRepository,
  repositoryFactory,
  projectId,
  children,
}: WorkspaceProviderProps) {
  const [repository] = useState(() => {
    if (providedRepository) return providedRepository;
    if (repositoryFactory && projectId) return repositoryFactory(projectId);
    return createProjectRepository({ projectId: projectId ?? "" });
  });
  const [initial] = useState(() => repository.load());
  const [state, rawDispatch] = useReducer(workspaceReducer, initial.workspace);
  const [status, setStatus] = useState(() => repository.status());
  const [notices, setNotices] = useState(() => initial.notices);
  const lastAction = useRef<WorkspaceAction | null>(null);
  const skipNextSave = useRef(true);

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
      repository.dispose();
    };
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
    }),
    [dispatch, repository],
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
      projectId: state.projectId,
      ...actions,
    }),
    [state, status, notices, actions],
  );
}

export { STORAGE_STATUS };

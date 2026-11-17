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
import { errorMessage, isRevisionConflict } from "../api/client";
import type {
  ApiNotice,
  DocumentResponse,
  WorkspaceStatus,
} from "../api/types";
import { getActivity, getDocument, saveDocument } from "../api/workspace";
import type { ActivityEntry } from "../domain/activity";
import type { ChapterDocument } from "../domain/chapters";
import { applyCreatedSubchapters } from "../domain/criteria";
import { createId, createWorkspace, Workspace } from "../domain/schema";
import {
  VerificationMode,
  VerificationTextField,
} from "../domain/verification";
import {
  IMMEDIATE_ACTIONS,
  workspaceReducer,
  WorkspaceAction,
} from "./workspaceReducer";

export interface WorkspaceActions {
  select: (id: string) => void;
  createChapter: (input: {
    id?: string;
    parentId?: string | null;
    title: string;
  }) => string;
  deleteChapter: (id: string) => void;
  setChapterField: (
    id: string,
    field: "title" | "description" | "finalLevel" | string,
    value: string | boolean,
  ) => void;
  addCriterion: (chapterId: string, text: string) => void;
  addCommit: (chapterId: string, hash: string) => void;
  removeCommit: (chapterId: string, hash: string) => void;
  setCriterionText: (
    chapterId: string,
    criterionId: string,
    text: string,
  ) => void;
  setChapterVerificationMode: (
    chapterId: string,
    mode: VerificationMode,
  ) => void;
  setChapterVerificationText: (
    chapterId: string,
    field: VerificationTextField,
    value: string,
  ) => void;
  toggleCriterion: (chapterId: string, criterionId: string) => void;
  removeCriterion: (chapterId: string, criterionId: string) => void;
  logActivity: (
    message: string,
    options?: { chapterId?: string | null; chapterName?: string },
  ) => void;
  dismissNotices: () => void;
  retrySave: () => Promise<void>;
  flushSave: () => Promise<void>;
  reloadFromServer: () => Promise<void>;
  overwriteServer: () => Promise<void>;
}

export interface WorkspaceStatusContextValue {
  status: WorkspaceStatus;
  notices: ApiNotice[];
}

export interface WorkspaceContextValue extends WorkspaceActions {
  state: Workspace;
  status: WorkspaceStatus;
  notices: ApiNotice[];
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
  projectId: string;
  children: ReactNode;
}

export function WorkspaceProvider({
  projectId,
  children,
}: WorkspaceProviderProps) {
  const [state, rawDispatch] = useReducer(
    workspaceReducer,
    createWorkspace({ projectId }),
  );
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<WorkspaceStatus>({
    state: "loading",
    message: "Loading project…",
  });
  const [notices, setNotices] = useState<ApiNotice[]>([]);

  const stateRef = useRef(state);
  const revisionRef = useRef(0);
  const acknowledgedEvents = useRef<Set<string>>(new Set());
  const lastSavedRef = useRef<{
    chapters: ChapterDocument;
    selectedId: string | null;
  } | null>(null);
  const pendingRef = useRef<Workspace | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const conflictRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAction = useRef<WorkspaceAction | null>(null);
  const skipNextSave = useRef(true);
  const mounted = useRef(true);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const dispatch = useCallback((action: WorkspaceAction) => {
    lastAction.current = action;
    rawDispatch(action);
  }, []);

  const addNotice = useCallback((notice: ApiNotice) => {
    setNotices((previous) => [notice, ...previous]);
  }, []);

  const load = useCallback(async () => {
    setLoaded(false);
    setLoadError(null);
    setStatus({ state: "loading", message: "Loading project…" });
    try {
      const document = await getDocument(projectId);
      let events: ActivityEntry[] = [];
      try {
        events = await getActivity(projectId);
      } catch {
        setNotices([
          {
            level: "warning",
            message:
              "The document loaded, but activity could not be loaded from the local API.",
          },
        ]);
      }
      revisionRef.current = document.revision;
      acknowledgedEvents.current = new Set(events.map((event) => event.id));
      lastSavedRef.current = {
        chapters: document.chapters,
        selectedId: document.selectedId,
      };
      conflictRef.current = false;
      pendingRef.current = null;
      const workspace = createWorkspace({
        projectId,
        chapters: document.chapters,
        events,
        selectedId: document.selectedId,
      });
      lastAction.current = { type: "replaceWorkspace", workspace };
      rawDispatch({ type: "replaceWorkspace", workspace });
      skipNextSave.current = true;
      setLoaded(true);
      setStatus({
        state: "saved",
        message: "Saved to the local API.",
      });
    } catch (caught) {
      setLoadError(errorMessage(caught));
      setStatus({ state: "error", message: errorMessage(caught) });
    }
  }, [projectId]);

  useEffect(() => {
    mounted.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    return () => {
      mounted.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      pendingRef.current = null;
    };
  }, [load]);

  const runSave = useCallback(
    async (snapshot: Workspace, keepalive = false) => {
      const newActivity = snapshot.events
        .filter((event) => !acknowledgedEvents.current.has(event.id))
        .map((event) => ({
          id: event.id,
          message: event.message,
          chapterId: event.chapterId,
          chapterName: event.chapterName,
        }));

      const response = await saveDocument(
        projectId,
        revisionRef.current,
        {
          chapters: snapshot.chapters,
          selectedId: snapshot.selectedId,
          activity: newActivity.length ? newActivity : undefined,
        },
        { keepalive },
      );

      revisionRef.current = response.revision;
      const current = stateRef.current;
      const created = response.createdSubchapters ?? [];
      const nextChapters = created.length
        ? current.chapters === snapshot.chapters
          ? response.chapters
          : applyCreatedSubchapters(
              current.chapters,
              created,
              response.chapters,
            )
        : current.chapters;
      lastSavedRef.current = {
        chapters: created.length ? response.chapters : snapshot.chapters,
        selectedId: created.length ? response.selectedId : snapshot.selectedId,
      };
      acknowledgedEvents.current = new Set(
        response.activity.map((event) => event.id),
      );

      if (pendingRef.current && created.length) {
        pendingRef.current = {
          ...pendingRef.current,
          chapters: applyCreatedSubchapters(
            pendingRef.current.chapters,
            created,
            response.chapters,
          ),
        };
      }
      if (nextChapters !== current.chapters) {
        lastAction.current = {
          type: "applyServerChapters",
          chapters: nextChapters,
        };
        rawDispatch({
          type: "applyServerChapters",
          chapters: nextChapters,
        });
      }

      const snapshotIds = new Set(snapshot.events.map((event) => event.id));
      const responseIds = new Set(response.activity.map((event) => event.id));
      const newer = current.events.filter(
        (event) => !snapshotIds.has(event.id) && !responseIds.has(event.id),
      );
      const merged = [...newer, ...response.activity].slice(0, 100);
      lastAction.current = { type: "replaceActivity", events: merged };
      rawDispatch({ type: "replaceActivity", events: merged });
    },
    [projectId],
  );

  const flush = useCallback(
    async (options: { keepalive?: boolean } = {}) => {
      if (!loaded || conflictRef.current) return;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (inFlightRef.current) await inFlightRef.current;

      while (pendingRef.current && !conflictRef.current) {
        const snapshot = pendingRef.current;
        pendingRef.current = null;
        setStatus({ state: "pending", message: "Saving changes…" });

        const task = (async () => {
          try {
            await runSave(snapshot, options.keepalive);
          } finally {
            inFlightRef.current = null;
          }
        })();
        inFlightRef.current = task;

        try {
          await task;
        } catch (caught) {
          if (isRevisionConflict(caught)) {
            conflictRef.current = true;
            pendingRef.current = null;
            setStatus({
              state: "conflict",
              message:
                "This project changed in another tab or client. Reload the latest version or overwrite it.",
            });
          } else {
            pendingRef.current = stateRef.current;
            setStatus({ state: "error", message: errorMessage(caught) });
          }
          return;
        }
      }

      if (!pendingRef.current && !conflictRef.current && mounted.current) {
        setStatus({ state: "saved", message: "Saved to the local API." });
      }
    },
    [loaded, runSave],
  );

  const scheduleSave = useCallback(
    (workspace: Workspace, immediate: boolean) => {
      if (conflictRef.current) return;
      pendingRef.current = workspace;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (immediate) {
        timerRef.current = null;
        void flush();
        return;
      }
      setStatus({ state: "pending", message: "Saving changes…" });
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void flush();
      }, 250);
    },
    [flush],
  );

  useEffect(() => {
    if (!loaded) return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    const saved = lastSavedRef.current;
    const documentChanged =
      !saved ||
      state.chapters !== saved.chapters ||
      state.selectedId !== saved.selectedId;
    const hasNewActivity = state.events.some(
      (event) => !acknowledgedEvents.current.has(event.id),
    );
    if (!documentChanged && !hasNewActivity) return;
    if (lastAction.current?.type === "replaceActivity") {
      scheduleSave(state, false);
      return;
    }
    scheduleSave(state, shouldSaveImmediately(lastAction.current ?? {}));
  }, [state, loaded, scheduleSave]);

  const applyServerWorkspace = useCallback(
    (document: DocumentResponse, events: ActivityEntry[]) => {
      revisionRef.current = document.revision;
      acknowledgedEvents.current = new Set(events.map((event) => event.id));
      lastSavedRef.current = {
        chapters: document.chapters,
        selectedId: document.selectedId,
      };
      const workspace = createWorkspace({
        projectId,
        chapters: document.chapters,
        events,
        selectedId: document.selectedId,
      });
      lastAction.current = { type: "replaceWorkspace", workspace };
      rawDispatch({ type: "replaceWorkspace", workspace });
      skipNextSave.current = true;
    },
    [projectId],
  );

  const reloadFromServer = useCallback(async () => {
    try {
      const document = await getDocument(projectId);
      const events = await getActivity(projectId).catch(
        () => stateRef.current.events,
      );
      conflictRef.current = false;
      pendingRef.current = null;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      applyServerWorkspace(document, events);
      setStatus({
        state: "saved",
        message: "Loaded the latest version from the local API.",
      });
    } catch (caught) {
      setStatus({ state: "error", message: errorMessage(caught) });
    }
  }, [applyServerWorkspace, projectId]);

  const overwriteServer = useCallback(async () => {
    try {
      const latest = await getDocument(projectId);
      revisionRef.current = latest.revision;
      conflictRef.current = false;
      pendingRef.current = stateRef.current;
      await flush();
    } catch (caught) {
      setStatus({ state: "error", message: errorMessage(caught) });
    }
  }, [flush, projectId]);

  useEffect(() => {
    if (!loaded) return;
    const refreshIfIdle = async () => {
      if (conflictRef.current || pendingRef.current || inFlightRef.current) {
        return;
      }
      try {
        const document = await getDocument(projectId);
        if (document.revision === revisionRef.current) return;
        const events = await getActivity(projectId).catch(
          () => stateRef.current.events,
        );
        applyServerWorkspace(document, events);
        addNotice({
          level: "info",
          message: "Loaded a newer version of this project from the local API.",
        });
      } catch {
        // Keep the current workspace; the next save reports connection errors.
      }
    };
    const onFocus = () => void refreshIfIdle();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refreshIfIdle();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [addNotice, applyServerWorkspace, loaded, projectId]);

  useEffect(() => {
    const onHide = () => {
      if (pendingRef.current && !conflictRef.current) {
        void flush({ keepalive: true });
      }
    };
    window.addEventListener("pagehide", onHide);
    window.addEventListener("beforeunload", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("beforeunload", onHide);
    };
  }, [flush]);

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
      deleteChapter: (id) =>
        dispatch({
          type: "deleteChapter",
          id,
          activityId: createId(),
          time: new Date().toISOString(),
        }),
      setChapterField: (id, field, value) =>
        dispatch({ type: "setChapterField", id, field, value }),
      addCriterion: (chapterId, text) =>
        dispatch({
          type: "addCriterion",
          chapterId,
          text,
          criterionId: createId(),
          activityId: createId(),
          time: new Date().toISOString(),
        }),
      setCriterionText: (chapterId, criterionId, text) =>
        dispatch({ type: "setCriterionText", chapterId, criterionId, text }),
      addCommit: (chapterId, hash) =>
        dispatch({
          type: "addCommit",
          id: chapterId,
          hash,
          activityId: createId(),
          time: new Date().toISOString(),
        }),
      removeCommit: (chapterId, hash) =>
        dispatch({
          type: "removeCommit",
          id: chapterId,
          hash,
          activityId: createId(),
          time: new Date().toISOString(),
        }),
      setChapterVerificationMode: (chapterId, mode) =>
        dispatch({
          type: "setChapterVerificationMode",
          chapterId,
          mode,
          activityId: createId(),
          time: new Date().toISOString(),
        }),
      setChapterVerificationText: (chapterId, field, value) =>
        dispatch({
          type: "setChapterVerificationText",
          chapterId,
          field,
          value,
        }),
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
      retrySave: () => flush(),
      flushSave: () => flush(),
      reloadFromServer,
      overwriteServer,
    }),
    [dispatch, flush, overwriteServer, reloadFromServer],
  );

  const statusValue = useMemo<WorkspaceStatusContextValue>(
    () => ({ status, notices }),
    [status, notices],
  );

  if (!loaded) {
    if (loadError) {
      return (
        <div className="development-state api-load-error" role="alert">
          <h1>The project could not be loaded</h1>
          <p>{loadError}</p>
          <div className="error-actions">
            <button type="button" onClick={() => void load()}>
              Retry
            </button>
            <a href="/api/v1/docs" target="_blank" rel="noreferrer">
              Open API docs
            </a>
          </div>
        </div>
      );
    }
    return (
      <p className="page-loading" role="status">
        Loading project…
      </p>
    );
  }

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

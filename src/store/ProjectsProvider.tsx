import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  activateProject as activateProjectApi,
  createProject as createProjectApi,
  deleteProject as deleteProjectApi,
  duplicateProject as duplicateProjectApi,
  fetchProjectExport,
  getProject,
  importProject as importProjectApi,
  listProjects,
  projectSummary,
  updateProject as updateProjectApi,
} from "../api/projects";
import { errorMessage } from "../api/client";
import type {
  ApiNotice,
  ApiResult,
  ProjectDetail,
  WorkspaceStatus,
} from "../api/types";
import type {
  ProjectInput,
  ProjectPatch,
  ProjectSummary,
} from "../domain/projects";

export interface ProjectsContextValue {
  projects: ProjectSummary[];
  activeProjectId: string | null;
  loading: boolean;
  error: string | null;
  notices: ApiNotice[];
  status: WorkspaceStatus;
  createProject: (input: ProjectInput) => Promise<ApiResult<ProjectSummary>>;
  updateProject: (
    id: string,
    patch: ProjectPatch,
  ) => Promise<ApiResult<ProjectSummary>>;
  duplicateProject: (id: string) => Promise<ApiResult<ProjectSummary>>;
  deleteProject: (
    id: string,
  ) => Promise<ApiResult<{ activeProjectId: string | null }>>;
  importProject: (text: string) => Promise<ApiResult<ProjectSummary>>;
  exportProject: (id: string) => Promise<void>;
  setActiveProject: (id: string) => Promise<void>;
  loadProjectDetail: (
    id: string,
    options?: { force?: boolean },
  ) => Promise<ApiResult<ProjectDetail>>;
  getProjectGuidelines: (id: string) => string;
  refresh: () => Promise<void>;
  dismissNotices: () => void;
  retryCatalog: () => void;
}

const ProjectsContext = createContext<ProjectsContextValue | null>(null);

export interface ProjectsProviderProps {
  children: ReactNode;
}

function downloadText(text: string, filename: string): void {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function exportFilename(project: ProjectSummary): string {
  const slug =
    project.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "project";
  return `layers-${slug}-${new Date().toISOString().slice(0, 10)}.json`;
}

function resultFromError<T>(error: unknown): ApiResult<T> {
  return { ok: false, issues: [errorMessage(error)] };
}

export function ProjectsProvider({ children }: ProjectsProviderProps) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [activeProjectId, setActiveProjectIdState] = useState<string | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notices, setNotices] = useState<ApiNotice[]>([]);
  const [details, setDetails] = useState<Record<string, ProjectDetail>>({});
  const detailsRef = useRef<Record<string, ProjectDetail>>({});
  const detailRequests = useRef<
    Record<string, Promise<ApiResult<ProjectDetail>> | undefined>
  >({});
  const [status, setStatus] = useState<WorkspaceStatus>({
    state: "loading",
    message: "Loading projects…",
  });

  const cacheDetail = useCallback((detail: ProjectDetail) => {
    detailsRef.current = { ...detailsRef.current, [detail.id]: detail };
    setDetails(detailsRef.current);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const catalog = await listProjects();
      setProjects(catalog.projects);
      setActiveProjectIdState(catalog.activeProjectId);
      setError(null);
      setLoading(false);
      setStatus({
        state: "saved",
        message: "Projects loaded from the local API.",
      });
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      setLoading(false);
      setStatus({ state: "error", message });
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onFocus = () => void refresh();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  const report = useCallback((issues: string[], level: ApiNotice["level"]) => {
    if (!issues.length) return;
    setNotices((previous) => [
      { level, message: issues.join(" ") },
      ...previous,
    ]);
  }, []);

  const loadProjectDetail = useCallback(
    async (
      id: string,
      options: { force?: boolean } = {},
    ): Promise<ApiResult<ProjectDetail>> => {
      if (!options.force && detailsRef.current[id]) {
        return { ok: true, value: detailsRef.current[id], issues: [] };
      }
      const existing = detailRequests.current[id];
      if (existing && !options.force) return existing;

      const request = (async () => {
        try {
          const detail = await getProject(id);
          cacheDetail(detail);
          return { ok: true as const, value: detail, issues: [] };
        } catch (caught) {
          return resultFromError<ProjectDetail>(caught);
        } finally {
          delete detailRequests.current[id];
        }
      })();
      detailRequests.current[id] = request;
      return request;
    },
    [cacheDetail],
  );

  const createProject = useCallback(
    async (input: ProjectInput): Promise<ApiResult<ProjectSummary>> => {
      try {
        const detail = await createProjectApi(input);
        cacheDetail(detail);
        await refresh();
        return { ok: true, value: projectSummary(detail), issues: [] };
      } catch (caught) {
        const result = resultFromError<ProjectSummary>(caught);
        report(result.issues, "error");
        return result;
      }
    },
    [cacheDetail, refresh, report],
  );

  const updateProject = useCallback(
    async (
      id: string,
      patch: ProjectPatch,
    ): Promise<ApiResult<ProjectSummary>> => {
      const loaded = await loadProjectDetail(id, { force: true });
      if (!loaded.ok) return loaded;
      try {
        const detail = await updateProjectApi(
          id,
          patch,
          loaded.value.metadataRevision,
        );
        cacheDetail(detail);
        await refresh();
        return { ok: true, value: projectSummary(detail), issues: [] };
      } catch (caught) {
        const result = resultFromError<ProjectSummary>(caught);
        report(result.issues, "error");
        return result;
      }
    },
    [cacheDetail, loadProjectDetail, refresh, report],
  );

  const duplicateProject = useCallback(
    async (id: string): Promise<ApiResult<ProjectSummary>> => {
      try {
        const detail = await duplicateProjectApi(id);
        cacheDetail(detail);
        await refresh();
        return { ok: true, value: projectSummary(detail), issues: [] };
      } catch (caught) {
        const result = resultFromError<ProjectSummary>(caught);
        report(result.issues, "error");
        return result;
      }
    },
    [cacheDetail, refresh, report],
  );

  const deleteProject = useCallback(
    async (
      id: string,
    ): Promise<ApiResult<{ activeProjectId: string | null }>> => {
      const loaded = await loadProjectDetail(id, { force: true });
      if (!loaded.ok) return loaded;
      try {
        const result = await deleteProjectApi(
          id,
          loaded.value.metadataRevision,
        );
        const nextDetails = { ...detailsRef.current };
        delete nextDetails[id];
        detailsRef.current = nextDetails;
        setDetails(nextDetails);
        await refresh();
        return { ok: true, value: result, issues: [] };
      } catch (caught) {
        const result = resultFromError<{ activeProjectId: string | null }>(
          caught,
        );
        report(result.issues, "error");
        return result;
      }
    },
    [loadProjectDetail, refresh, report],
  );

  const importProject = useCallback(
    async (text: string): Promise<ApiResult<ProjectSummary>> => {
      try {
        const result = await importProjectApi(text);
        cacheDetail(result.project);
        await refresh();
        if (result.issues.length) report(result.issues, "warning");
        return {
          ok: true,
          value: projectSummary(result.project),
          issues: result.issues,
        };
      } catch (caught) {
        const result = resultFromError<ProjectSummary>(caught);
        report(result.issues, "error");
        return result;
      }
    },
    [cacheDetail, refresh, report],
  );

  const exportProject = useCallback(
    async (id: string) => {
      try {
        const project =
          detailsRef.current[id] ?? projects.find((item) => item.id === id);
        if (!project) throw new Error("The project could not be found.");
        const text = await fetchProjectExport(id);
        downloadText(text, exportFilename(project));
      } catch (caught) {
        report([errorMessage(caught)], "error");
      }
    },
    [projects, report],
  );

  const setActiveProject = useCallback(
    async (id: string) => {
      setActiveProjectIdState(id);
      try {
        const result = await activateProjectApi(id);
        setActiveProjectIdState(result.activeProjectId);
        await refresh();
      } catch (caught) {
        report([errorMessage(caught)], "error");
      }
    },
    [refresh, report],
  );

  const getProjectGuidelines = useCallback(
    (id: string) => details[id]?.testGuidelines ?? "",
    [details],
  );

  const dismissNotices = useCallback(() => setNotices([]), []);
  const retryCatalog = useCallback(() => {
    setLoading(true);
    setStatus({ state: "loading", message: "Loading projects…" });
    void refresh();
  }, [refresh]);

  const value = useMemo<ProjectsContextValue>(
    () => ({
      projects,
      activeProjectId,
      loading,
      error,
      notices,
      status,
      createProject,
      updateProject,
      duplicateProject,
      deleteProject,
      importProject,
      exportProject,
      setActiveProject,
      loadProjectDetail,
      getProjectGuidelines,
      refresh,
      dismissNotices,
      retryCatalog,
    }),
    [
      projects,
      activeProjectId,
      loading,
      error,
      notices,
      status,
      createProject,
      updateProject,
      duplicateProject,
      deleteProject,
      importProject,
      exportProject,
      setActiveProject,
      loadProjectDetail,
      getProjectGuidelines,
      refresh,
      dismissNotices,
      retryCatalog,
    ],
  );

  return (
    <ProjectsContext.Provider value={value}>
      {children}
    </ProjectsContext.Provider>
  );
}

export function useProjects(): ProjectsContextValue {
  const context = useContext(ProjectsContext);
  if (!context) {
    throw new Error("useProjects must be used inside a ProjectsProvider.");
  }
  return context;
}

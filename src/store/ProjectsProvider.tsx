import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  CatalogRepository,
  CatalogResult,
  createCatalogRepository,
  DeleteProjectResult,
  projectExportFilename,
} from "./catalogRepository";
import { downloadJson, RepositoryStatus, StorageNotice } from "./persistence";
import { ProjectInput, ProjectPatch, ProjectSummary } from "../domain/projects";
import { Workspace } from "../domain/schema";

export interface ProjectsContextValue {
  projects: ProjectSummary[];
  activeProjectId: string | null;
  notices: StorageNotice[];
  status: RepositoryStatus;
  createProject: (input: ProjectInput) => CatalogResult<ProjectSummary>;
  updateProject: (
    id: string,
    patch: ProjectPatch,
  ) => CatalogResult<ProjectSummary>;
  duplicateProject: (id: string) => CatalogResult<ProjectSummary>;
  deleteProject: (id: string) => CatalogResult<DeleteProjectResult>;
  importProject: (text: string) => CatalogResult<ProjectSummary>;
  exportProject: (id: string, workspace?: Workspace) => void;
  setActiveProject: (id: string) => void;
  createProjectRepository: CatalogRepository["createProjectRepository"];
  dismissNotices: () => void;
  retryCatalog: () => void;
}

const ProjectsContext = createContext<ProjectsContextValue | null>(null);

export interface ProjectsProviderProps {
  repository?: CatalogRepository;
  children: ReactNode;
}

export function ProjectsProvider({
  repository: providedRepository,
  children,
}: ProjectsProviderProps) {
  const [repository] = useState(
    () => providedRepository ?? createCatalogRepository(),
  );
  const [initial] = useState(() => repository.load());
  const [projects, setProjects] = useState(() => repository.listProjects());
  const [activeProjectId, setActiveProjectId] = useState(() =>
    repository.getActiveProjectId(),
  );
  const [notices, setNotices] = useState<StorageNotice[]>(initial.notices);
  const [status, setStatus] = useState(() => repository.status());

  const refresh = useCallback(() => {
    setProjects(repository.listProjects());
    setActiveProjectId(repository.getActiveProjectId());
  }, [repository]);

  useEffect(() => {
    const unsubscribe = repository.subscribe(refresh);
    return unsubscribe;
  }, [repository, refresh]);

  useEffect(() => {
    const unsubscribe = repository.onStatusChange((next) => setStatus(next));
    return unsubscribe;
  }, [repository]);

  const report = useCallback((issues: string[]) => {
    if (!issues.length) return;
    setNotices((previous) => [
      {
        level: "warning",
        message: issues.join(" "),
      },
      ...previous,
    ]);
  }, []);

  const actions = useMemo(() => {
    function afterAction<T>(result: CatalogResult<T>): CatalogResult<T> {
      if (!result.ok) report(result.issues);
      refresh();
      return result;
    }

    return {
      createProject: (input: ProjectInput) =>
        afterAction(repository.createProject(input)),
      updateProject: (id: string, patch: ProjectPatch) =>
        afterAction(repository.updateProject(id, patch)),
      duplicateProject: (id: string) =>
        afterAction(repository.duplicateProject(id)),
      deleteProject: (id: string) => afterAction(repository.deleteProject(id)),
      importProject: (text: string) => {
        const result = afterAction(repository.importProject(text));
        if (result.ok && result.issues.length) {
          setNotices((previous) => [
            {
              level: "info",
              message: `Imported project with repairs: ${result.issues
                .slice(0, 3)
                .join(" ")}`,
            },
            ...previous,
          ]);
        }
        return result;
      },
      exportProject: (id: string, workspace?: Workspace) => {
        const json = repository.exportProject(id, workspace);
        const project = repository.getProject(id);
        if (!json || !project) {
          report(["The project could not be exported."]);
          return;
        }
        downloadJson(json, projectExportFilename(project));
      },
      setActiveProject: (id: string) => {
        repository.setActiveProject(id);
        refresh();
      },
      createProjectRepository: repository.createProjectRepository,
      dismissNotices: () => setNotices([]),
      retryCatalog: () => {
        repository.retry();
        refresh();
      },
    };
  }, [repository, report, refresh]);

  const value = useMemo<ProjectsContextValue>(
    () => ({
      projects,
      activeProjectId,
      notices,
      status,
      ...actions,
    }),
    [projects, activeProjectId, notices, status, actions],
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

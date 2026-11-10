import { Suspense, useCallback, useEffect, useState } from "react";
import { DeleteProjectDialog } from "../components/DeleteProjectDialog";
import { ProjectDialog } from "../components/ProjectDialog";
import { ProjectInput, ProjectPatch, ProjectSummary } from "../domain/projects";
import { ROUTE_VIEWS, useRoute } from "../hooks/useRoute";
import { useProjects } from "../store/ProjectsProvider";
import { WorkspaceProvider } from "../store/WorkspaceProvider";
import { ProjectsView } from "./lazyViews";
import { WorkspaceShell } from "./WorkspaceShell";

export function App() {
  const projectsContext = useProjects();
  const { projects, activeProjectId, createProjectRepository } =
    projectsContext;
  const route = useRoute();

  const routeProjectExists = Boolean(
    route.projectId &&
    projects.some((project) => project.id === route.projectId),
  );
  const unknownProject = Boolean(route.projectId && !routeProjectExists);
  const effectiveProjectId = routeProjectExists
    ? route.projectId
    : (activeProjectId ?? projects[0]?.id ?? null);

  useEffect(() => {
    if (!projects.length) {
      if (route.view !== ROUTE_VIEWS.projects) {
        route.replace({ view: ROUTE_VIEWS.projects });
      }
      return;
    }
    if (unknownProject) {
      route.replace({ view: ROUTE_VIEWS.projects });
    }
  }, [projects.length, route, unknownProject]);

  if (!projects.length) {
    return <StandaloneProjects />;
  }

  if (unknownProject || !effectiveProjectId) return null;

  return (
    <WorkspaceProvider
      key={effectiveProjectId}
      projectId={effectiveProjectId}
      repositoryFactory={createProjectRepository}
    >
      <WorkspaceShell projectId={effectiveProjectId} />
    </WorkspaceProvider>
  );
}

function StandaloneProjects() {
  const projectsContext = useProjects();
  const {
    projects,
    activeProjectId,
    createProject,
    updateProject,
    duplicateProject,
    deleteProject,
    importProject,
    exportProject,
  } = projectsContext;
  const route = useRoute();
  const [projectDialog, setProjectDialog] = useState<
    { mode: "create" } | { mode: "edit"; project: ProjectSummary } | null
  >(null);
  const [deleteTarget, setDeleteTarget] = useState<ProjectSummary | null>(null);

  const closeProjectDialog = useCallback(() => setProjectDialog(null), []);
  const closeDeleteDialog = useCallback(() => setDeleteTarget(null), []);
  const openCreateProject = useCallback(
    () => setProjectDialog({ mode: "create" }),
    [],
  );
  const openProjectSettings = useCallback(
    (item: ProjectSummary) => setProjectDialog({ mode: "edit", project: item }),
    [],
  );

  const openProject = useCallback(
    (id: string) => {
      route.navigate({
        view: ROUTE_VIEWS.specifications,
        projectId: id,
        chapterId: null,
      });
    },
    [route],
  );

  const submitProjectDialog = useCallback(
    (values: ProjectInput) => {
      if (projectDialog?.mode === "edit") {
        const result = updateProject(
          projectDialog.project.id,
          values as ProjectPatch,
        );
        return { ok: result.ok, issues: result.issues };
      }
      const result = createProject(values);
      if (result.ok) openProject(result.value.id);
      return { ok: result.ok, issues: result.issues };
    },
    [createProject, openProject, projectDialog, updateProject],
  );

  const submitDelete = useCallback(() => {
    if (!deleteTarget) return;
    const result = deleteProject(deleteTarget.id);
    if (result.ok) setDeleteTarget(null);
  }, [deleteProject, deleteTarget]);

  const importProjectText = useCallback(
    (text: string) => {
      const result = importProject(text);
      if (result.ok) openProject(result.value.id);
      return { ok: result.ok, issues: result.issues };
    },
    [importProject, openProject],
  );

  return (
    <Suspense fallback={<p className="page-loading">Loading…</p>}>
      <ProjectsView
        standalone
        projects={projects}
        activeProjectId={activeProjectId}
        onOpenProject={openProject}
        onNewProject={openCreateProject}
        onEditProject={openProjectSettings}
        onDuplicateProject={(item) => {
          const result = duplicateProject(item.id);
          if (result.ok) openProject(result.value.id);
        }}
        onExportProject={(item) => exportProject(item.id)}
        onDeleteProject={(item) => setDeleteTarget(item)}
        onImportProject={importProjectText}
      />
      {projectDialog && (
        <ProjectDialog
          key={
            projectDialog.mode === "edit"
              ? `edit-${projectDialog.project.id}`
              : "create"
          }
          mode={projectDialog.mode}
          project={
            projectDialog.mode === "edit" ? projectDialog.project : undefined
          }
          onClose={closeProjectDialog}
          onSubmit={submitProjectDialog}
        />
      )}
      {deleteTarget && (
        <DeleteProjectDialog
          project={deleteTarget}
          onClose={closeDeleteDialog}
          onExport={() => exportProject(deleteTarget.id)}
          onDelete={submitDelete}
        />
      )}
    </Suspense>
  );
}

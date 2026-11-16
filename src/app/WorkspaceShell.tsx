import {
  FormEvent,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChapterEditor } from "../components/ChapterEditor";
import { DeleteProjectDialog } from "../components/DeleteProjectDialog";
import { ProjectDialog } from "../components/ProjectDialog";
import { ProjectTokensDialog } from "../components/ProjectTokensDialog";
import { Sidebar } from "../components/Sidebar";
import { SkipLink } from "../components/SkipLink";
import { StorageBanner } from "../components/StorageBanner";
import { Topbar } from "../components/Topbar";
import { collectSubtreeIds, getDefaultId, getPath } from "../domain/chapters";
import { ProjectInput, ProjectPatch, ProjectSummary } from "../domain/projects";
import { useChapterTree } from "../hooks/useChapterTree";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { ROUTE_VIEWS, useRoute } from "../hooks/useRoute";
import { useProjects } from "../store/ProjectsProvider";
import {
  useWorkspaceActions,
  useWorkspaceState,
  useWorkspaceStatus,
} from "../store/WorkspaceProvider";
import { ErrorBoundary } from "./ErrorBoundary";
import { ActivityView, ProjectsView, TestCoverageView } from "./lazyViews";

const VIEW_LABELS: Record<string, string> = {
  [ROUTE_VIEWS.projects]: "Projects",
  [ROUTE_VIEWS.specifications]: "Specifications",
  [ROUTE_VIEWS.coverage]: "Test coverage",
  [ROUTE_VIEWS.activity]: "Activity",
};

export interface WorkspaceShellProps {
  projectId: string;
}

export function WorkspaceShell({ projectId }: WorkspaceShellProps) {
  const state = useWorkspaceState();
  const {
    select,
    createChapter,
    deleteChapter,
    flushSave,
    retrySave,
    reloadFromServer,
    overwriteServer,
    dismissNotices: dismissWorkspaceNotices,
  } = useWorkspaceActions();
  const { status: workspaceStatus, notices: workspaceNotices } =
    useWorkspaceStatus();
  const projectsContext = useProjects();
  const {
    projects,
    activeProjectId,
    notices: catalogNotices,
    status: catalogStatus,
    createProject,
    updateProject,
    duplicateProject,
    deleteProject,
    importProject,
    exportProject,
    setActiveProject,
    dismissNotices: dismissCatalogNotices,
    retryCatalog,
  } = projectsContext;
  const project =
    projects.find((item) => item.id === projectId) ?? projects[0] ?? null;
  const route = useRoute();
  const tree = useChapterTree(state.chapters);

  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [creating, setCreating] = useState<{
    parentId: string | null;
  } | null>(null);
  const [chapterTitle, setChapterTitle] = useState("");
  const [navOpen, setNavOpen] = useState(false);
  const [focusRequest, setFocusRequest] = useState<string | null>(null);
  const [projectDialog, setProjectDialog] = useState<
    { mode: "create" } | { mode: "edit"; project: ProjectSummary } | null
  >(null);
  const [deleteTarget, setDeleteTarget] = useState<ProjectSummary | null>(null);
  const [tokenProject, setTokenProject] = useState<ProjectSummary | null>(null);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [overwritePending, setOverwritePending] = useState(false);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const overwriteDialogRef = useRef<HTMLDivElement | null>(null);
  const overwriteTitleId = useId();
  const overwriteDescriptionId = useId();

  const activeId = useMemo(() => {
    const requested = route.chapterId;
    if (requested && state.chapters.byId[requested]) return requested;
    return getDefaultId(state.chapters, state.selectedId);
  }, [route.chapterId, state.chapters, state.selectedId]);

  const chapter = activeId ? state.chapters.byId[activeId] : null;
  const path = useMemo(
    () => (activeId ? getPath(state.chapters, activeId) : []),
    [state.chapters, activeId],
  );
  const deleteInfo = useMemo(() => {
    if (!chapter) return { descendantCount: 0 };
    const parent = chapter.parentId
      ? state.chapters.byId[chapter.parentId]
      : null;
    const linked = parent?.criteria.find(
      (criterion) => criterion.chapterId === chapter.id,
    );
    return {
      descendantCount: collectSubtreeIds(state.chapters, chapter.id).length,
      parentTitle: parent?.title,
      linkedCriterionText: linked?.text,
    };
  }, [chapter, state.chapters]);
  const view = route.view;

  const closeNav = useCallback(() => setNavOpen(false), []);
  useFocusTrap(navOpen, sidebarRef, closeNav);
  useFocusTrap(confirmOverwrite, overwriteDialogRef, () =>
    setConfirmOverwrite(false),
  );

  useEffect(() => {
    if (activeProjectId !== projectId) void setActiveProject(projectId);
  }, [activeProjectId, projectId, setActiveProject]);

  // Keep the URL canonical: unknown ids, legacy hashes and empty chapter
  // selections fall back to the active project's first usable chapter.
  useEffect(() => {
    if (view === ROUTE_VIEWS.projects) {
      if (route.legacy) route.replace({ view: ROUTE_VIEWS.projects });
      return;
    }
    const targetChapter = view === ROUTE_VIEWS.specifications ? activeId : null;
    const needsProject = route.projectId !== projectId;
    const needsChapter =
      view === ROUTE_VIEWS.specifications && route.chapterId !== targetChapter;
    if (needsProject || needsChapter || !route.valid || route.legacy) {
      route.replace({ view, projectId, chapterId: targetChapter });
    }
  }, [view, route, activeId, projectId]);

  useEffect(() => {
    if (view !== ROUTE_VIEWS.specifications || !activeId) return;
    if (activeId !== state.selectedId) select(activeId);
  }, [view, activeId, state.selectedId, select]);

  const selectChapter = useCallback(
    (id: string) => {
      setFocusRequest(id);
      select(id);
      setNavOpen(false);
      route.navigate({
        view: ROUTE_VIEWS.specifications,
        projectId,
        chapterId: id,
      });
    },
    [projectId, route, select],
  );

  const navigateView = useCallback(
    (nextView: string) => {
      setCreating(null);
      setNavOpen(false);
      if (nextView === ROUTE_VIEWS.projects) {
        route.navigate({ view: ROUTE_VIEWS.projects });
        return;
      }
      route.navigate({
        view: nextView,
        projectId,
        chapterId: nextView === ROUTE_VIEWS.specifications ? activeId : null,
      });
    },
    [activeId, projectId, route],
  );

  const startChapter = useCallback(
    (parentId: string | null) => {
      setCreating({ parentId });
      setChapterTitle("");
      if (parentId) {
        setCollapsed((previous) => {
          if (!previous.has(parentId)) return previous;
          const next = new Set(previous);
          next.delete(parentId);
          return next;
        });
      }
      if (view !== ROUTE_VIEWS.specifications && activeId) {
        route.navigate({
          view: ROUTE_VIEWS.specifications,
          projectId,
          chapterId: activeId,
        });
      }
    },
    [activeId, projectId, route, view],
  );

  const createChapterFromForm = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const title = chapterTitle.trim();
      if (!title) return;
      const id = createChapter({
        parentId: creating?.parentId ?? null,
        title,
      });
      setCreating(null);
      setChapterTitle("");
      setFocusRequest(id);
      route.navigate({
        view: ROUTE_VIEWS.specifications,
        projectId,
        chapterId: id,
      });
    },
    [chapterTitle, createChapter, creating, projectId, route],
  );

  const cancelChapter = useCallback(() => {
    setCreating(null);
    setChapterTitle("");
  }, []);

  const toggleCollapsed = useCallback((id: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const revealChildren = useCallback((id: string) => {
    setCollapsed((previous) => {
      if (!previous.has(id)) return previous;
      const next = new Set(previous);
      next.delete(id);
      return next;
    });
  }, []);

  const clearFocusRequest = useCallback(() => setFocusRequest(null), []);
  const deleteCurrentChapter = useCallback(() => {
    if (!chapter) return;
    const parentId =
      chapter.parentId && state.chapters.byId[chapter.parentId]
        ? chapter.parentId
        : null;
    const target =
      parentId ??
      state.chapters.rootIds.find((id) => id !== chapter.id) ??
      null;
    deleteChapter(chapter.id);
    setNavOpen(false);
    route.navigate({
      view: ROUTE_VIEWS.specifications,
      projectId,
      chapterId: target,
    });
  }, [chapter, deleteChapter, projectId, route, state.chapters]);
  const closeProjectDialog = useCallback(() => setProjectDialog(null), []);
  const closeDeleteDialog = useCallback(() => setDeleteTarget(null), []);
  const closeTokenDialog = useCallback(() => setTokenProject(null), []);
  const confirmOverwriteDocument = useCallback(async () => {
    setOverwritePending(true);
    try {
      await overwriteServer();
      setConfirmOverwrite(false);
    } finally {
      setOverwritePending(false);
    }
  }, [overwriteServer]);
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
      setNavOpen(false);
      route.navigate({
        view: ROUTE_VIEWS.specifications,
        projectId: id,
        chapterId: null,
      });
    },
    [route],
  );

  const switchProject = useCallback(
    (id: string) => {
      void setActiveProject(id);
      setNavOpen(false);
      const nextView =
        view === ROUTE_VIEWS.projects || view === ROUTE_VIEWS.specifications
          ? ROUTE_VIEWS.specifications
          : view;
      route.navigate({
        view: nextView,
        projectId: id,
        chapterId: null,
      });
    },
    [route, setActiveProject, view],
  );

  const openProjects = useCallback(() => {
    setNavOpen(false);
    route.navigate({ view: ROUTE_VIEWS.projects });
  }, [route]);

  const exportProjectById = useCallback(
    (id: string) => {
      void exportProject(id);
    },
    [exportProject],
  );

  const submitProjectDialog = useCallback(
    async (values: ProjectInput) => {
      if (projectDialog?.mode === "edit") {
        const result = await updateProject(
          projectDialog.project.id,
          values as ProjectPatch,
        );
        return { ok: result.ok, issues: result.issues };
      }
      const result = await createProject(values);
      if (result.ok) {
        route.navigate({
          view: ROUTE_VIEWS.specifications,
          projectId: result.value.id,
          chapterId: null,
        });
      }
      return { ok: result.ok, issues: result.issues };
    },
    [createProject, projectDialog, route, updateProject],
  );

  const submitDelete = useCallback(async () => {
    if (!deleteTarget) return;
    if (deleteTarget.id === projectId) await flushSave();
    const result = await deleteProject(deleteTarget.id);
    if (!result.ok) return;
    setDeleteTarget(null);
    if (deleteTarget.id === projectId) {
      const next = result.value.activeProjectId;
      if (next) {
        route.navigate({
          view: ROUTE_VIEWS.specifications,
          projectId: next,
          chapterId: null,
        });
      } else {
        route.navigate({ view: ROUTE_VIEWS.projects });
      }
    }
  }, [deleteProject, deleteTarget, flushSave, projectId, route]);

  const duplicateProjectById = useCallback(
    async (id: string) => {
      const result = await duplicateProject(id);
      if (result.ok) {
        route.navigate({
          view: ROUTE_VIEWS.specifications,
          projectId: result.value.id,
          chapterId: null,
        });
      }
    },
    [duplicateProject, route],
  );

  const importProjectText = useCallback(
    async (text: string) => {
      const result = await importProject(text);
      if (result.ok) {
        route.navigate({
          view: ROUTE_VIEWS.specifications,
          projectId: result.value.id,
          chapterId: null,
        });
      }
      return { ok: result.ok, issues: result.issues };
    },
    [importProject, route],
  );

  const dismissAllNotices = useCallback(() => {
    dismissWorkspaceNotices();
    dismissCatalogNotices();
  }, [dismissCatalogNotices, dismissWorkspaceNotices]);

  const catalogError =
    workspaceStatus.state !== "error" &&
    workspaceStatus.state !== "conflict" &&
    catalogStatus.state === "error";
  const bannerStatus = catalogError ? catalogStatus : workspaceStatus;
  const bannerNotices = [...catalogNotices, ...workspaceNotices];

  if (!project) return null;

  return (
    <div className="app">
      <SkipLink />
      {navOpen && (
        <button
          className="sidebar-backdrop"
          aria-label="Close chapter navigation"
          onClick={closeNav}
        />
      )}
      <Sidebar
        project={project}
        projects={projects}
        view={view}
        nodes={tree}
        selectedId={activeId}
        collapsed={collapsed}
        creating={creating}
        chapterTitle={chapterTitle}
        navOpen={navOpen}
        sidebarRef={sidebarRef}
        onNavigateView={navigateView}
        onCloseNav={closeNav}
        onSelectChapter={selectChapter}
        onToggleCollapsed={toggleCollapsed}
        onStartChapter={startChapter}
        onChapterTitleChange={setChapterTitle}
        onCreateChapter={createChapterFromForm}
        onCancelChapter={cancelChapter}
        onSwitchProject={switchProject}
        onOpenProjects={openProjects}
        onNewProject={openCreateProject}
        onExportProject={() => exportProjectById(projectId)}
        onImportProject={importProjectText}
      />
      <main id="main-content" className="main" tabIndex={-1}>
        <Topbar
          projectName={project.name}
          view={VIEW_LABELS[view] ?? view}
          rootTitle={
            view === ROUTE_VIEWS.projects
              ? "Projects"
              : (path[0]?.title ?? "No chapters")
          }
          onOpenNav={() => setNavOpen(true)}
        />
        <StorageBanner
          notices={bannerNotices}
          status={bannerStatus}
          onRetry={catalogError ? retryCatalog : retrySave}
          onReload={reloadFromServer}
          onOverwrite={() => setConfirmOverwrite(true)}
          onDismiss={dismissAllNotices}
          onExport={() => exportProjectById(projectId)}
        />
        <ErrorBoundary key={`${projectId}-${view}`}>
          {view === ROUTE_VIEWS.projects && (
            <Suspense fallback={<p className="page-loading">Loading…</p>}>
              <ProjectsView
                projects={projects}
                activeProjectId={activeProjectId}
                onOpenProject={openProject}
                onNewProject={openCreateProject}
                onManageProjectTokens={setTokenProject}
                onEditProject={openProjectSettings}
                onDuplicateProject={(item) =>
                  void duplicateProjectById(item.id)
                }
                onExportProject={(item) => exportProjectById(item.id)}
                onDeleteProject={(item) => setDeleteTarget(item)}
                onImportProject={importProjectText}
              />
            </Suspense>
          )}
          {view === ROUTE_VIEWS.specifications &&
            (chapter ? (
              <ChapterEditor
                key={chapter.id}
                chapter={chapter}
                path={path}
                autoFocusTitle={focusRequest === chapter.id}
                onAutoFocused={clearFocusRequest}
                onSelectChapter={selectChapter}
                onRevealChildren={revealChildren}
                deleteInfo={deleteInfo}
                onDeleteChapter={deleteCurrentChapter}
              />
            ) : (
              <section className="chapter-editor overview-page empty-workspace">
                <h1>No chapters yet</h1>
                <p>
                  Create your first chapter to start writing the specification.
                </p>
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => startChapter(null)}
                >
                  New chapter
                </button>
              </section>
            ))}
          {view === ROUTE_VIEWS.coverage && (
            <Suspense fallback={<p className="page-loading">Loading…</p>}>
              <TestCoverageView onSelectChapter={selectChapter} />
            </Suspense>
          )}
          {view === ROUTE_VIEWS.activity && (
            <Suspense fallback={<p className="page-loading">Loading…</p>}>
              <ActivityView onSelectChapter={selectChapter} />
            </Suspense>
          )}
        </ErrorBoundary>
      </main>

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
      {tokenProject && (
        <ProjectTokensDialog
          project={tokenProject}
          onClose={closeTokenDialog}
        />
      )}
      {deleteTarget && (
        <DeleteProjectDialog
          project={deleteTarget}
          onClose={closeDeleteDialog}
          onExport={() => exportProjectById(deleteTarget.id)}
          onDelete={submitDelete}
        />
      )}
      {confirmOverwrite && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setConfirmOverwrite(false);
            }
          }}
        >
          <div
            className="modal delete-project-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={overwriteTitleId}
            aria-describedby={overwriteDescriptionId}
            ref={overwriteDialogRef}
          >
            <div className="modal-header">
              <div>
                <h2 id={overwriteTitleId}>Overwrite the server document?</h2>
                <p id={overwriteDescriptionId}>
                  Your local version will replace the latest document saved by
                  another tab or client. This cannot be undone.
                </p>
              </div>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={overwritePending}
                onClick={() => setConfirmOverwrite(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="danger-button"
                disabled={overwritePending}
                onClick={() => void confirmOverwriteDocument()}
              >
                {overwritePending ? "Overwriting…" : "Overwrite document"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

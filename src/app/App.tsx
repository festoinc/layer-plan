import {
  FormEvent,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChapterEditor } from "../components/ChapterEditor";
import { Sidebar } from "../components/Sidebar";
import { SkipLink } from "../components/SkipLink";
import { StorageBanner } from "../components/StorageBanner";
import { Topbar } from "../components/Topbar";
import { getDefaultId, getPath } from "../domain/chapters";
import { useChapterTree } from "../hooks/useChapterTree";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { ROUTE_VIEWS, useRoute } from "../hooks/useRoute";
import { useWorkspace } from "../store/WorkspaceProvider";
import { ErrorBoundary } from "./ErrorBoundary";

const ActivityView = lazy(() =>
  import("../components/ActivityView").then((module) => ({
    default: module.ActivityView,
  })),
);
const TestCoverageView = lazy(() => import("../components/TestCoverageView"));

const VIEW_LABELS: Record<string, string> = {
  [ROUTE_VIEWS.specifications]: "Specifications",
  [ROUTE_VIEWS.coverage]: "Test coverage",
  [ROUTE_VIEWS.activity]: "Activity",
};

export function App() {
  const {
    state,
    project,
    status,
    notices,
    select,
    createChapter,
    dismissNotices,
    retrySave,
    exportWorkspace,
    importWorkspace,
  } = useWorkspace();
  const route = useRoute();
  const tree = useChapterTree(state.chapters);

  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [creating, setCreating] = useState<{
    parentId: string | null;
  } | null>(null);
  const [chapterTitle, setChapterTitle] = useState("");
  const [navOpen, setNavOpen] = useState(false);
  const [focusRequest, setFocusRequest] = useState<string | null>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);

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
  const view = route.view;

  const closeNav = useCallback(() => setNavOpen(false), []);
  useFocusTrap(navOpen, sidebarRef, closeNav);

  // Keep the URL canonical: unknown ids and the empty hash fall back to the
  // first usable chapter, so reloads and links always resolve.
  useEffect(() => {
    if (view !== ROUTE_VIEWS.specifications || !activeId) return;
    if (!route.valid || route.chapterId !== activeId) {
      route.replace({ view: ROUTE_VIEWS.specifications, chapterId: activeId });
    }
  }, [view, activeId, route]);

  useEffect(() => {
    if (view !== ROUTE_VIEWS.specifications || !activeId) return;
    if (activeId !== state.selectedId) select(activeId);
  }, [view, activeId, state.selectedId, select]);

  const selectChapter = useCallback(
    (id: string) => {
      setFocusRequest(id);
      select(id);
      setNavOpen(false);
      route.navigate({ view: ROUTE_VIEWS.specifications, chapterId: id });
    },
    [route, select],
  );

  const navigateView = useCallback(
    (nextView: string) => {
      setCreating(null);
      setNavOpen(false);
      route.navigate({ view: nextView });
    },
    [route],
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
          chapterId: activeId,
        });
      }
    },
    [activeId, route, view],
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
      route.navigate({ view: ROUTE_VIEWS.specifications, chapterId: id });
    },
    [chapterTitle, createChapter, creating, route],
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
        view={view}
        nodes={tree}
        selectedId={activeId}
        collapsed={collapsed}
        creating={creating}
        chapterTitle={chapterTitle}
        status={status}
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
        onExport={exportWorkspace}
        onImport={importWorkspace}
      />
      <main id="main-content" className="main" tabIndex={-1}>
        <Topbar
          projectName={project.name}
          view={VIEW_LABELS[view] ?? view}
          rootTitle={path[0]?.title ?? "No chapters"}
          status={status}
          onOpenNav={() => setNavOpen(true)}
        />
        <StorageBanner
          notices={notices}
          status={status}
          onRetry={retrySave}
          onDismiss={dismissNotices}
          onExport={exportWorkspace}
        />
        <ErrorBoundary key={view}>
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
              <TestCoverageView />
            </Suspense>
          )}
          {view === ROUTE_VIEWS.activity && (
            <Suspense fallback={<p className="page-loading">Loading…</p>}>
              <ActivityView onSelectChapter={selectChapter} />
            </Suspense>
          )}
        </ErrorBoundary>
      </main>
    </div>
  );
}

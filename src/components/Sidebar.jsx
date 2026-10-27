import { useRef, useState } from "react";
import {
  ChartNoAxesColumnIncreasing,
  Clock3,
  FileText,
  Layers,
  Plus,
  X,
} from "lucide-react";
import { ChapterTree } from "./ChapterTree.jsx";

const VIEWS = [
  ["specifications", "Specifications", FileText],
  ["coverage", "Test coverage", ChartNoAxesColumnIncreasing],
  ["activity", "Activity", Clock3],
];

/**
 * @param {{
 *   project: { name: string, account: string },
 *   view: string,
 *   nodes: import("../hooks/useChapterTree.js").TreeNode[],
 *   selectedId: string|null,
 *   collapsed: Set<string>,
 *   creating: { parentId: string|null }|null,
 *   chapterTitle: string,
 *   status: { state: string, message: string },
 *   navOpen: boolean,
 *   sidebarRef: import("react").RefObject<HTMLElement|null>,
 *   onNavigateView: (view: string) => void,
 *   onCloseNav: () => void,
 *   onSelectChapter: (id: string) => void,
 *   onToggleCollapsed: (id: string) => void,
 *   onStartChapter: (parentId: string|null) => void,
 *   onChapterTitleChange: (value: string) => void,
 *   onCreateChapter: (event: React.FormEvent<HTMLFormElement>) => void,
 *   onCancelChapter: () => void,
 *   onExport: () => void,
 *   onImport: (text: string) => { ok: boolean, issues: string[] },
 * }} props
 */
export function Sidebar({
  project,
  view,
  nodes,
  selectedId,
  collapsed,
  creating,
  chapterTitle,
  status,
  navOpen,
  sidebarRef,
  onNavigateView,
  onCloseNav,
  onSelectChapter,
  onToggleCollapsed,
  onStartChapter,
  onChapterTitleChange,
  onCreateChapter,
  onCancelChapter,
  onExport,
  onImport,
}) {
  const fileInput = useRef(/** @type {HTMLInputElement|null} */ (null));
  const [importError, setImportError] = useState("");

  async function handleImport(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const result = onImport(await file.text());
      setImportError(result.ok ? "" : result.issues.join(" "));
    } catch {
      setImportError("The selected file could not be read.");
    }
  }

  const saved = status.state === "saved";
  const footerLabel = saved
    ? "Saved locally"
    : status.state === "pending"
      ? "Saving locally"
      : "Local workspace";

  return (
    <aside
      ref={sidebarRef}
      className={`sidebar ${navOpen ? "open" : ""}`}
      aria-label="Workspace navigation"
    >
      <div className="brand">
        <Layers size={27} />
        <span>Layers</span>
        <button
          className="icon-button close-nav"
          aria-label="Close navigation"
          onClick={onCloseNav}
        >
          <X size={19} />
        </button>
      </div>
      <div className="project-label">
        <span className="project-icon">{project.account}</span>
        <div>
          <strong>{project.name}</strong>
          <span>Project specification</span>
        </div>
      </div>
      <nav className="workspace-navigation" aria-label="Workspace">
        {VIEWS.map(([key, name, Icon]) => (
          <button
            key={key}
            className={view === key ? "active" : ""}
            aria-current={view === key ? "page" : undefined}
            onClick={() => onNavigateView(key)}
          >
            <Icon size={16} />
            {name}
            {name === "Test coverage" && (
              <span className="soon-badge" aria-hidden="true">
                Soon
              </span>
            )}
          </button>
        ))}
      </nav>
      <div className="chapters-heading">
        <h2>Chapters</h2>
      </div>
      <nav className="chapter-navigation" aria-label="Chapters">
        <ChapterTree
          nodes={nodes}
          selectedId={selectedId}
          activeView={view}
          collapsed={collapsed}
          creating={creating}
          chapterTitle={chapterTitle}
          onTitleChange={onChapterTitleChange}
          onSubmit={onCreateChapter}
          onCancel={onCancelChapter}
          onSelect={onSelectChapter}
          onToggleCollapsed={onToggleCollapsed}
          onStartChapter={onStartChapter}
        />
      </nav>
      <button className="new-chapter" onClick={() => onStartChapter(null)}>
        <Plus size={16} />
        New chapter
      </button>
      <div className="workspace-tools">
        <button type="button" onClick={onExport}>
          Export workspace
        </button>
        <button type="button" onClick={() => fileInput.current?.click()}>
          Import workspace
        </button>
        <input
          ref={fileInput}
          className="visually-hidden"
          type="file"
          accept="application/json,.json"
          aria-label="Import workspace file"
          onChange={handleImport}
        />
      </div>
      {importError && (
        <p className="import-error" role="alert">
          {importError}
        </p>
      )}
      <div className="sidebar-footer">
        <span className="local-dot" />
        {footerLabel}
      </div>
    </aside>
  );
}

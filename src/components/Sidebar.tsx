import { ChangeEvent, FormEvent, RefObject, useRef, useState } from "react";
import {
  ChartNoAxesColumnIncreasing,
  Clock3,
  FileText,
  Layers,
  LayoutGrid,
  LucideIcon,
  Plus,
  X,
} from "lucide-react";
import { ChapterTree } from "./ChapterTree";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { TreeNode } from "../hooks/useChapterTree";
import { MAX_PROJECTS, ProjectSummary } from "../domain/projects";
import type { WorkspaceStatus } from "../api/types";
import { useWorkspaceStatus } from "../store/WorkspaceProvider";

const VIEWS: [string, string, LucideIcon][] = [
  ["projects", "Projects", LayoutGrid],
  ["specifications", "Specifications", FileText],
  ["coverage", "Test coverage", ChartNoAxesColumnIncreasing],
  ["activity", "Activity", Clock3],
];

export interface SidebarProps {
  project: ProjectSummary;
  projects: ProjectSummary[];
  view: string;
  nodes: TreeNode[];
  selectedId: string | null;
  collapsed: Set<string>;
  creating: { parentId: string | null } | null;
  chapterTitle: string;
  status?: WorkspaceStatus;
  navOpen: boolean;
  sidebarRef: RefObject<HTMLElement | null>;
  onNavigateView: (view: string) => void;
  onCloseNav: () => void;
  onSelectChapter: (id: string) => void;
  onToggleCollapsed: (id: string) => void;
  onStartChapter: (parentId: string | null) => void;
  onChapterTitleChange: (value: string) => void;
  onCreateChapter: (event: FormEvent<HTMLFormElement>) => void;
  onCancelChapter: () => void;
  onSwitchProject: (id: string) => void;
  onOpenProjects: () => void;
  onNewProject: () => void;
  onExportProject: () => void;
  onImportProject: (text: string) => Promise<{ ok: boolean; issues: string[] }>;
}

export function Sidebar({
  project,
  projects,
  view,
  nodes,
  selectedId,
  collapsed,
  creating,
  chapterTitle,
  status: statusProp,
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
  onSwitchProject,
  onOpenProjects,
  onNewProject,
  onExportProject,
  onImportProject,
}: SidebarProps) {
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [importError, setImportError] = useState("");
  const statusContext = useWorkspaceStatus();
  const status = statusProp ?? statusContext.status;

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const result = await onImportProject(await file.text());
      setImportError(result.ok ? "" : result.issues.join(" "));
    } catch {
      setImportError("The selected file could not be read.");
    }
  }

  const saved = status.state === "saved";
  const footerLabel = saved
    ? "Saved to local API"
    : status.state === "pending"
      ? "Saving to local API"
      : status.state === "conflict"
        ? "Save conflict"
        : "Local API";

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
      <ProjectSwitcher
        key={project.id}
        project={project}
        projects={projects}
        onSelect={onSwitchProject}
        onOpenProjects={onOpenProjects}
        onNewProject={onNewProject}
      />
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
          onStartChapter={(id) => onStartChapter(id)}
        />
      </nav>
      <button className="new-chapter" onClick={() => onStartChapter(null)}>
        <Plus size={16} />
        New chapter
      </button>
      <div className="workspace-tools">
        <button type="button" onClick={onExportProject}>
          Export project
        </button>
        <button
          type="button"
          disabled={projects.length >= MAX_PROJECTS}
          onClick={() => fileInput.current?.click()}
        >
          Import project
        </button>
        <input
          ref={fileInput}
          className="visually-hidden"
          type="file"
          accept="application/json,.json"
          aria-label="Import project file"
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

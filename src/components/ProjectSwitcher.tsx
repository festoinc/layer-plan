import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, LayoutGrid, Plus } from "lucide-react";
import { MAX_PROJECTS, ProjectSummary } from "../domain/projects";
import { useFocusTrap } from "../hooks/useFocusTrap";

export interface ProjectSwitcherProps {
  project: ProjectSummary;
  projects: ProjectSummary[];
  onSelect: (id: string) => void;
  onOpenProjects: () => void;
  onNewProject: () => void;
}

export function ProjectSwitcher({
  project,
  projects,
  onSelect,
  onOpenProjects,
  onNewProject,
}: ProjectSwitcherProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();
  const atLimit = projects.length >= MAX_PROJECTS;

  const close = useCallback(() => setOpen(false), []);
  useFocusTrap(open, menuRef, close);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open, close]);

  return (
    <div className="project-switcher" ref={containerRef}>
      <button
        type="button"
        className="project-label project-switcher-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={`project-icon project-color-${project.color}`}>
          {project.initials}
        </span>
        <span className="project-label-copy">
          <strong>{project.name}</strong>
          <span>Project specification</span>
        </span>
        <ChevronDown
          className={`project-switcher-chevron ${open ? "open" : ""}`}
          size={15}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div
          className="project-menu"
          id={menuId}
          role="menu"
          aria-label="Projects"
          ref={menuRef}
        >
          <div className="project-menu-heading">Projects</div>
          {projects.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className={
                item.id === project.id
                  ? "project-menu-item active"
                  : "project-menu-item"
              }
              onClick={() => {
                close();
                onSelect(item.id);
              }}
            >
              <span className={`project-icon project-color-${item.color}`}>
                {item.initials}
              </span>
              <span className="project-menu-copy">
                <strong>{item.name}</strong>
                <span>
                  {item.chapterCount} chapter
                  {item.chapterCount === 1 ? "" : "s"}
                </span>
              </span>
              {item.id === project.id && (
                <Check size={15} aria-label="Current project" />
              )}
            </button>
          ))}
          <div className="project-menu-separator" />
          <button
            type="button"
            role="menuitem"
            className="project-menu-item"
            onClick={() => {
              close();
              onOpenProjects();
            }}
          >
            <LayoutGrid size={17} aria-hidden="true" />
            <span className="project-menu-copy">
              <strong>All projects</strong>
              <span>Create, rename and delete</span>
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="project-menu-item"
            disabled={atLimit}
            onClick={() => {
              close();
              onNewProject();
            }}
          >
            <Plus size={17} aria-hidden="true" />
            <span className="project-menu-copy">
              <strong>New project</strong>
              <span>
                {atLimit
                  ? `Project limit reached (${MAX_PROJECTS.toLocaleString()})`
                  : "Start from an empty Overview chapter"}
              </span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

import { ProjectSummary } from "../domain/projects";
import { ProjectActionsMenu } from "./ProjectActionsMenu";

export interface ProjectCardProps {
  project: ProjectSummary;
  active: boolean;
  onOpen: () => void;
  onManageTokens: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onExport: () => void;
  onDelete: () => void;
}

function formatUpdated(time: string): string {
  const value = Date.parse(time);
  if (Number.isNaN(value)) return "Updated recently";
  const minutes = Math.max(0, Math.round((Date.now() - value) / 60000));
  if (minutes < 1) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Updated ${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `Updated ${days} d ago`;
  return `Updated ${new Date(value).toLocaleDateString()}`;
}

export function ProjectCard({
  project,
  active,
  onOpen,
  onManageTokens,
  onRename,
  onDuplicate,
  onExport,
  onDelete,
}: ProjectCardProps) {
  const progress = project.criterionCount
    ? Math.round((project.checkedCount / project.criterionCount) * 100)
    : 0;

  return (
    <article
      className={`project-card ${active ? "active" : ""}`}
      aria-current={active ? "true" : undefined}
    >
      <div className="project-card-top">
        <span className={`project-icon project-color-${project.color}`}>
          {project.initials}
        </span>
        <div className="project-card-title">
          <h2>
            <button type="button" onClick={onOpen}>
              {project.name}
            </button>
          </h2>
          {active && <span className="project-active-badge">Open</span>}
        </div>
        <ProjectActionsMenu
          projectName={project.name}
          onOpen={onOpen}
          onManageTokens={onManageTokens}
          onRename={onRename}
          onDuplicate={onDuplicate}
          onExport={onExport}
          onDelete={onDelete}
        />
      </div>
      <p className="project-card-description">
        {project.description || "No description yet."}
      </p>
      <dl className="project-card-stats">
        <div>
          <dt>Chapters</dt>
          <dd>{project.chapterCount}</dd>
        </div>
        <div>
          <dt>Criteria</dt>
          <dd>{project.criterionCount}</dd>
        </div>
        <div>
          <dt>Done</dt>
          <dd>
            {project.checkedCount}/{project.criterionCount}
          </dd>
        </div>
      </dl>
      <div
        className="project-progress"
        role="progressbar"
        aria-label={`${project.name} criteria complete`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
      >
        <span style={{ width: `${progress}%` }} />
      </div>
      <div className="project-card-footer">
        <span>{formatUpdated(project.updatedAt)}</span>
        <button type="button" className="project-open-button" onClick={onOpen}>
          Open project
        </button>
      </div>
    </article>
  );
}

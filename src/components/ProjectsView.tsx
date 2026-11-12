import { ChangeEvent, useRef, useState } from "react";
import { Layers, Plus, Upload } from "lucide-react";
import { MAX_PROJECTS, ProjectSummary } from "../domain/projects";
import { ProjectCard } from "./ProjectCard";

export interface ProjectsViewProps {
  projects: ProjectSummary[];
  activeProjectId: string | null;
  standalone?: boolean;
  onOpenProject: (id: string) => void;
  onNewProject: () => void;
  onEditProject: (project: ProjectSummary) => void;
  onDuplicateProject: (project: ProjectSummary) => void;
  onExportProject: (project: ProjectSummary) => void;
  onDeleteProject: (project: ProjectSummary) => void;
  onImportProject: (text: string) => Promise<{ ok: boolean; issues: string[] }>;
}

export function ProjectsView({
  projects,
  activeProjectId,
  standalone = false,
  onOpenProject,
  onNewProject,
  onEditProject,
  onDuplicateProject,
  onExportProject,
  onDeleteProject,
  onImportProject,
}: ProjectsViewProps) {
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [importError, setImportError] = useState("");
  const atLimit = projects.length >= MAX_PROJECTS;

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

  const content = (
    <section className="projects-page">
      <div className="projects-page-header">
        <div>
          <h1>Projects</h1>
          <p>
            {projects.length} of {MAX_PROJECTS.toLocaleString()} local projects
          </p>
        </div>
        <div className="projects-page-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={atLimit}
            onClick={() => fileInput.current?.click()}
          >
            <Upload size={16} />
            Import project
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={atLimit}
            onClick={onNewProject}
          >
            <Plus size={16} />
            New project
          </button>
        </div>
      </div>

      {atLimit && (
        <p className="projects-limit" role="status">
          Project limit reached ({MAX_PROJECTS.toLocaleString()}). Delete a
          project before creating or importing another.
        </p>
      )}

      {importError && (
        <p className="form-error" role="alert">
          {importError}
        </p>
      )}

      {projects.length ? (
        <div className="projects-grid">
          {projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              active={project.id === activeProjectId}
              onOpen={() => onOpenProject(project.id)}
              onRename={() => onEditProject(project)}
              onDuplicate={() => onDuplicateProject(project)}
              onExport={() => onExportProject(project)}
              onDelete={() => onDeleteProject(project)}
            />
          ))}
        </div>
      ) : (
        <div className="projects-empty">
          <Layers size={30} />
          <h2>No projects yet</h2>
          <p>
            Create a project to start writing chapters, or import a project
            file.
          </p>
          <div>
            <button
              type="button"
              className="primary-button"
              onClick={onNewProject}
            >
              <Plus size={16} />
              Create project
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => fileInput.current?.click()}
            >
              <Upload size={16} />
              Import project
            </button>
          </div>
        </div>
      )}

      <input
        ref={fileInput}
        className="visually-hidden"
        type="file"
        accept="application/json,.json"
        aria-label="Import project file"
        onChange={handleImport}
      />
    </section>
  );

  if (!standalone) return content;

  return (
    <div className="projects-standalone">
      <header className="standalone-brand">
        <Layers size={27} />
        <span>Layers</span>
      </header>
      <main className="projects-standalone-main">{content}</main>
    </div>
  );
}

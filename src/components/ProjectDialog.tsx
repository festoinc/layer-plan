import { ChangeEvent, FormEvent, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import {
  deriveInitials,
  PROJECT_COLORS,
  ProjectColor,
  ProjectInput,
  ProjectSummary,
} from "../domain/projects";
import { useFocusTrap } from "../hooks/useFocusTrap";

export interface ProjectDialogProps {
  mode: "create" | "edit";
  project?: ProjectSummary;
  onClose: () => void;
  onSubmit: (values: ProjectInput) => { ok: boolean; issues: string[] };
}

export function ProjectDialog({
  mode,
  project,
  onClose,
  onSubmit,
}: ProjectDialogProps) {
  const [name, setName] = useState(project?.name ?? "");
  const [initials, setInitials] = useState(project?.initials ?? "");
  const [color, setColor] = useState<ProjectColor>(project?.color ?? "indigo");
  const [description, setDescription] = useState(project?.description ?? "");
  const [initialsTouched, setInitialsTouched] = useState(Boolean(project));
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useFocusTrap(true, dialogRef, onClose);

  function handleNameChange(event: ChangeEvent<HTMLInputElement>) {
    const value = event.target.value;
    setName(value);
    if (!initialsTouched) setInitials(deriveInitials(value));
  }

  function handleInitialsChange(event: ChangeEvent<HTMLInputElement>) {
    setInitialsTouched(true);
    setInitials(
      event.target.value
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 2),
    );
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("A project name is required.");
      return;
    }
    const result = onSubmit({
      name: trimmed,
      initials: initials || deriveInitials(trimmed),
      color,
      description: description.trim(),
    });
    if (!result.ok) {
      setError(result.issues.join(" ") || "The project could not be saved.");
      return;
    }
    onClose();
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="modal project-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        ref={dialogRef}
      >
        <div className="modal-header">
          <div>
            <h2 id={titleId}>
              {mode === "create" ? "New project" : "Project settings"}
            </h2>
            <p id={descriptionId}>
              {mode === "create"
                ? "Create a local project with its own chapters and activity."
                : "Change the name, initials, colour or description."}
            </p>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close project dialog"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <form onSubmit={submit}>
          <div className="project-dialog-identity">
            <label className="field">
              <span>Project name</span>
              <input
                value={name}
                onChange={handleNameChange}
                maxLength={80}
                autoFocus
                required
              />
            </label>
            <label className="field project-initials-field">
              <span>Initials</span>
              <input
                value={initials}
                onChange={handleInitialsChange}
                maxLength={2}
                aria-describedby="project-initials-hint"
              />
            </label>
          </div>
          <p className="field-hint" id="project-initials-hint">
            One or two characters shown in the sidebar and project cards.
          </p>
          <fieldset className="project-color-field">
            <legend>Colour</legend>
            <div className="project-color-options">
              {PROJECT_COLORS.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`project-color-swatch project-color-${option} ${
                    color === option ? "selected" : ""
                  }`}
                  aria-label={option}
                  aria-pressed={color === option}
                  onClick={() => setColor(option)}
                />
              ))}
            </div>
          </fieldset>
          <label className="field">
            <span>Description</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={280}
              rows={3}
              placeholder="What is this project about?"
            />
          </label>
          <p className="field-hint">{description.length}/280 characters</p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={onClose}
            >
              Cancel
            </button>
            <button type="submit" className="primary-button">
              {mode === "create" ? "Create project" : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

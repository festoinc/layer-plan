import { useId, useRef } from "react";
import { Download, X } from "lucide-react";
import { ProjectSummary } from "../domain/projects";
import { useFocusTrap } from "../hooks/useFocusTrap";

export interface DeleteProjectDialogProps {
  project: ProjectSummary;
  onClose: () => void;
  onExport: () => void;
  onDelete: () => void;
}

export function DeleteProjectDialog({
  project,
  onClose,
  onExport,
  onDelete,
}: DeleteProjectDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  useFocusTrap(true, dialogRef, onClose);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="modal delete-project-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        ref={dialogRef}
      >
        <div className="modal-header">
          <div>
            <h2 id={titleId}>Delete “{project.name}”?</h2>
            <p id={descriptionId}>
              This removes {project.chapterCount} chapter
              {project.chapterCount === 1 ? "" : "s"}, {project.criterionCount}{" "}
              criteri
              {project.criterionCount === 1 ? "on" : "a"} and the project’s
              activity from this browser.
            </p>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close delete dialog"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <p className="delete-project-note">
          Export the project first if you want to keep a copy. Deletion cannot
          be undone.
        </p>
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onExport}>
            <Download size={15} />
            Export first
          </button>
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="danger-button" onClick={onDelete}>
            Delete project
          </button>
        </div>
      </div>
    </div>
  );
}

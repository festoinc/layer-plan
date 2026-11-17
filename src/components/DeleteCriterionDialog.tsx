import { useId, useRef } from "react";
import { X } from "lucide-react";
import { useFocusTrap } from "../hooks/useFocusTrap";

export interface DeleteCriterionDialogProps {
  criterionTitle: string;
  subchapterTitle: string;
  descendantCount: number;
  parentTitle: string;
  onClose: () => void;
  onDelete: () => void;
}

export function DeleteCriterionDialog({
  criterionTitle,
  subchapterTitle,
  descendantCount,
  parentTitle,
  onClose,
  onDelete,
}: DeleteCriterionDialogProps) {
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
        className="modal delete-chapter-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        ref={dialogRef}
      >
        <div className="modal-header">
          <div>
            <h2 id={titleId}>Delete “{criterionTitle}”?</h2>
            <p id={descriptionId}>
              This removes the success criterion from “{parentTitle}” and its
              subchapter “{subchapterTitle}”
              {descendantCount > 1
                ? ` — ${descendantCount} chapters in total.`
                : "."}
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
        <p className="delete-chapter-note">
          The subchapter has its own content, so deleting the criterion also
          deletes that content. Cancel and move the content elsewhere first if
          you want to keep it.
        </p>
        <p className="delete-project-note">
          This action cannot be undone. Export the project first if you want to
          keep a copy.
        </p>
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="danger-button" onClick={onDelete}>
            Delete criterion and subchapter
          </button>
        </div>
      </div>
    </div>
  );
}

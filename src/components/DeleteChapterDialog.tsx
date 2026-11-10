import { useId, useRef } from "react";
import { X } from "lucide-react";
import { deriveCriterionTitle } from "../domain/criteria";
import { useFocusTrap } from "../hooks/useFocusTrap";

export interface DeleteChapterDialogProps {
  title: string;
  descendantCount: number;
  parentTitle?: string;
  linkedCriterionText?: string;
  onClose: () => void;
  onDelete: () => void;
}

export function DeleteChapterDialog({
  title,
  descendantCount,
  parentTitle,
  linkedCriterionText,
  onClose,
  onDelete,
}: DeleteChapterDialogProps) {
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
            <h2 id={titleId}>Delete “{title}”?</h2>
            <p id={descriptionId}>
              This deletes this chapter and everything beneath it
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
        {linkedCriterionText && parentTitle && (
          <p className="delete-chapter-note">
            The success criterion “{deriveCriterionTitle(linkedCriterionText)}”
            in “{parentTitle}” will also be removed from the checklist.
          </p>
        )}
        <p className="delete-project-note">
          This action cannot be undone. Export the project first if you want to
          keep a copy.
        </p>
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="danger-button" onClick={onDelete}>
            Delete chapter
          </button>
        </div>
      </div>
    </div>
  );
}

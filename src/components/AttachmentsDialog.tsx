import {
  ChangeEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Download, FileText, Paperclip, Trash2, Upload, X } from "lucide-react";
import { errorMessage } from "../api/client";
import {
  deleteAttachment,
  downloadAttachment,
  fileToBase64,
  listAttachments,
  uploadAttachment,
} from "../api/attachments";
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_EXTENSIONS,
  attachmentTypeFor,
  formatAttachmentSize,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  type AttachmentInfo,
} from "../domain/attachments";
import { ProjectSummary } from "../domain/projects";
import { useFocusTrap } from "../hooks/useFocusTrap";

export interface AttachmentsDialogProps {
  project: ProjectSummary;
  onClose: () => void;
}

export function AttachmentsDialog({
  project,
  onClose,
}: AttachmentsDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [attachments, setAttachments] = useState<AttachmentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [uploading, setUploading] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  useFocusTrap(true, dialogRef, onClose);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await listAttachments(project.id);
      setAttachments(result.attachments);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function uploadFiles(files: File[]) {
    if (uploading || !files.length) return;
    setError("");
    setNotice("");
    setPendingDelete(null);

    const accepted: File[] = [];
    const problems: string[] = [];
    let remaining = MAX_ATTACHMENTS - attachments.length;
    for (const file of files) {
      if (!attachmentTypeFor(file.name)) {
        problems.push(`${file.name}: unsupported file type.`);
        continue;
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        problems.push(`${file.name}: larger than 10 MiB.`);
        continue;
      }
      if (remaining <= 0) {
        problems.push("The 20-attachment limit was reached.");
        break;
      }
      accepted.push(file);
      remaining -= 1;
    }

    let uploaded = 0;
    for (const file of accepted) {
      setUploading(file.name);
      try {
        const contentBase64 = await fileToBase64(file);
        const attachment = await uploadAttachment(project.id, {
          filename: file.name,
          contentBase64,
        });
        uploaded += 1;
        setAttachments((previous) =>
          [
            attachment,
            ...previous.filter((item) => item.id !== attachment.id),
          ].slice(0, MAX_ATTACHMENTS),
        );
      } catch (caught) {
        problems.push(`${file.name}: ${errorMessage(caught)}`);
      }
    }
    setUploading(null);
    if (problems.length) setError(problems.join(" "));
    else if (uploaded)
      setNotice(`${uploaded} attachment${uploaded === 1 ? "" : "s"} added.`);
  }

  function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    void uploadFiles(files);
  }

  async function remove(attachment: AttachmentInfo) {
    setDeleting(attachment.id);
    setError("");
    setNotice("");
    try {
      await deleteAttachment(project.id, attachment.id);
      setAttachments((previous) =>
        previous.filter((item) => item.id !== attachment.id),
      );
      setPendingDelete(null);
      setNotice(`${attachment.filename} removed.`);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setDeleting(null);
    }
  }

  async function download(attachment: AttachmentInfo) {
    setError("");
    try {
      const result = await downloadAttachment(project.id, attachment.id);
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.filename ?? attachment.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  const busy = loading || uploading !== null;

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="modal attachments-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        ref={dialogRef}
      >
        <div className="modal-header">
          <div>
            <h2 id={titleId}>Attachments for {project.name}</h2>
            <p id={descriptionId}>
              Files attached to this project document. Up to {MAX_ATTACHMENTS}{" "}
              files, {formatAttachmentSize(MAX_ATTACHMENT_BYTES)} each:{" "}
              {ATTACHMENT_EXTENSIONS.join(", ")}.
            </p>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close attachments dialog"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        <div className="attachments-toolbar">
          <button
            type="button"
            className="secondary-button"
            disabled={busy || attachments.length >= MAX_ATTACHMENTS}
            onClick={() => fileInput.current?.click()}
          >
            <Upload size={15} />
            {uploading ? `Uploading ${uploading}…` : "Choose files"}
          </button>
          <span className="attachments-count">
            {attachments.length} of {MAX_ATTACHMENTS}
          </span>
          <input
            ref={fileInput}
            className="visually-hidden"
            type="file"
            multiple
            accept={ATTACHMENT_ACCEPT}
            aria-label="Attach files"
            disabled={busy || attachments.length >= MAX_ATTACHMENTS}
            onChange={handleFiles}
          />
        </div>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="attachments-notice" role="status">
            {notice}
          </p>
        )}

        {loading ? (
          <p className="attachments-empty">Loading attachments…</p>
        ) : attachments.length ? (
          <ul className="attachment-list">
            {attachments.map((attachment) => (
              <li key={attachment.id}>
                <span className="attachment-icon" aria-hidden="true">
                  <FileText size={17} />
                </span>
                <div className="attachment-details">
                  <strong>{attachment.filename}</strong>
                  <span>
                    {attachment.contentType} ·{" "}
                    {formatAttachmentSize(attachment.sizeBytes)} ·{" "}
                    {new Date(attachment.createdAt).toLocaleString()}
                    {attachment.createdByName
                      ? ` · ${attachment.createdByName}`
                      : ""}
                  </span>
                </div>
                <div className="attachment-actions">
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Download ${attachment.filename}`}
                    title="Download"
                    onClick={() => void download(attachment)}
                  >
                    <Download size={15} />
                  </button>
                  {pendingDelete === attachment.id ? (
                    <>
                      <button
                        type="button"
                        className="danger-button attachment-delete"
                        disabled={deleting === attachment.id}
                        onClick={() => void remove(attachment)}
                      >
                        {deleting === attachment.id ? "Deleting…" : "Confirm"}
                      </button>
                      <button
                        type="button"
                        className="secondary-button attachment-cancel"
                        disabled={deleting === attachment.id}
                        onClick={() => setPendingDelete(null)}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="icon-button attachment-remove"
                      aria-label={`Delete ${attachment.filename}`}
                      title="Delete attachment"
                      onClick={() => setPendingDelete(attachment.id)}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="attachments-empty">
            <Paperclip size={18} />
            No attachments yet. Add a document, image, spreadsheet or text file.
          </p>
        )}
      </div>
    </div>
  );
}

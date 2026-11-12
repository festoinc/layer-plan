import { X } from "lucide-react";
import type { ApiNotice, WorkspaceStatus } from "../api/types";

export interface StorageBannerProps {
  notices: ApiNotice[];
  status: WorkspaceStatus;
  onRetry?: () => void;
  onReload?: () => void;
  onOverwrite?: () => void;
  onDismiss?: () => void;
  onExport?: () => void;
}

export function StorageBanner({
  notices,
  status,
  onRetry,
  onReload,
  onOverwrite,
  onDismiss,
  onExport,
}: StorageBannerProps) {
  const failed = status.state === "error";
  const conflict = status.state === "conflict";

  if (!notices.length && !failed && !conflict) return null;

  return (
    <div className="storage-banners">
      {failed && (
        <div className="storage-banner storage-banner-error" role="alert">
          <p>{status.message} Retry the request before closing.</p>
          <div className="storage-banner-actions">
            {onRetry && (
              <button type="button" onClick={onRetry}>
                Retry saving
              </button>
            )}
            {onExport && (
              <button type="button" onClick={onExport}>
                Export project
              </button>
            )}
          </div>
        </div>
      )}
      {conflict && (
        <div className="storage-banner storage-banner-error" role="alert">
          <p>{status.message}</p>
          <div className="storage-banner-actions">
            {onReload && (
              <button type="button" onClick={onReload}>
                Reload latest
              </button>
            )}
            {onOverwrite && (
              <button type="button" onClick={onOverwrite}>
                Overwrite server
              </button>
            )}
            {onExport && (
              <button type="button" onClick={onExport}>
                Export project
              </button>
            )}
          </div>
        </div>
      )}
      {notices.map((notice, index) => (
        <div
          key={`${notice.message}-${index}`}
          className={`storage-banner ${
            notice.level === "info"
              ? "storage-banner-info"
              : "storage-banner-error"
          }`}
          role={notice.level === "info" ? "status" : "alert"}
        >
          <p>{notice.message}</p>
          {onDismiss && (
            <div className="storage-banner-actions">
              <button type="button" onClick={onDismiss}>
                <X size={13} />
                Dismiss
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

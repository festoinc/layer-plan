import { X } from "lucide-react";
import { StorageNotice, RepositoryStatus } from "../store/persistence";

export interface StorageBannerProps {
  notices: StorageNotice[];
  status: RepositoryStatus;
  onRetry: () => void;
  onDismiss: () => void;
  onExport: () => void;
}

export function StorageBanner({
  notices,
  status,
  onRetry,
  onDismiss,
  onExport,
}: StorageBannerProps) {
  const failed = status.state === "error";
  const unavailable = status.state === "unavailable";

  if (!notices.length && !failed && !unavailable) return null;

  return (
    <div className="storage-banners">
      {(failed || unavailable) && (
        <div
          className={`storage-banner ${failed ? "storage-banner-error" : "storage-banner-info"}`}
          role={failed ? "alert" : "status"}
        >
          <p>
            {failed
              ? `${status.message} Retry, or download a backup before closing.`
              : status.message}
          </p>
          <div className="storage-banner-actions">
            {failed && (
              <button type="button" onClick={onRetry}>
                Retry saving
              </button>
            )}
            <button type="button" onClick={onExport}>
              Download backup
            </button>
          </div>
        </div>
      )}
      {notices.map((notice, index) => (
        <div
          key={`${notice.message}-${index}`}
          className={`storage-banner storage-banner-${notice.level === "warning" ? "error" : "info"}`}
          role={notice.level === "warning" ? "alert" : "status"}
        >
          <p>
            {notice.message}
            {notice.backupKey ? ` Backup key: ${notice.backupKey}` : ""}
          </p>
          <div className="storage-banner-actions">
            <button type="button" onClick={onDismiss}>
              <X size={13} />
              Dismiss
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

import { ChevronRight, CircleCheck, Menu } from "lucide-react";
import { RepositoryStatus } from "../store/persistence";
import { useWorkspaceStatus } from "../store/WorkspaceProvider";

export interface TopbarProps {
  projectName: string;
  view: string;
  rootTitle: string;
  status?: RepositoryStatus;
  onOpenNav: () => void;
}

export function Topbar({
  projectName,
  view,
  rootTitle,
  status: statusProp,
  onOpenNav,
}: TopbarProps) {
  const statusContext = useWorkspaceStatus();
  const status = statusProp ?? statusContext.status;
  const saved = status.state === "saved";
  const label = saved
    ? "All changes saved"
    : status.state === "pending"
      ? "Saving changes…"
      : "Changes are not saved";

  return (
    <header className="topbar">
      <button
        className="icon-button open-nav"
        aria-label="Open chapters"
        onClick={onOpenNav}
      >
        <Menu size={19} />
      </button>
      <span>{projectName}</span>
      <ChevronRight size={13} />
      <span>{view === "Specifications" ? rootTitle : view}</span>
      <div
        className="save-status"
        role="status"
        aria-live="polite"
        title={status.message}
      >
        {saved ? (
          <>
            <CircleCheck size={16} />
            {label}
          </>
        ) : (
          label
        )}
      </div>
    </header>
  );
}

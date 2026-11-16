import { ChevronRight, CircleCheck, Menu } from "lucide-react";
import type { WorkspaceStatus } from "../api/types";
import { useWorkspaceStatus } from "../store/WorkspaceProvider";
import { UserMenu } from "./UserMenu";

export interface TopbarProps {
  projectName: string;
  view: string;
  rootTitle: string;
  status?: WorkspaceStatus;
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
      : status.state === "conflict"
        ? "Save conflict"
        : status.state === "loading"
          ? "Loading project…"
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
      <UserMenu />
    </header>
  );
}

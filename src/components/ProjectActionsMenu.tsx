import { useCallback, useEffect, useRef, useState } from "react";
import {
  Download,
  MoreHorizontal,
  Pencil,
  Copy,
  Trash2,
  ExternalLink,
  KeyRound,
} from "lucide-react";
import { useFocusTrap } from "../hooks/useFocusTrap";

export interface ProjectActionsMenuProps {
  projectName: string;
  onOpen: () => void;
  onManageTokens: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onExport: () => void;
  onDelete: () => void;
}

export function ProjectActionsMenu({
  projectName,
  onOpen,
  onManageTokens,
  onRename,
  onDuplicate,
  onExport,
  onDelete,
}: ProjectActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => setOpen(false), []);
  useFocusTrap(open, menuRef, close);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open, close]);

  function run(action: () => void) {
    close();
    action();
  }

  return (
    <div className="project-actions" ref={containerRef}>
      <button
        type="button"
        className="icon-button project-actions-trigger"
        aria-label={`Actions for ${projectName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreHorizontal size={18} />
      </button>
      {open && (
        <div className="project-actions-menu" role="menu" ref={menuRef}>
          <button type="button" role="menuitem" onClick={() => run(onOpen)}>
            <ExternalLink size={15} />
            Open
          </button>
          <button type="button" role="menuitem" onClick={() => run(onRename)}>
            <Pencil size={15} />
            Rename and settings
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => run(onManageTokens)}
          >
            <KeyRound size={15} />
            MCP access
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => run(onDuplicate)}
          >
            <Copy size={15} />
            Duplicate
          </button>
          <button type="button" role="menuitem" onClick={() => run(onExport)}>
            <Download size={15} />
            Export
          </button>
          <div className="project-menu-separator" />
          <button
            type="button"
            role="menuitem"
            className="project-actions-danger"
            onClick={() => run(onDelete)}
          >
            <Trash2 size={15} />
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

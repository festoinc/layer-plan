import { memo } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  Plus,
} from "lucide-react";
import { ChapterForm } from "./ChapterForm.jsx";

/**
 * @param {{
 *   node: import("../hooks/useChapterTree.js").TreeNode,
 *   selectedId: string|null,
 *   activeView: string,
 *   collapsed: Set<string>,
 *   creating: { parentId: string|null }|null,
 *   chapterTitle: string,
 *   onTitleChange: (value: string) => void,
 *   onSubmit: (event: React.FormEvent<HTMLFormElement>) => void,
 *   onCancel: () => void,
 *   onSelect: (id: string) => void,
 *   onToggleCollapsed: (id: string) => void,
 *   onStartChapter: (parentId: string) => void,
 * }} props
 */
function ChapterNodeComponent({
  node,
  selectedId,
  activeView,
  collapsed,
  creating,
  chapterTitle,
  onTitleChange,
  onSubmit,
  onCancel,
  onSelect,
  onToggleCollapsed,
  onStartChapter,
}) {
  const { chapter, children } = node;
  const isOpen = !collapsed.has(chapter.id);
  const hasChildren = children.length > 0 || creating?.parentId === chapter.id;
  const title = chapter.title || "Untitled chapter";
  const selected = activeView === "specifications" && selectedId === chapter.id;

  return (
    <li className="chapter-item">
      <div className={`chapter-row ${selected ? "selected" : ""}`}>
        {hasChildren ? (
          <button
            className="tree-toggle"
            aria-label={`${isOpen ? "Collapse" : "Expand"} ${title}`}
            aria-expanded={isOpen}
            onClick={() => onToggleCollapsed(chapter.id)}
          >
            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : (
          <span className="tree-toggle tree-leaf">
            <FileText size={14} />
          </span>
        )}
        {hasChildren && <Folder className="chapter-folder" size={17} />}
        <button
          className="chapter-link"
          aria-current={selected ? "page" : undefined}
          onClick={() => onSelect(chapter.id)}
        >
          {title}
        </button>
        <button
          className="chapter-add icon-button"
          aria-label={`Add subchapter to ${title}`}
          title="Add subchapter"
          onClick={() => onStartChapter(chapter.id)}
        >
          <Plus size={14} />
        </button>
      </div>
      {hasChildren && isOpen && (
        <ul className="chapter-children">
          {children.map((child) => (
            <ChapterNode
              key={child.chapter.id}
              node={child}
              selectedId={selectedId}
              activeView={activeView}
              collapsed={collapsed}
              creating={creating}
              chapterTitle={chapterTitle}
              onTitleChange={onTitleChange}
              onSubmit={onSubmit}
              onCancel={onCancel}
              onSelect={onSelect}
              onToggleCollapsed={onToggleCollapsed}
              onStartChapter={onStartChapter}
            />
          ))}
          {creating?.parentId === chapter.id && (
            <li>
              <ChapterForm
                title={chapterTitle}
                onTitleChange={onTitleChange}
                onSubmit={onSubmit}
                onCancel={onCancel}
              />
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

/**
 * Rows are only re-rendered when their own chapter (or a descendant) changed,
 * or when selection/collapse state changed. The form stays live while open.
 */
export const ChapterNode = memo(ChapterNodeComponent, (previous, next) => {
  if (previous.node !== next.node) return false;
  if (previous.selectedId !== next.selectedId) return false;
  if (previous.activeView !== next.activeView) return false;
  if (previous.collapsed !== next.collapsed) return false;
  if (previous.creating?.parentId !== next.creating?.parentId) return false;
  // A node that hosts the open create form must always receive the latest
  // controlled input value and handlers.
  if (next.creating?.parentId === next.node.chapter.id) return false;
  return (
    previous.onSelect === next.onSelect &&
    previous.onToggleCollapsed === next.onToggleCollapsed &&
    previous.onStartChapter === next.onStartChapter &&
    previous.onSubmit === next.onSubmit &&
    previous.onCancel === next.onCancel &&
    previous.onTitleChange === next.onTitleChange
  );
});

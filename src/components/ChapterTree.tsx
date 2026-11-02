import { FormEvent } from "react";
import { ChapterForm } from "./ChapterForm";
import { ChapterNode } from "./ChapterNode";
import { TreeNode } from "../hooks/useChapterTree";

export interface ChapterTreeProps {
  nodes: TreeNode[];
  selectedId: string | null;
  activeView: string;
  collapsed: Set<string>;
  creating: { parentId: string | null } | null;
  chapterTitle: string;
  onTitleChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
  onSelect: (id: string) => void;
  onToggleCollapsed: (id: string) => void;
  onStartChapter: (parentId: string) => void;
}

export function ChapterTree({
  nodes,
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
}: ChapterTreeProps) {
  return (
    <ul className="chapter-tree">
      {nodes.map((node) => (
        <ChapterNode
          key={node.chapter.id}
          node={node}
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
      {creating?.parentId === null && (
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
  );
}

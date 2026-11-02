import { useMemo } from "react";
import { Chapter, ChapterDocument } from "../domain/chapters";

export interface TreeNode {
  chapter: Chapter;
  children: TreeNode[];
}

const nodeCache = new WeakMap<Chapter, TreeNode>();

function sameNodes(a: TreeNode[], b: TreeNode[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

/**
 * Build a render tree that keeps node identity for untouched subtrees, so
 * memoized sidebar rows only re-render when their chapter actually changes.
 */
export function useChapterTree(document: ChapterDocument): TreeNode[] {
  return useMemo(() => {
    const build = (id: string): TreeNode | null => {
      const chapter = document.byId[id];
      if (!chapter) return null;
      const children = chapter.childIds
        .map(build)
        .filter((node): node is TreeNode => Boolean(node));
      const cached = nodeCache.get(chapter);
      if (cached && sameNodes(cached.children, children)) return cached;
      const node: TreeNode = { chapter, children };
      nodeCache.set(chapter, node);
      return node;
    };

    return document.rootIds
      .map(build)
      .filter((node): node is TreeNode => Boolean(node));
  }, [document]);
}

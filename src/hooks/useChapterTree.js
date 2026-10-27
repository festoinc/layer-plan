import { useMemo } from "react";

/**
 * @typedef {import("../domain/chapters.js").Chapter} Chapter
 * @typedef {{ chapter: Chapter, children: TreeNode[] }} TreeNode
 */

/**
 * Cache keyed by chapter object. Reducers reuse unchanged chapter objects, so
 * a cached node is still valid as long as the chapter and all of its child
 * nodes are the same objects.
 *
 * @type {WeakMap<Chapter, TreeNode>}
 */
const nodeCache = new WeakMap();

/** @param {TreeNode[]} a @param {TreeNode[]} b */
function sameNodes(a, b) {
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
 *
 * @param {import("../domain/chapters.js").ChapterDocument} document
 * @returns {TreeNode[]}
 */
export function useChapterTree(document) {
  return useMemo(() => {
    /** @param {string} id @returns {TreeNode|null} */
    const build = (id) => {
      const chapter = document.byId[id];
      if (!chapter) return null;
      const children = chapter.childIds.map(build).filter(Boolean);
      const cached = nodeCache.get(chapter);
      if (cached && sameNodes(cached.children, children)) return cached;
      const node = { chapter, children };
      nodeCache.set(chapter, node);
      return node;
    };

    return document.rootIds.map(build).filter(Boolean);
  }, [document]);
}

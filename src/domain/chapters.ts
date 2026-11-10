import {
  createDefaultVerification,
  type VerificationRule,
} from "./verificationTypes";

/**
 * Normalized chapter document operations.
 *
 * The document is a flat map plus an ordered list of root ids. Chapter and
 * criterion records are never mutated; every operation returns a new document
 * that shares untouched records with the previous one.
 */

export interface Criterion {
  id: string;
  text: string;
  checked: boolean;
  chapterId?: string; // ID of the subchapter created from this criterion.
}

export interface Chapter {
  id: string;
  parentId: string | null;
  title: string;
  description: string;
  finalLevel: boolean;
  verification: VerificationRule;
  criteria: Criterion[];
  childIds: string[];
}

export interface ChapterDocument {
  byId: Record<string, Chapter>;
  rootIds: string[];
}

export function createEmptyDocument(): ChapterDocument {
  return { byId: {}, rootIds: [] };
}

export function createChapter(
  input: Partial<Chapter> & { id: string },
): Chapter {
  return {
    id: input.id,
    parentId: input.parentId ?? null,
    title: input.title ?? "Untitled chapter",
    description: input.description ?? "",
    finalLevel: Boolean(input.finalLevel),
    verification: input.verification ?? createDefaultVerification(),
    criteria: input.criteria ? [...input.criteria] : [],
    childIds: input.childIds ? [...input.childIds] : [],
  };
}

export function getChapter(
  document: ChapterDocument,
  id: string | null | undefined,
): Chapter | null {
  if (!id) return null;
  return document.byId[id] ?? null;
}

export function getChildren(
  document: ChapterDocument,
  parentId: string | null,
): Chapter[] {
  const ids = parentId ? document.byId[parentId]?.childIds : document.rootIds;
  if (!ids) return [];
  return ids
    .map((id) => document.byId[id])
    .filter((ch): ch is Chapter => Boolean(ch));
}

export function getRoots(document: ChapterDocument): Chapter[] {
  return getChildren(document, null);
}

/**
 * Root-to-chapter path, or an empty array when the id is unknown.
 */
export function getPath(
  document: ChapterDocument,
  id: string | null | undefined,
): Chapter[] {
  const path: Chapter[] = [];
  let current = getChapter(document, id);
  const guard = new Set<string>();
  while (current && !guard.has(current.id)) {
    guard.add(current.id);
    path.unshift(current);
    current = current.parentId ? getChapter(document, current.parentId) : null;
  }
  return path;
}

/**
 * Pick a usable selected id, falling back to the first root chapter.
 */
export function getDefaultId(
  document: ChapterDocument,
  preferredId: string | null | undefined,
): string | null {
  if (preferredId && document.byId[preferredId]) return preferredId;
  return document.rootIds[0] ?? null;
}

/**
 * Pre-order traversal over the whole document.
 */
export function walkChapters(document: ChapterDocument): Chapter[] {
  const result: Chapter[] = [];
  const guard = new Set<string>();
  const visit = (id: string) => {
    const chapter = document.byId[id];
    if (!chapter || guard.has(id)) return;
    guard.add(id);
    result.push(chapter);
    chapter.childIds.forEach(visit);
  };
  document.rootIds.forEach(visit);
  return result;
}

export function patchChapter(
  document: ChapterDocument,
  id: string,
  patch: Partial<Chapter>,
): ChapterDocument {
  const current = document.byId[id];
  if (!current) return document;
  return {
    ...document,
    byId: { ...document.byId, [id]: { ...current, ...patch, id } },
  };
}

export function setCriteria(
  document: ChapterDocument,
  id: string,
  criteria: Criterion[],
): ChapterDocument {
  return patchChapter(document, id, { criteria });
}

/**
 * Append or insert a chapter under a parent (or at the root).
 */
export function insertChapter(
  document: ChapterDocument,
  chapter: Chapter,
  { index }: { index?: number } = {},
): ChapterDocument {
  if (document.byId[chapter.id]) return document;
  const parentId = chapter.parentId ?? null;
  if (parentId && !document.byId[parentId]) return document;

  const byId = {
    ...document.byId,
    [chapter.id]: { ...chapter, parentId, childIds: [...chapter.childIds] },
  };

  const addAt = (ids: string[]) => {
    const next = [...ids];
    const at =
      typeof index === "number" && index >= 0 && index <= next.length
        ? index
        : next.length;
    next.splice(at, 0, chapter.id);
    return next;
  };

  if (!parentId) {
    return { byId, rootIds: addAt(document.rootIds) };
  }

  const parent = document.byId[parentId];
  byId[parentId] = { ...parent, childIds: addAt(parent.childIds) };
  return { byId, rootIds: document.rootIds };
}

/**
 * @returns ids of the removed chapter and its descendants
 */
export function collectSubtreeIds(
  document: ChapterDocument,
  id: string,
): string[] {
  const result: string[] = [];
  const guard = new Set<string>();
  const visit = (currentId: string) => {
    const chapter = document.byId[currentId];
    if (!chapter || guard.has(currentId)) return;
    guard.add(currentId);
    result.push(currentId);
    chapter.childIds.forEach(visit);
  };
  visit(id);
  return result;
}

/**
 * Delete a chapter and its descendants. Criteria elsewhere that linked to a
 * removed chapter are removed with it, so removing a criterion-created
 * subchapter also removes its parent checklist item.
 */
export function deleteSubtree(
  document: ChapterDocument,
  id: string,
): { document: ChapterDocument; removedIds: string[] } {
  const chapter = document.byId[id];
  if (!chapter) return { document, removedIds: [] };
  const removedIds = collectSubtreeIds(document, id);
  const removed = new Set(removedIds);

  const byId: Record<string, Chapter> = {};
  for (const [key, value] of Object.entries(document.byId)) {
    if (removed.has(key)) continue;
    const criteria = value.criteria.filter(
      (criterion) => !criterion.chapterId || !removed.has(criterion.chapterId),
    );
    byId[key] =
      criteria.length !== value.criteria.length
        ? { ...value, criteria }
        : value;
  }

  const parentId = chapter.parentId;
  if (parentId && byId[parentId]) {
    byId[parentId] = {
      ...byId[parentId],
      childIds: byId[parentId].childIds.filter((childId) => childId !== id),
    };
  }

  return {
    document: {
      byId,
      rootIds: document.rootIds.filter((rootId) => rootId !== id),
    },
    removedIds,
  };
}

export function isDescendant(
  document: ChapterDocument,
  ancestorId: string,
  candidateId: string,
): boolean {
  let current: Chapter | null = document.byId[candidateId];
  const guard = new Set<string>();
  while (current?.parentId) {
    if (current.parentId === ancestorId) return true;
    if (guard.has(current.parentId)) return false;
    guard.add(current.parentId);
    current = document.byId[current.parentId] ?? null;
  }
  return false;
}

/**
 * Move a chapter to another parent (or the root) at an optional index.
 * Moving a chapter into its own subtree is rejected.
 */
export function moveChapter(
  document: ChapterDocument,
  id: string,
  parentId: string | null,
  index?: number,
): ChapterDocument {
  const chapter = document.byId[id];
  if (!chapter) return document;
  if (parentId && !document.byId[parentId]) return document;
  if (parentId === id || (parentId && isDescendant(document, id, parentId))) {
    return document;
  }

  const byId = { ...document.byId };
  let rootIds = document.rootIds;
  const currentParentId = chapter.parentId;

  if (currentParentId && byId[currentParentId]) {
    byId[currentParentId] = {
      ...byId[currentParentId],
      childIds: byId[currentParentId].childIds.filter(
        (childId) => childId !== id,
      ),
    };
  } else {
    rootIds = rootIds.filter((rootId) => rootId !== id);
  }

  const insertAt = (ids: string[]) => {
    const next = [...ids];
    const at =
      typeof index === "number" && index >= 0 && index <= next.length
        ? index
        : next.length;
    next.splice(at, 0, id);
    return next;
  };

  byId[id] = { ...chapter, parentId: parentId ?? null };
  if (parentId) {
    byId[parentId] = {
      ...byId[parentId],
      childIds: insertAt(byId[parentId].childIds),
    };
  } else {
    rootIds = insertAt(rootIds);
  }

  return { byId, rootIds };
}

export function moveCriterion(
  document: ChapterDocument,
  chapterId: string,
  criterionId: string,
  toIndex: number,
): ChapterDocument {
  const chapter = document.byId[chapterId];
  if (!chapter) return document;
  const fromIndex = chapter.criteria.findIndex(
    (criterion) => criterion.id === criterionId,
  );
  if (fromIndex < 0) return document;
  return reorderCriteria(document, chapterId, fromIndex, toIndex);
}

export function reorderCriteria(
  document: ChapterDocument,
  chapterId: string,
  fromIndex: number,
  toIndex: number,
): ChapterDocument {
  const chapter = document.byId[chapterId];
  if (!chapter) return document;
  const criteria = [...chapter.criteria];
  if (
    fromIndex < 0 ||
    fromIndex >= criteria.length ||
    toIndex < 0 ||
    toIndex >= criteria.length
  ) {
    return document;
  }
  const [moved] = criteria.splice(fromIndex, 1);
  criteria.splice(toIndex, 0, moved);
  return patchChapter(document, chapterId, { criteria });
}

/**
 * Deep copy a chapter subtree, assigning fresh chapter and criterion ids.
 * The copy is inserted directly after the original under the same parent.
 */
export function duplicateSubtree(
  document: ChapterDocument,
  id: string,
  newId: () => string,
): { document: ChapterDocument; chapterId: string | null } {
  const original = document.byId[id];
  if (!original) return { document, chapterId: null };

  const idMap = new Map<string, string>();
  const cloneIds = collectSubtreeIds(document, id);
  for (const originalId of cloneIds) idMap.set(originalId, newId());

  const clones: Record<string, Chapter> = {};
  for (const originalId of cloneIds) {
    const source = document.byId[originalId];
    const mappedId = idMap.get(originalId)!;
    clones[mappedId] = {
      ...source,
      id: mappedId,
      parentId:
        source.parentId === null
          ? null
          : (idMap.get(source.parentId) ?? source.parentId),
      criteria: source.criteria.map((criterion) => ({
        ...criterion,
        id: newId(),
        chapterId: criterion.chapterId
          ? idMap.get(criterion.chapterId)
          : undefined,
      })),
      childIds: source.childIds.map((childId) => idMap.get(childId)!),
    };
  }

  const duplicateId = idMap.get(id)!;
  let byId = { ...document.byId, ...clones };
  let rootIds = document.rootIds;

  const parentId = original.parentId;
  const siblings = parentId ? byId[parentId].childIds : document.rootIds;
  const position = siblings.indexOf(id) + 1;

  if (parentId) {
    const childIds = [...siblings];
    childIds.splice(position, 0, duplicateId);
    byId = { ...byId, [parentId]: { ...byId[parentId], childIds } };
  } else {
    rootIds = [...rootIds];
    rootIds.splice(position, 0, duplicateId);
  }

  return { document: { byId, rootIds }, chapterId: duplicateId };
}

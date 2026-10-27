/**
 * Normalized chapter document operations.
 *
 * The document is a flat map plus an ordered list of root ids. Chapter and
 * criterion records are never mutated; every operation returns a new document
 * that shares untouched records with the previous one.
 *
 * @typedef {Object} Criterion
 * @property {string} id
 * @property {string} text
 * @property {boolean} checked
 * @property {string} [chapterId] ID of the subchapter created from this criterion.
 *
 * @typedef {Object} Chapter
 * @property {string} id
 * @property {string|null} parentId
 * @property {string} title
 * @property {string} description
 * @property {boolean} finalLevel
 * @property {Criterion[]} criteria
 * @property {string[]} childIds
 *
 * @typedef {Object} ChapterDocument
 * @property {Record<string, Chapter>} byId
 * @property {string[]} rootIds
 */

/** @returns {ChapterDocument} */
export function createEmptyDocument() {
  return { byId: {}, rootIds: [] };
}

/**
 * @param {Partial<Chapter> & { id: string }} input
 * @returns {Chapter}
 */
export function createChapter(input) {
  return {
    id: input.id,
    parentId: input.parentId ?? null,
    title: input.title ?? "Untitled chapter",
    description: input.description ?? "",
    finalLevel: Boolean(input.finalLevel),
    criteria: input.criteria ? [...input.criteria] : [],
    childIds: input.childIds ? [...input.childIds] : [],
  };
}

/**
 * @param {ChapterDocument} document
 * @param {string|null|undefined} id
 * @returns {Chapter|null}
 */
export function getChapter(document, id) {
  if (!id) return null;
  return document.byId[id] ?? null;
}

/**
 * @param {ChapterDocument} document
 * @param {string|null} parentId
 * @returns {Chapter[]}
 */
export function getChildren(document, parentId) {
  const ids = parentId ? document.byId[parentId]?.childIds : document.rootIds;
  if (!ids) return [];
  return ids.map((id) => document.byId[id]).filter(Boolean);
}

/** @param {ChapterDocument} document */
export function getRoots(document) {
  return getChildren(document, null);
}

/**
 * Root-to-chapter path, or an empty array when the id is unknown.
 *
 * @param {ChapterDocument} document
 * @param {string|null|undefined} id
 * @returns {Chapter[]}
 */
export function getPath(document, id) {
  const path = [];
  let current = getChapter(document, id);
  const guard = new Set();
  while (current && !guard.has(current.id)) {
    guard.add(current.id);
    path.unshift(current);
    current = current.parentId ? getChapter(document, current.parentId) : null;
  }
  return path;
}

/**
 * Pick a usable selected id, falling back to the first root chapter.
 *
 * @param {ChapterDocument} document
 * @param {string|null|undefined} preferredId
 * @returns {string|null}
 */
export function getDefaultId(document, preferredId) {
  if (preferredId && document.byId[preferredId]) return preferredId;
  return document.rootIds[0] ?? null;
}

/**
 * Pre-order traversal over the whole document.
 *
 * @param {ChapterDocument} document
 * @returns {Chapter[]}
 */
export function walkChapters(document) {
  /** @type {Chapter[]} */
  const result = [];
  const guard = new Set();
  /** @param {string} id */
  const visit = (id) => {
    const chapter = document.byId[id];
    if (!chapter || guard.has(id)) return;
    guard.add(id);
    result.push(chapter);
    chapter.childIds.forEach(visit);
  };
  document.rootIds.forEach(visit);
  return result;
}

/**
 * @param {ChapterDocument} document
 * @param {string} id
 * @param {Partial<Chapter>} patch
 * @returns {ChapterDocument}
 */
export function patchChapter(document, id, patch) {
  const current = document.byId[id];
  if (!current) return document;
  return {
    ...document,
    byId: { ...document.byId, [id]: { ...current, ...patch, id } },
  };
}

/**
 * @param {ChapterDocument} document
 * @param {string} id
 * @param {Criterion[]} criteria
 * @returns {ChapterDocument}
 */
export function setCriteria(document, id, criteria) {
  return patchChapter(document, id, { criteria });
}

/**
 * Append or insert a chapter under a parent (or at the root).
 *
 * @param {ChapterDocument} document
 * @param {Chapter} chapter
 * @param {{ index?: number }} [options]
 * @returns {ChapterDocument}
 */
export function insertChapter(document, chapter, { index } = {}) {
  if (document.byId[chapter.id]) return document;
  const parentId = chapter.parentId ?? null;
  if (parentId && !document.byId[parentId]) return document;

  const byId = {
    ...document.byId,
    [chapter.id]: { ...chapter, parentId, childIds: [...chapter.childIds] },
  };

  /** @param {string[]} ids @returns {string[]} */
  const addAt = (ids) => {
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
 * @param {ChapterDocument} document
 * @param {string} id
 * @returns {string[]} ids of the removed chapter and its descendants
 */
export function collectSubtreeIds(document, id) {
  /** @type {string[]} */
  const result = [];
  const guard = new Set();
  /** @param {string} currentId */
  const visit = (currentId) => {
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
 * removed chapter keep their text but lose the dangling link.
 *
 * @param {ChapterDocument} document
 * @param {string} id
 * @returns {{ document: ChapterDocument, removedIds: string[] }}
 */
export function deleteSubtree(document, id) {
  const chapter = document.byId[id];
  if (!chapter) return { document, removedIds: [] };
  const removedIds = collectSubtreeIds(document, id);
  const removed = new Set(removedIds);

  /** @type {Record<string, Chapter>} */
  const byId = {};
  for (const [key, value] of Object.entries(document.byId)) {
    if (removed.has(key)) continue;
    const criteria = value.criteria.map((criterion) => {
      if (!criterion.chapterId || !removed.has(criterion.chapterId)) {
        return criterion;
      }
      const { chapterId: _removedId, ...rest } = criterion;
      return rest;
    });
    byId[key] = criteria.some((item, index) => item !== value.criteria[index])
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

/**
 * @param {ChapterDocument} document
 * @param {string} ancestorId
 * @param {string} candidateId
 * @returns {boolean}
 */
export function isDescendant(document, ancestorId, candidateId) {
  let current = document.byId[candidateId];
  const guard = new Set();
  while (current?.parentId) {
    if (current.parentId === ancestorId) return true;
    if (guard.has(current.parentId)) return false;
    guard.add(current.parentId);
    current = document.byId[current.parentId];
  }
  return false;
}

/**
 * Move a chapter to another parent (or the root) at an optional index.
 * Moving a chapter into its own subtree is rejected.
 *
 * @param {ChapterDocument} document
 * @param {string} id
 * @param {string|null} parentId
 * @param {number} [index]
 * @returns {ChapterDocument}
 */
export function moveChapter(document, id, parentId, index) {
  const chapter = document.byId[id];
  if (!chapter) return document;
  if (parentId && !document.byId[parentId]) return document;
  if (parentId === id || (parentId && isDescendant(document, id, parentId))) {
    return document;
  }

  let byId = { ...document.byId };
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

  /** @param {string[]} ids @returns {string[]} */
  const insertAt = (ids) => {
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

/**
 * @param {ChapterDocument} document
 * @param {string} chapterId
 * @param {string} criterionId
 * @param {number} toIndex
 * @returns {ChapterDocument}
 */
export function moveCriterion(document, chapterId, criterionId, toIndex) {
  const chapter = document.byId[chapterId];
  if (!chapter) return document;
  const fromIndex = chapter.criteria.findIndex(
    (criterion) => criterion.id === criterionId,
  );
  if (fromIndex < 0) return document;
  return reorderCriteria(document, chapterId, fromIndex, toIndex);
}

/**
 * @param {ChapterDocument} document
 * @param {string} chapterId
 * @param {number} fromIndex
 * @param {number} toIndex
 * @returns {ChapterDocument}
 */
export function reorderCriteria(document, chapterId, fromIndex, toIndex) {
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
 *
 * @param {ChapterDocument} document
 * @param {string} id
 * @param {() => string} newId
 * @returns {{ document: ChapterDocument, chapterId: string|null }}
 */
export function duplicateSubtree(document, id, newId) {
  const original = document.byId[id];
  if (!original) return { document, chapterId: null };

  const idMap = new Map();
  const cloneIds = collectSubtreeIds(document, id);
  for (const originalId of cloneIds) idMap.set(originalId, newId());

  /** @type {Record<string, Chapter>} */
  const clones = {};
  for (const originalId of cloneIds) {
    const source = document.byId[originalId];
    clones[idMap.get(originalId)] = {
      ...source,
      id: idMap.get(originalId),
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
      childIds: source.childIds.map((childId) => idMap.get(childId)),
    };
  }

  const duplicateId = idMap.get(id);
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

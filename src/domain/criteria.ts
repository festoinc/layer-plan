import {
  Chapter,
  ChapterDocument,
  createChapter,
  Criterion,
  getChapter,
  insertChapter,
  patchChapter,
  setCriteria,
} from "./chapters";

export type { Criterion, Chapter, ChapterDocument };

/**
 * Derive a chapter title from a Markdown criterion. The first line is used;
 * leading block markers, link targets and inline formatting are removed.
 */
export function deriveCriterionTitle(markdown: string): string {
  return (
    String(markdown)
      .split(/\r?\n/)[0]
      .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/, "")
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\*\*|__|~~|`|\*/g, "")
      .trim() || "Untitled chapter"
  );
}

export interface CreateCriterionInput {
  id: string;
  text: string;
  checked?: boolean;
  chapterId?: string;
}

export function createCriterion(input: CreateCriterionInput): Criterion {
  const criterion: Criterion = {
    id: input.id,
    text: input.text,
    checked: Boolean(input.checked),
  };
  if (input.chapterId) criterion.chapterId = input.chapterId;
  return criterion;
}

/**
 * Build the chapter that a success criterion creates automatically.
 */
export function createSubchapterFromCriterion({
  id,
  text,
}: {
  id: string;
  text: string;
}): Chapter {
  return createChapter({
    id,
    title: deriveCriterionTitle(text),
    description: text,
  });
}

/**
 * Append a criterion to a chapter and, when provided, its linked subchapter.
 */
export function addCriterion(
  document: ChapterDocument,
  chapterId: string,
  criterion: Criterion,
  subchapter: Chapter | null = null,
): ChapterDocument {
  const chapter = getChapter(document, chapterId);
  if (!chapter) return document;

  let next = setCriteria(document, chapterId, [
    ...chapter.criteria,
    subchapter ? { ...criterion, chapterId: subchapter.id } : criterion,
  ]);

  if (subchapter) {
    next = insertChapter(next, { ...subchapter, parentId: chapterId });
  }

  return next;
}

export function patchCriterion(
  document: ChapterDocument,
  chapterId: string,
  criterionId: string,
  patch: Partial<Criterion>,
): ChapterDocument {
  const chapter = getChapter(document, chapterId);
  if (!chapter) return document;
  let changed = false;
  const criteria = chapter.criteria.map((criterion) => {
    if (criterion.id !== criterionId) return criterion;
    changed = true;
    return { ...criterion, ...patch, id: criterion.id };
  });
  return changed ? setCriteria(document, chapterId, criteria) : document;
}

export function removeCriterion(
  document: ChapterDocument,
  chapterId: string,
  criterionId: string,
): ChapterDocument {
  const chapter = getChapter(document, chapterId);
  if (!chapter) return document;
  const criteria = chapter.criteria.filter(
    (criterion) => criterion.id !== criterionId,
  );
  if (criteria.length === chapter.criteria.length) return document;
  return setCriteria(document, chapterId, criteria);
}

export function toggleCriterion(
  document: ChapterDocument,
  chapterId: string,
  criterionId: string,
): ChapterDocument {
  const chapter = getChapter(document, chapterId);
  const criterion = chapter?.criteria.find((item) => item.id === criterionId);
  if (!chapter || !criterion) return document;
  return patchCriterion(document, chapterId, criterionId, {
    checked: !criterion.checked,
  });
}

/**
 * Progress for one chapter's checklist.
 */
export function criterionProgress(chapter: Chapter | undefined | null): {
  done: number;
  total: number;
} {
  const criteria = chapter?.criteria ?? [];
  return {
    done: criteria.filter((criterion) => criterion.checked).length,
    total: criteria.length,
  };
}

/**
 * Keep the criterion list of a chapter in sync with a new set of criteria.
 */
/**
 * Apply server-created criterion subchapters to a local document. Used after a
 * save response so a clean workspace adopts the server document and a dirty
 * workspace receives only the generated chapters and links.
 */
export function applyCreatedSubchapters(
  document: ChapterDocument,
  created: Array<{
    id: string;
    parentId: string;
    criterionId: string;
  }>,
  source: ChapterDocument,
): ChapterDocument {
  let next = document;
  for (const item of created) {
    let parent = next.byId[item.parentId];
    if (!parent) continue;
    const currentCriterion = parent.criteria.find(
      (criterion) => criterion.id === item.criterionId,
    );
    if (
      !currentCriterion ||
      (currentCriterion.chapterId && currentCriterion.chapterId !== item.id)
    ) {
      continue;
    }
    if (!next.byId[item.id]) {
      const subchapter = source.byId[item.id];
      if (!subchapter) continue;
      next = insertChapter(next, subchapter);
      parent = next.byId[item.parentId];
    }
    if (!parent) continue;
    if (!parent.childIds.includes(item.id)) {
      next = patchChapter(next, parent.id, {
        childIds: [...parent.childIds, item.id],
      });
      parent = next.byId[parent.id];
    }
    if (!parent) continue;
    const criteria = parent.criteria.map((criterion) =>
      criterion.id === item.criterionId && !criterion.chapterId
        ? { ...criterion, chapterId: item.id }
        : criterion,
    );
    if (
      criteria.some((criterion, index) => criterion !== parent.criteria[index])
    ) {
      next = patchChapter(next, parent.id, { criteria });
    }
  }
  return next;
}

export function replaceCriteria(
  document: ChapterDocument,
  chapterId: string,
  criteria: Criterion[],
): ChapterDocument {
  return patchChapter(document, chapterId, { criteria });
}

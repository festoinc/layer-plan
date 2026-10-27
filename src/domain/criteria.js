import {
  createChapter,
  getChapter,
  insertChapter,
  patchChapter,
  setCriteria,
} from "./chapters.js";

/**
 * @typedef {import("./chapters.js").Criterion} Criterion
 * @typedef {import("./chapters.js").Chapter} Chapter
 * @typedef {import("./chapters.js").ChapterDocument} ChapterDocument
 */

/**
 * Derive a chapter title from a Markdown criterion. The first line is used;
 * leading block markers, link targets and inline formatting are removed.
 *
 * @param {string} markdown
 * @returns {string}
 */
export function deriveCriterionTitle(markdown) {
  return (
    String(markdown)
      .split(/\r?\n/)[0]
      .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/, "")
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\*\*|__|~~|`|\*/g, "")
      .trim() || "Untitled chapter"
  );
}

/**
 * @param {{ id: string, text: string, checked?: boolean, chapterId?: string }} input
 * @returns {Criterion}
 */
export function createCriterion(input) {
  /** @type {Criterion} */
  const criterion = {
    id: input.id,
    text: input.text,
    checked: Boolean(input.checked),
  };
  if (input.chapterId) criterion.chapterId = input.chapterId;
  return criterion;
}

/**
 * Build the chapter that a success criterion creates automatically.
 *
 * @param {{ id: string, text: string }} input
 * @returns {Chapter}
 */
export function createSubchapterFromCriterion({ id, text }) {
  return createChapter({
    id,
    title: deriveCriterionTitle(text),
    description: text,
  });
}

/**
 * Append a criterion to a chapter and, when provided, its linked subchapter.
 *
 * @param {ChapterDocument} document
 * @param {string} chapterId
 * @param {Criterion} criterion
 * @param {Chapter|null} [subchapter]
 * @returns {ChapterDocument}
 */
export function addCriterion(
  document,
  chapterId,
  criterion,
  subchapter = null,
) {
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

/**
 * @param {ChapterDocument} document
 * @param {string} chapterId
 * @param {string} criterionId
 * @param {Partial<Criterion>} patch
 * @returns {ChapterDocument}
 */
export function patchCriterion(document, chapterId, criterionId, patch) {
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

/**
 * @param {ChapterDocument} document
 * @param {string} chapterId
 * @param {string} criterionId
 * @returns {ChapterDocument}
 */
export function removeCriterion(document, chapterId, criterionId) {
  const chapter = getChapter(document, chapterId);
  if (!chapter) return document;
  const criteria = chapter.criteria.filter(
    (criterion) => criterion.id !== criterionId,
  );
  if (criteria.length === chapter.criteria.length) return document;
  return setCriteria(document, chapterId, criteria);
}

/**
 * @param {ChapterDocument} document
 * @param {string} chapterId
 * @param {string} criterionId
 * @returns {ChapterDocument}
 */
export function toggleCriterion(document, chapterId, criterionId) {
  const chapter = getChapter(document, chapterId);
  const criterion = chapter?.criteria.find((item) => item.id === criterionId);
  if (!chapter || !criterion) return document;
  return patchCriterion(document, chapterId, criterionId, {
    checked: !criterion.checked,
  });
}

/**
 * Progress for one chapter's checklist.
 *
 * @param {Chapter|undefined|null} chapter
 * @returns {{ done: number, total: number }}
 */
export function criterionProgress(chapter) {
  const criteria = chapter?.criteria ?? [];
  return {
    done: criteria.filter((criterion) => criterion.checked).length,
    total: criteria.length,
  };
}

/**
 * Keep the criterion list of a chapter in sync with a new set of criteria.
 *
 * @param {ChapterDocument} document
 * @param {string} chapterId
 * @param {Criterion[]} criteria
 * @returns {ChapterDocument}
 */
export function replaceCriteria(document, chapterId, criteria) {
  return patchChapter(document, chapterId, { criteria });
}

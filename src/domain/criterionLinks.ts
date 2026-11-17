import {
  Chapter,
  ChapterDocument,
  deleteSubtree,
  getChapter,
  patchChapter,
  setCriteria,
  walkChapters,
} from "./chapters";
import { Criterion, deriveCriterionTitle, patchCriterion } from "./criteria";

/**
 * A success criterion and the subchapter it created form one pair.
 *
 * The criterion text is the canonical Markdown. The subchapter mirrors it:
 * `description` is the same string and `title` is derived from the first line.
 * The rules in this module keep every pair in that state for the browser, the
 * REST API and MCP.
 */

export interface UpdatedCriterionSubchapter {
  id: string;
  parentId: string;
  criterionId: string;
  title: string;
  description: string;
}

export interface RemovedCriterionSubchapter {
  id: string;
  parentId: string;
  criterionId: string;
  title: string;
}

export interface RemovedCriterion {
  chapterId: string;
  criterionId: string;
  text: string;
}

export interface CriterionSync {
  updatedSubchapters: UpdatedCriterionSubchapter[];
  removedSubchapters: RemovedCriterionSubchapter[];
  removedCriteria: RemovedCriterion[];
}

export interface CriterionSyncActivity {
  message: string;
  chapterId: string | null;
  chapterName: string;
}

export interface CriterionReconciliation {
  document: ChapterDocument;
  sync: CriterionSync;
  activity: CriterionSyncActivity[];
  /** Chapters removed by the reconciliation, including cascaded subtrees. */
  removedChapterIds: string[];
}

export function emptyCriterionSync(): CriterionSync {
  return {
    updatedSubchapters: [],
    removedSubchapters: [],
    removedCriteria: [],
  };
}

export function hasCriterionSync(
  sync: CriterionSync | null | undefined,
): boolean {
  if (!sync) return false;
  return Boolean(
    sync.updatedSubchapters.length ||
    sync.removedSubchapters.length ||
    sync.removedCriteria.length,
  );
}

/**
 * Replace only the first line of a Markdown block, keeping the remaining lines.
 */
export function replaceFirstLine(text: string, title: string): string {
  const newline = text.indexOf("\n");
  return newline < 0 ? title : `${title}${text.slice(newline)}`;
}

interface PairRecord {
  parentId: string;
  criterionId: string;
  chapterId: string;
  text: string;
  title: string;
  description: string;
}

const pairKey = (parentId: string, criterionId: string) =>
  `${parentId}:${criterionId}`;

/**
 * Valid pairs in a document. Invalid or duplicate links are ignored; link
 * repair handles them separately.
 */
function collectPairs(document: ChapterDocument): Map<string, PairRecord> {
  const pairs = new Map<string, PairRecord>();
  const claimed = new Set<string>();
  for (const parent of walkChapters(document)) {
    for (const criterion of parent.criteria) {
      const chapterId = criterion.chapterId;
      if (!chapterId || claimed.has(chapterId)) continue;
      const chapter = getChapter(document, chapterId);
      if (!chapter || chapter.parentId !== parent.id) continue;
      claimed.add(chapter.id);
      pairs.set(pairKey(parent.id, criterion.id), {
        parentId: parent.id,
        criterionId: criterion.id,
        chapterId: chapter.id,
        text: criterion.text,
        title: chapter.title,
        description: chapter.description,
      });
    }
  }
  return pairs;
}

function withoutLink(criterion: Criterion): Criterion {
  const { chapterId: _chapterId, ...rest } = criterion;
  return rest;
}

/**
 * Drop links that point at a missing chapter, at the criterion's own chapter,
 * at a chapter that is not a direct child, or at a chapter another criterion
 * already claims. Repair only removes links; it never deletes content.
 */
function repairLinks(document: ChapterDocument): ChapterDocument {
  const claimed = new Set<string>();
  let next = document;

  for (const parent of walkChapters(document)) {
    let changed = false;
    const criteria = parent.criteria.map((criterion) => {
      const chapterId = criterion.chapterId;
      if (!chapterId) return criterion;
      const chapter = document.byId[chapterId];
      const valid =
        Boolean(chapter) &&
        chapterId !== parent.id &&
        chapter?.parentId === parent.id &&
        !claimed.has(chapterId);
      if (!valid) {
        changed = true;
        return withoutLink(criterion);
      }
      claimed.add(chapterId);
      return criterion;
    });
    if (changed) next = setCriteria(next, parent.id, criteria);
  }

  return next;
}

interface RemovalResult {
  document: ChapterDocument;
  removedSubchapters: RemovedCriterionSubchapter[];
  removedCriteria: RemovedCriterion[];
  removedChapterIds: string[];
  activity: CriterionSyncActivity[];
}

function collectClaimedChapters(document: ChapterDocument): Set<string> {
  const claimed = new Set<string>();
  for (const chapter of Object.values(document.byId)) {
    for (const criterion of chapter.criteria) {
      if (criterion.chapterId) claimed.add(criterion.chapterId);
    }
  }
  return claimed;
}

/**
 * Deleting either side of a pair removes the other. A criterion removed from
 * the parent deletes the subchapter subtree; a removed chapter removes the
 * criterion that claimed it. Detaching (removing only `chapterId`) is not a
 * removal.
 */
function applyRemovals(
  previous: ChapterDocument,
  next: ChapterDocument,
): RemovalResult {
  const previousPairs = collectPairs(previous);
  let document = next;
  const removedSubchapters: RemovedCriterionSubchapter[] = [];
  const removedCriteria: RemovedCriterion[] = [];
  const removedChapterIds: string[] = [];
  const activity: CriterionSyncActivity[] = [];

  const missingChapters = new Set<string>();
  for (const id of Object.keys(previous.byId)) {
    if (!next.byId[id]) missingChapters.add(id);
  }

  if (missingChapters.size) {
    for (const record of previousPairs.values()) {
      if (!missingChapters.has(record.chapterId)) continue;
      const parent = document.byId[record.parentId];
      if (!parent) continue;
      const criterion = parent.criteria.find(
        (item) => item.id === record.criterionId,
      );
      if (!criterion) continue;
      // A criterion relinked to a surviving chapter in the same write is kept.
      if (criterion.chapterId && !missingChapters.has(criterion.chapterId)) {
        continue;
      }
      removedCriteria.push({
        chapterId: parent.id,
        criterionId: criterion.id,
        text: criterion.text,
      });
      document = setCriteria(
        document,
        parent.id,
        parent.criteria.filter((item) => item.id !== criterion.id),
      );
    }
  }

  // A criterion removed by the client (or by the rule above) deletes its
  // subchapter. Run until stable so a cascaded chapter cannot leave a link.
  const claimedChapters = collectClaimedChapters(document);
  let changed = true;
  while (changed) {
    changed = false;
    for (const record of previousPairs.values()) {
      const parent = document.byId[record.parentId];
      if (!parent) continue;
      if (parent.criteria.some((item) => item.id === record.criterionId)) {
        continue;
      }
      const chapter = document.byId[record.chapterId];
      if (!chapter || chapter.parentId !== record.parentId) continue;
      if (claimedChapters.has(chapter.id)) continue;
      const removed = deleteSubtree(document, chapter.id);
      if (!removed.removedIds.length) continue;
      document = removed.document;
      removedChapterIds.push(...removed.removedIds);
      removedSubchapters.push({
        id: chapter.id,
        parentId: record.parentId,
        criterionId: record.criterionId,
        title: chapter.title,
      });
      activity.push({
        message: "Deleted subchapter from success criterion",
        chapterId: null,
        chapterName: chapter.title,
      });
      changed = true;
    }
  }

  return {
    document,
    removedSubchapters,
    removedCriteria,
    removedChapterIds,
    activity,
  };
}

interface SyncResult {
  document: ChapterDocument;
  updated: UpdatedCriterionSubchapter[];
}

/**
 * Keep every surviving pair mirrored. The previous document decides which side
 * changed; the criterion text wins when both sides changed.
 */
function syncPairs(
  previous: ChapterDocument,
  next: ChapterDocument,
): SyncResult {
  const previousPairs = collectPairs(previous);
  let document = next;
  const updated: UpdatedCriterionSubchapter[] = [];

  for (const parent of walkChapters(next)) {
    for (const criterion of parent.criteria) {
      const chapterId = criterion.chapterId;
      if (!chapterId) continue;
      const currentParent = document.byId[parent.id];
      const currentCriterion = currentParent?.criteria.find(
        (item) => item.id === criterion.id,
      );
      const currentChapter = document.byId[chapterId];
      if (!currentParent || !currentCriterion || !currentChapter) continue;
      if (currentChapter.parentId !== currentParent.id) continue;

      const record = previousPairs.get(pairKey(parent.id, criterion.id));
      const isNew = !record || record.chapterId !== currentChapter.id;
      const text = currentCriterion.text;
      const description = currentChapter.description;
      const title = currentChapter.title;

      let targetText = text;
      let targetDescription = description;
      let targetTitle = title;

      if (isNew || text !== record?.text) {
        targetDescription = text;
        targetTitle = deriveCriterionTitle(text);
      } else if (description !== record.description && title === record.title) {
        targetText = description;
        targetTitle = deriveCriterionTitle(description);
      } else if (title !== record.title && description === record.description) {
        targetText = replaceFirstLine(
          text,
          title.trim() ? title : "Untitled chapter",
        );
        targetDescription = targetText;
        targetTitle = deriveCriterionTitle(targetText);
      } else if (title !== record.title && description !== record.description) {
        targetText = description;
        targetTitle = deriveCriterionTitle(description);
      } else {
        // Neither side changed. Repair any stored drift from the criterion,
        // which is the canonical source.
        targetDescription = text;
        targetTitle = deriveCriterionTitle(text);
      }

      if (targetTitle !== title || targetDescription !== description) {
        document = patchChapter(document, currentChapter.id, {
          title: targetTitle,
          description: targetDescription,
        });
      }
      if (targetText !== text) {
        document = patchCriterion(
          document,
          currentParent.id,
          currentCriterion.id,
          { text: targetText },
        );
      }
      if (
        targetTitle !== title ||
        targetDescription !== description ||
        targetText !== text
      ) {
        updated.push({
          id: currentChapter.id,
          parentId: currentParent.id,
          criterionId: currentCriterion.id,
          title: targetTitle,
          description: targetDescription,
        });
      }
    }
  }

  return { document, updated };
}

export function reconcileCriterionLinks(
  previous: ChapterDocument,
  next: ChapterDocument,
): CriterionReconciliation {
  const repaired = repairLinks(next);
  const removals = applyRemovals(previous, repaired);
  const synced = syncPairs(previous, removals.document);

  return {
    document: synced.document,
    sync: {
      updatedSubchapters: synced.updated,
      removedSubchapters: removals.removedSubchapters,
      removedCriteria: removals.removedCriteria,
    },
    activity: removals.activity,
    removedChapterIds: removals.removedChapterIds,
  };
}

/**
 * Apply a save response to a document that changed while the request was in
 * flight. Fields the user has edited since the snapshot are preserved.
 */
export function applyCriterionSync(
  document: ChapterDocument,
  snapshot: ChapterDocument,
  source: ChapterDocument,
  sync: CriterionSync,
): ChapterDocument {
  let next = document;

  for (const item of sync.removedSubchapters) {
    if (!next.byId[item.id]) continue;
    next = deleteSubtree(next, item.id).document;
  }

  for (const item of sync.removedCriteria) {
    const chapter = next.byId[item.chapterId];
    if (!chapter) continue;
    if (!chapter.criteria.some((entry) => entry.id === item.criterionId)) {
      continue;
    }
    next = setCriteria(
      next,
      chapter.id,
      chapter.criteria.filter((entry) => entry.id !== item.criterionId),
    );
  }

  for (const item of sync.updatedSubchapters) {
    const currentChapter = next.byId[item.id];
    const snapshotChapter = snapshot.byId[item.id];
    const sourceChapter = source.byId[item.id];
    if (!currentChapter || !snapshotChapter || !sourceChapter) continue;

    const patch: Partial<Chapter> = {};
    if (
      currentChapter.title === snapshotChapter.title &&
      sourceChapter.title !== currentChapter.title
    ) {
      patch.title = sourceChapter.title;
    }
    if (
      currentChapter.description === snapshotChapter.description &&
      sourceChapter.description !== currentChapter.description
    ) {
      patch.description = sourceChapter.description;
    }
    if (Object.keys(patch).length) {
      next = patchChapter(next, item.id, patch);
    }

    const currentParent = next.byId[item.parentId];
    const snapshotParent = snapshot.byId[item.parentId];
    const sourceParent = source.byId[item.parentId];
    if (!currentParent || !snapshotParent || !sourceParent) continue;
    const currentCriterion = currentParent.criteria.find(
      (criterion) => criterion.id === item.criterionId,
    );
    const snapshotCriterion = snapshotParent.criteria.find(
      (criterion) => criterion.id === item.criterionId,
    );
    const sourceCriterion = sourceParent.criteria.find(
      (criterion) => criterion.id === item.criterionId,
    );
    if (!currentCriterion || !snapshotCriterion || !sourceCriterion) continue;
    if (
      currentCriterion.text === snapshotCriterion.text &&
      sourceCriterion.text !== currentCriterion.text
    ) {
      next = patchCriterion(next, item.parentId, item.criterionId, {
        text: sourceCriterion.text,
      });
    }
  }

  return next;
}

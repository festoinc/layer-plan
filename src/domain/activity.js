/**
 * @typedef {Object} ActivityEntry
 * @property {string} id
 * @property {string} message
 * @property {string|null} chapterId
 * @property {string} chapterName
 * @property {string} time ISO timestamp
 */

export const MAX_ACTIVITY_ENTRIES = 100;

/**
 * @param {{ id: string, message: string, chapterId?: string|null, chapterName?: string, time?: string }} input
 * @returns {ActivityEntry}
 */
export function createActivityEntry(input) {
  return {
    id: input.id,
    message: input.message,
    chapterId: input.chapterId ?? null,
    chapterName: input.chapterName ?? "Untitled chapter",
    time: input.time ?? new Date().toISOString(),
  };
}

/**
 * Newest first, capped at `limit` entries.
 *
 * @param {ActivityEntry[]} entries
 * @param {ActivityEntry} entry
 * @param {number} [limit]
 * @returns {ActivityEntry[]}
 */
export function appendActivity(entries, entry, limit = MAX_ACTIVITY_ENTRIES) {
  return [entry, ...entries].slice(0, limit);
}

/**
 * @param {ActivityEntry[]} entries
 * @returns {ActivityEntry[]}
 */
export function sortActivity(entries) {
  return [...entries].sort(
    (first, second) =>
      new Date(second.time).getTime() - new Date(first.time).getTime(),
  );
}

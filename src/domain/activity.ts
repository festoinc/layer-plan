export interface ActivityEntry {
  id: string;
  message: string;
  chapterId: string | null;
  chapterName: string;
  time: string; // ISO timestamp
  actorUserId?: string | null;
  actorName?: string | null;
}

export const MAX_ACTIVITY_ENTRIES = 100;

export interface CreateActivityInput {
  id: string;
  message: string;
  chapterId?: string | null;
  chapterName?: string;
  time?: string;
  actorUserId?: string | null;
  actorName?: string | null;
}

export function createActivityEntry(input: CreateActivityInput): ActivityEntry {
  return {
    id: input.id,
    message: input.message,
    chapterId: input.chapterId ?? null,
    chapterName: input.chapterName ?? "Untitled chapter",
    time: input.time ?? new Date().toISOString(),
    ...(input.actorUserId === undefined
      ? {}
      : { actorUserId: input.actorUserId }),
    ...(input.actorName === undefined ? {} : { actorName: input.actorName }),
  };
}

/**
 * Newest first, capped at `limit` entries.
 */
export function appendActivity(
  entries: ActivityEntry[],
  entry: ActivityEntry,
  limit: number = MAX_ACTIVITY_ENTRIES,
): ActivityEntry[] {
  return [entry, ...entries].slice(0, limit);
}

export function sortActivity(entries: ActivityEntry[]): ActivityEntry[] {
  return [...entries].sort(
    (first, second) =>
      new Date(second.time).getTime() - new Date(first.time).getTime(),
  );
}

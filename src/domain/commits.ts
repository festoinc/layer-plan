/**
 * Document commit references.
 *
 * A document stores the git commits that implemented it. Hashes are kept as
 * lowercase hexadecimal strings and are references only: they never change
 * criterion or verification state.
 */

export const COMMIT_HASH_PATTERN = /^[0-9a-f]{7,40}$/;
export const MAX_COMMITS_PER_CHAPTER = 50;

export function normalizeCommitHash(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const hash = value.trim().toLowerCase();
  return COMMIT_HASH_PATTERN.test(hash) ? hash : null;
}

export function normalizeCommits(
  value: unknown,
  { issues }: { issues?: string[] } = {},
): string[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    issues?.push("Replaced a commit list that was not an array.");
    return [];
  }

  const commits: string[] = [];
  const used = new Set<string>();

  for (const item of value) {
    const hash = normalizeCommitHash(item);
    if (!hash) {
      issues?.push("Dropped an invalid commit hash.");
      continue;
    }
    if (used.has(hash)) {
      issues?.push(`Removed a duplicate commit hash (${hash}).`);
      continue;
    }
    if (commits.length >= MAX_COMMITS_PER_CHAPTER) {
      issues?.push(
        `Kept the first ${MAX_COMMITS_PER_CHAPTER} commit hashes on a chapter.`,
      );
      break;
    }
    used.add(hash);
    commits.push(hash);
  }

  return commits;
}

export function hasCommit(commits: string[], hash: string): boolean {
  const normalized = normalizeCommitHash(hash);
  return normalized ? commits.includes(normalized) : false;
}

export function addCommit(commits: string[], hash: string): string[] {
  const normalized = normalizeCommitHash(hash);
  if (!normalized || commits.includes(normalized)) return commits;
  if (commits.length >= MAX_COMMITS_PER_CHAPTER) return commits;
  return [normalized, ...commits];
}

export function removeCommit(commits: string[], hash: string): string[] {
  const normalized = normalizeCommitHash(hash);
  if (!normalized || !commits.includes(normalized)) return commits;
  return commits.filter((commit) => commit !== normalized);
}

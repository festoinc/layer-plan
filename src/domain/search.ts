import { getPath, walkChapters, type ChapterDocument } from "./chapters";

/**
 * Project-scoped document search.
 *
 * The search is intentionally simple and deterministic: case-insensitive
 * substring matching over a single project document, with commit hashes
 * matching by prefix. There is no index, query language or fuzzy matching.
 */

export const SEARCH_MIN_QUERY_LENGTH = 2;
export const SEARCH_MAX_QUERY_LENGTH = 200;
export const SEARCH_DEFAULT_LIMIT = 20;
export const SEARCH_MAX_LIMIT = 100;
export const SEARCH_MAX_MATCHES_PER_RESULT = 5;
export const SEARCH_SNIPPET_LENGTH = 160;
export const SEARCH_MAX_MATCHED_CHAPTERS = 2000;
export const SEARCH_MAX_SCANNED_CHAPTERS = 5000;
export const SEARCH_COMMIT_MIN_PREFIX = 4;
export const SEARCH_COMMIT_MAX_LENGTH = 40;

export type SearchField =
  | "title"
  | "description"
  | "criterion"
  | "commit"
  | "verification.auto"
  | "verification.human"
  | "verification.ai";

export interface SearchMatch {
  field: SearchField;
  criterionId?: string;
  commit?: string;
  snippet: string;
  ranges: [number, number][];
}

export interface SearchPathItem {
  id: string;
  title: string;
}

export interface SearchResult {
  chapterId: string;
  title: string;
  path: SearchPathItem[];
  matchCount: number;
  matches: SearchMatch[];
}

export interface SearchResponse {
  projectId: string;
  query: string;
  documentRevision: number;
  total: number;
  offset: number;
  limit: number;
  truncated: boolean;
  results: SearchResult[];
}

export interface SearchResultSet {
  query: string;
  total: number;
  truncated: boolean;
  results: SearchResult[];
}

export interface SearchOptions {
  limit?: number;
  offset?: number;
}

interface MatchTarget {
  field: SearchField;
  rank: number;
  text: string;
  searchText: string;
  order: number;
  criterionId?: string;
  commit?: string;
  termMatches: Map<string, number[]>;
}

interface RankedResult extends SearchResult {
  bestRank: number;
  order: number;
}

const FIELD_RANK: Record<SearchField, number> = {
  commit: 5,
  title: 4,
  criterion: 3,
  description: 2,
  "verification.auto": 1,
  "verification.human": 1,
  "verification.ai": 1,
};

const COMMIT_TERM = new RegExp(
  `^[0-9a-f]{${SEARCH_COMMIT_MIN_PREFIX},${SEARCH_COMMIT_MAX_LENGTH}}$`,
);

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? collapseWhitespace(value) : "";
}

/**
 * Return the normalized query, or null when the query is outside the contract.
 */
export function normalizeSearchQuery(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = collapseWhitespace(value);
  if (
    normalized.length < SEARCH_MIN_QUERY_LENGTH ||
    normalized.length > SEARCH_MAX_QUERY_LENGTH
  ) {
    return null;
  }
  return normalized;
}

function queryTerms(query: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const term of query.toLowerCase().split(" ")) {
    if (!term || seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
  }
  return terms;
}

function isCommitTerm(term: string): boolean {
  return COMMIT_TERM.test(term);
}

function isCommitExact(term: string, commit: string): boolean {
  return isCommitTerm(term) && term === commit;
}

function findAllOccurrences(text: string, term: string): number[] {
  const starts: number[] = [];
  let index = text.indexOf(term);
  while (index !== -1) {
    starts.push(index);
    index = text.indexOf(term, index + term.length);
  }
  return starts;
}

function mergeRanges(ranges: [number, number][]): [number, number][] {
  const sorted = ranges
    .filter(([start, end]) => end > start)
    .sort((first, second) => first[0] - second[0] || first[1] - second[1]);
  const merged: [number, number][] = [];
  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && range[0] <= previous[1]) {
      previous[1] = Math.max(previous[1], range[1]);
    } else {
      merged.push([...range]);
    }
  }
  return merged;
}

function snippetFor(
  text: string,
  matches: [number, number][],
): { snippet: string; ranges: [number, number][] } {
  const sorted = mergeRanges(matches);
  const first = sorted[0]?.[0] ?? 0;
  let start = Math.max(0, first - 50);
  const end = Math.min(text.length, start + SEARCH_SNIPPET_LENGTH);
  if (end === text.length) start = Math.max(0, end - SEARCH_SNIPPET_LENGTH);

  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  const body = text.slice(start, end);
  const offset = prefix.length;
  const ranges = mergeRanges(
    sorted
      .filter(([matchStart]) => matchStart >= start && matchStart < end)
      .map(([matchStart, matchEnd]) => [
        matchStart - start + offset,
        Math.min(matchEnd, end) - start + offset,
      ]),
  );
  return { snippet: `${prefix}${body}${suffix}`, ranges };
}

function addTextTarget(
  targets: MatchTarget[],
  field: SearchField,
  text: unknown,
  extra: { criterionId?: string } = {},
): void {
  const normalized = normalizeText(text);
  if (!normalized) return;
  targets.push({
    field,
    rank: FIELD_RANK[field],
    text: normalized,
    searchText: normalized.toLowerCase(),
    order: targets.length,
    ...extra,
    termMatches: new Map(),
  });
}

function targetMatches(
  target: MatchTarget,
  terms: readonly string[],
  matchedTerms: Set<string>,
): boolean {
  let matched = false;
  for (const term of terms) {
    if (target.field === "commit") {
      if (!isCommitTerm(term) || !target.searchText.startsWith(term)) {
        continue;
      }
      const starts = [0];
      target.termMatches.set(term, starts);
      matchedTerms.add(term);
      matched = true;
      if (isCommitExact(term, target.searchText)) {
        target.rank = Math.max(target.rank, 6);
      }
      continue;
    }

    const starts = findAllOccurrences(target.searchText, term);
    if (!starts.length) continue;
    target.termMatches.set(term, starts);
    matchedTerms.add(term);
    matched = true;
  }
  return matched;
}

function matchToEntry(target: MatchTarget): SearchMatch {
  const matches: [number, number][] = [];
  for (const [term, starts] of target.termMatches) {
    for (const start of starts) {
      matches.push([start, start + term.length]);
    }
  }
  const source =
    target.searchText.length === target.text.length
      ? target.text
      : target.searchText;
  const { snippet, ranges } = snippetFor(source, matches);
  return {
    field: target.field,
    ...(target.criterionId ? { criterionId: target.criterionId } : {}),
    ...(target.commit ? { commit: target.commit } : {}),
    snippet,
    ranges,
  };
}

/**
 * Search one normalized project document.
 *
 * Invalid queries return an empty result set. The HTTP layer validates the
 * query first so callers normally see a validation error instead.
 */
export function searchChapters(
  document: ChapterDocument,
  query: string,
  options: SearchOptions = {},
): SearchResultSet {
  const normalizedQuery = normalizeSearchQuery(query);
  if (!normalizedQuery) {
    return { query: "", total: 0, truncated: false, results: [] };
  }

  const terms = queryTerms(normalizedQuery);
  const limit = Math.min(
    Math.max(options.limit ?? SEARCH_DEFAULT_LIMIT, 1),
    SEARCH_MAX_LIMIT,
  );
  const offset = Math.max(options.offset ?? 0, 0);
  const chapters = walkChapters(document);
  const scanLimit = Math.min(chapters.length, SEARCH_MAX_SCANNED_CHAPTERS);
  const matched: RankedResult[] = [];
  let truncated = chapters.length > scanLimit;

  for (let index = 0; index < scanLimit; index += 1) {
    if (matched.length >= SEARCH_MAX_MATCHED_CHAPTERS) {
      truncated = true;
      break;
    }

    const chapter = chapters[index];
    const targets: MatchTarget[] = [];
    addTextTarget(targets, "title", chapter.title);
    addTextTarget(targets, "description", chapter.description);
    for (const criterion of chapter.criteria) {
      addTextTarget(targets, "criterion", criterion.text, {
        criterionId: criterion.id,
      });
    }
    for (const commit of chapter.commits) {
      const value = normalizeText(commit).toLowerCase();
      if (!value) continue;
      targets.push({
        field: "commit",
        rank: FIELD_RANK.commit,
        text: value,
        searchText: value,
        order: targets.length,
        commit: value,
        termMatches: new Map(),
      });
    }
    addTextTarget(
      targets,
      "verification.auto",
      chapter.verification.auto.command,
    );
    addTextTarget(
      targets,
      "verification.human",
      chapter.verification.human.instructions,
    );
    addTextTarget(
      targets,
      "verification.ai",
      chapter.verification.ai.instructions,
    );

    const matchedTerms = new Set<string>();
    const matchedTargets: MatchTarget[] = [];
    for (const target of targets) {
      if (targetMatches(target, terms, matchedTerms)) {
        matchedTargets.push(target);
      }
    }
    if (matchedTerms.size !== terms.length) continue;

    matchedTargets.sort(
      (first, second) => second.rank - first.rank || first.order - second.order,
    );
    const bestRank = matchedTargets[0]?.rank ?? 0;

    matched.push({
      chapterId: chapter.id,
      title: chapter.title || "Untitled chapter",
      path: getPath(document, chapter.id).map((item) => ({
        id: item.id,
        title: item.title || "Untitled chapter",
      })),
      matchCount: matchedTargets.length,
      matches: matchedTargets
        .slice(0, SEARCH_MAX_MATCHES_PER_RESULT)
        .map(matchToEntry),
      bestRank,
      order: index,
    });
  }

  matched.sort(
    (first, second) =>
      second.bestRank - first.bestRank ||
      second.matchCount - first.matchCount ||
      first.order - second.order,
  );

  return {
    query: normalizedQuery,
    total: matched.length,
    truncated,
    results: matched.slice(offset, offset + limit).map((result) => {
      const { bestRank: _bestRank, order: _order, ...entry } = result;
      return entry;
    }),
  };
}

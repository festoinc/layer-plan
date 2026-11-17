import { FormEvent, ReactNode, useEffect, useRef, useState } from "react";
import { LoaderCircle, Search as SearchIcon, SearchX } from "lucide-react";
import { errorMessage } from "../api/client";
import { searchProject } from "../api/search";
import {
  normalizeSearchQuery,
  SEARCH_MIN_QUERY_LENGTH,
  type SearchMatch,
  type SearchResponse,
  type SearchResult,
} from "../domain/search";

const PAGE_SIZE = 20;
const DEBOUNCE_MS = 250;

export interface SearchViewProps {
  projectId: string;
  query: string;
  onQueryChange: (value: string) => void;
  onSelectChapter: (id: string) => void;
}

const FIELD_LABELS: Record<SearchMatch["field"], string> = {
  title: "Title",
  description: "Description",
  criterion: "Criterion",
  commit: "Commit",
  "verification.auto": "Auto-test command",
  "verification.human": "Human instructions",
  "verification.ai": "AI instructions",
};

function plural(count: number, singular: string, pluralForm: string) {
  return count === 1 ? singular : pluralForm;
}

function pathLabel(result: SearchResult): string {
  const ancestors = result.path
    .slice(0, -1)
    .map((item) => item.title)
    .filter(Boolean);
  return ancestors.length ? ancestors.join(" / ") : "Top level";
}

function HighlightedText({
  text,
  ranges,
}: {
  text: string;
  ranges: [number, number][];
}) {
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start < cursor || start >= text.length) continue;
    if (start > cursor) parts.push(text.slice(cursor, start));
    const safeEnd = Math.min(end, text.length);
    parts.push(
      <mark key={`${start}-${safeEnd}`}>{text.slice(start, safeEnd)}</mark>,
    );
    cursor = safeEnd;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

export function SearchView({
  projectId,
  query,
  onQueryChange,
  onSelectChapter,
}: SearchViewProps) {
  const normalizedQuery = normalizeSearchQuery(query);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [items, setItems] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef(0);

  useEffect(() => {
    const activeQuery = normalizedQuery;
    requestId.current += 1;
    const current = requestId.current;

    if (!activeQuery) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResponse(null);
      setItems([]);
      setError("");
      setLoading(false);
      setLoadingMore(false);
      return;
    }

    const controller = new AbortController();
    setResponse(null);
    setItems([]);
    setError("");
    setLoading(true);
    setLoadingMore(false);

    const timer = setTimeout(() => {
      void searchProject(projectId, activeQuery, {
        limit: PAGE_SIZE,
        offset: 0,
        signal: controller.signal,
      })
        .then((result) => {
          if (current !== requestId.current) return;
          setResponse(result);
          setItems(result.results);
        })
        .catch((caught) => {
          if (current !== requestId.current) return;
          setError(errorMessage(caught));
        })
        .finally(() => {
          if (current !== requestId.current) return;
          setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      requestId.current += 1;
      clearTimeout(timer);
      controller.abort();
    };
  }, [projectId, normalizedQuery]);

  async function loadMore() {
    if (!response || loadingMore) return;
    const activeQuery = normalizeSearchQuery(query);
    if (!activeQuery) return;
    const current = requestId.current;
    setLoadingMore(true);
    setError("");
    try {
      const next = await searchProject(projectId, activeQuery, {
        limit: PAGE_SIZE,
        offset: items.length,
      });
      if (current !== requestId.current) return;
      setResponse(next);
      setItems((previous) => {
        const seen = new Set(previous.map((item) => item.chapterId));
        return [
          ...previous,
          ...next.results.filter((item) => !seen.has(item.chapterId)),
        ];
      });
    } catch (caught) {
      if (current === requestId.current) setError(errorMessage(caught));
    } finally {
      if (current === requestId.current) setLoadingMore(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const activeQuery = normalizeSearchQuery(query);
    if (activeQuery && activeQuery !== query) onQueryChange(activeQuery);
  }

  const canLoadMore = Boolean(response && items.length < response.total);
  const hasResults = items.length > 0;

  return (
    <section
      className="chapter-editor overview-page search-page"
      aria-labelledby="search-heading"
    >
      <h1 id="search-heading">Search</h1>
      <p className="overview-description">
        Find chapters, criteria, commits and verification text in this project.
      </p>

      <form className="search-form" role="search" onSubmit={submit}>
        <label className="visually-hidden" htmlFor="project-search">
          Search this project
        </label>
        <div className="search-input-row">
          <SearchIcon size={18} aria-hidden="true" />
          <input
            id="project-search"
            type="search"
            autoComplete="off"
            spellCheck={false}
            placeholder="Search this project"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            autoFocus={!query}
          />
          {loading && (
            <LoaderCircle
              className="search-spinner"
              size={17}
              aria-hidden="true"
            />
          )}
        </div>
        <p className="field-hint">
          At least {SEARCH_MIN_QUERY_LENGTH} characters. Search is limited to
          this project.
        </p>
      </form>

      <div className="search-status" role="status" aria-live="polite">
        {loading
          ? "Searching…"
          : response
            ? `${response.total} ${plural(response.total, "chapter", "chapters")} found`
            : ""}
      </div>

      {error && (
        <p className="form-error search-error" role="alert">
          {error}
        </p>
      )}

      {!normalizedQuery && (
        <div className="search-empty">
          <SearchIcon size={25} />
          <h2>Search this project</h2>
          <p>
            Type a keyword, phrase or commit prefix. Search covers chapter
            titles, descriptions, criteria, commits and verification text.
          </p>
        </div>
      )}

      {normalizedQuery && !loading && response && !hasResults && (
        <div className="search-empty">
          <SearchX size={25} />
          <h2>No matches</h2>
          <p>
            No chapter in this project contains all of the search terms. Try
            fewer words or a different commit prefix.
          </p>
        </div>
      )}

      {hasResults && (
        <div className="search-results" aria-busy={loading}>
          {response && (
            <p className="search-meta">
              Saved document revision {response.documentRevision}
            </p>
          )}
          {response?.truncated && (
            <p className="search-note">
              Search stopped after 2,000 matching chapters. Narrow the query to
              see more specific results.
            </p>
          )}
          <ul className="search-result-list">
            {items.map((result) => (
              <li className="search-result" key={result.chapterId}>
                <button
                  type="button"
                  className="search-result-button"
                  onClick={() => onSelectChapter(result.chapterId)}
                >
                  <span className="search-result-path">
                    {pathLabel(result)}
                  </span>
                  <span className="search-result-title">{result.title}</span>
                  <span className="search-result-count">
                    {result.matchCount}{" "}
                    {plural(result.matchCount, "match", "matches")}
                  </span>
                </button>
                <ul className="search-match-list">
                  {result.matches.map((match, index) => (
                    <li
                      className="search-match"
                      key={`${match.field}-${match.criterionId ?? match.commit ?? index}`}
                    >
                      <span className="search-match-label">
                        {FIELD_LABELS[match.field]}
                      </span>
                      <span className="search-match-snippet">
                        <HighlightedText
                          text={match.snippet}
                          ranges={match.ranges}
                        />
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          {canLoadMore && (
            <button
              type="button"
              className="secondary-button search-more"
              onClick={() => void loadMore()}
              disabled={loadingMore}
            >
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

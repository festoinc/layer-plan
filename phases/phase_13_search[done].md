# Phase 13 — Project search

Status: delivered  
Updated: 2026-11-17

## Why this phase

Chapter documents contain titles, descriptions, criteria, verification text and
commit references. Phase 7 added commit hashes, but there is still no way to
find a chapter by a keyword or a commit prefix again. The only way to locate a
hash is to read every chapter or search an export.

This phase adds search to the API, the UI and MCP. Every search is scoped to one
project. There is no global search and no cross-project result set. The same
matcher and response contract drive all three surfaces, so the browser and an
agent see identical results.

This consumes backlog item **P-16 Search**. P-08 project-list search and
filtering remain out of scope.

## Goal

A person or an agent can search one project by free text or a commit prefix and
receive ranked chapter results with short match snippets. A result can be opened
in the existing chapter editor. The search reflects the latest saved document,
never unsaved browser edits, and never changes the document, activity or
revision.

## Locked decisions

| # | Decision | Choice |
| --- | --- | --- |
| 1 | Search scope | One project only. `projectId` is required on every surface. No global endpoint. |
| 2 | Searchable content | Chapter title, description, criterion text, commit hashes and the three verification texts. Activity, project metadata, test guidelines and ids are not searched. |
| 3 | Matching | Case-insensitive substring matching. Whitespace-separated terms are ANDed within one chapter. No fuzzy matching, stemming, regex, wildcards, boolean operators or quoted phrases. |
| 4 | Commit matching | A term of 4–40 hexadecimal characters matches commit hashes case-insensitively by prefix. An exact hash ranks above a prefix. Hex-looking terms still search text fields. |
| 5 | Query length | Trimmed query must be 2–200 characters. |
| 6 | Backend | Linear scan of the stored document through a pure domain matcher. No SQLite FTS table, no migration and no index maintenance. |
| 7 | API | `GET /api/v1/projects/{projectId}/search?q=&limit=&offset=`. `limit` defaults to 20 and is capped at 100. |
| 8 | Result shape | Chapter-level results, root-to-chapter path, short snippets with highlight ranges, `total`, `truncated` and `documentRevision`. |
| 9 | UI | A dedicated Search view at `#/projects/{projectId}/search?q=...`. No command palette and no topbar search field. |
| 10 | Result navigation | Open the chapter in the existing editor. No criterion-level deep links or editor scroll/highlight in this phase. |
| 11 | MCP | One new read-only tool, `search_project`, with required `projectId` and `q`. |
| 12 | Authorization | Exactly the same rule as reading a document: an owner session, or an MCP credential bound to the same project and allowed to read. |
| 13 | Limits | Up to 5 match snippets per result, a 2,000 matched-chapter scan cap and a route-level rate limit. |
| 14 | Backlog | Remove P-16 when delivered. Do not change P-08. |

## 1. Search model

### 1.1 Fields

Search the following chapter content:

- `title`;
- `description`;
- every `criteria[].text`;
- every hash in `commits`;
- `verification.auto.command`;
- `verification.human.instructions`;
- `verification.ai.instructions`.

All three verification texts are searched, including modes that are not active,
because the inactive text is still stored content that a person may need to
find.

Do not search:

- `activity_entries` messages or actor names;
- project name, description or test guidelines;
- chapter and criterion ids, `parentId`, `childIds`, `selectedId`;
- `checked`, `finalLevel`, verification mode or other flags;
- raw serialized JSON.

Activity keeps its own view. Project metadata and guidelines are single
project-level values, not chapter results.

### 1.2 Query normalization

- Trim leading and trailing whitespace.
- Collapse internal whitespace runs to one space for the normalized response
  query.
- Reject queries shorter than 2 characters or longer than 200 characters.
- Split the normalized query on spaces into terms.
- Lowercase terms for matching. Remove duplicate terms for ranking.
- Treat every term literally. A quotation mark, `*`, `|`, `-` or other
  punctuation is ordinary text. There is no query language.

The API returns the normalized query, not the raw query string.

### 1.3 Matching

A chapter matches when **every** query term matches at least one searchable
field somewhere in that chapter. Different terms may match different fields,
criteria or commits. A term matches a field when its lowercase form is a
substring of the field's lowercase text.

Commit matching is the only prefix rule:

- a term of 4–40 hexadecimal characters matches a commit when the commit starts
  with the term;
- a term equal to the full commit is an exact commit match;
- a term shorter than 4 characters, longer than 40 characters, or containing a
  non-hex character does not match commits;
- commit matching is case-insensitive, while stored hashes remain lowercase.

A hex-looking term is not restricted to commits. For example, `e15d` matches a
commit starting with `e15d` and also matches text containing `e15d`.

### 1.4 Ranking

Each matched field target receives one rank:

| Rank | Match |
| --- | --- |
| 6 | Exact commit hash |
| 5 | Commit-hash prefix |
| 4 | Chapter title |
| 3 | Criterion text |
| 2 | Chapter description |
| 1 | Verification text (`auto`, `human` or `ai`) |

A chapter's result rank is the highest rank among its matches. Sort results by:

1. result rank descending;
2. number of matched field targets descending;
3. document order ascending.

Document order is the pre-order traversal returned by `walkChapters`, followed
by criterion and commit order inside a chapter. The ordering is deterministic
and does not depend on object key order in `chapters.byId`.

Within one result, order match entries by rank descending, then by document
order.

### 1.5 Snippets and result caps

- A **field target** is one matched title, description, criterion, commit or
  verification text. Multiple query terms inside the same target merge into one
  match entry with multiple ranges.
- `matchCount` counts all matched targets in the chapter before the per-result
  cap.
- Return at most 5 match entries per chapter.
- Each snippet is plain text, whitespace-normalized, at most 160 characters and
  includes an ellipsis when content was cut from either side.
- `ranges` are `[start, end)` offsets into the snippet string, using JavaScript
  string indices.
- For a commit, the snippet is the full hash and the range covers the matched
  exact hash or prefix.
- Markdown is not rendered in snippets. Markup is returned as ordinary text.

The response shape is intentionally bounded. The largest possible response is
100 results × 5 snippets × 160 characters, well below the existing 2 MiB MCP
response limit.

## 2. API contract

### 2.1 Endpoint

```http
GET /api/v1/projects/{projectId}/search?q=<query>&limit=20&offset=0
```

| Parameter | Required | Rules |
| --- | --- | --- |
| `projectId` | yes | Path parameter. Must belong to the authenticated user, or match the bound MCP project. |
| `q` | yes | Trimmed string, 2–200 characters. |
| `limit` | no | Integer 1–100. Default 20. |
| `offset` | no | Integer 0 or greater. Default 0. |

Unknown query parameters return `422 validation_failed`. There is no `scope`,
`field`, `checked`, `verification` or other filter in this phase.

### 2.2 Response

```json
{
  "projectId": "website",
  "query": "reset e15d",
  "documentRevision": 12,
  "total": 1,
  "offset": 0,
  "limit": 20,
  "truncated": false,
  "results": [
    {
      "chapterId": "password-reset",
      "title": "Password reset",
      "path": [
        { "id": "account", "title": "Account" },
        { "id": "password-reset", "title": "Password reset" }
      ],
      "matchCount": 3,
      "matches": [
        {
          "field": "title",
          "snippet": "Password reset",
          "ranges": [[9, 14]]
        },
        {
          "field": "criterion",
          "criterionId": "crit-reset-email",
          "snippet": "The reset email is sent within one minute.",
          "ranges": [[4, 9], [10, 15]]
        },
        {
          "field": "commit",
          "commit": "e15d2c7",
          "snippet": "e15d2c7",
          "ranges": [[0, 4]]
        }
      ]
    }
  ]
}
```

`field` is one of `title`, `description`, `criterion`, `commit`,
`verification.auto`, `verification.human` or `verification.ai`.

`path` is the root-to-chapter path returned by the existing `getPath` helper and
includes the matched chapter as its last item.

`total` is the number of matched chapters found before the scan cap. When the
scan stops at the cap, `truncated` is `true` and `total` may be lower than the
true number of matches.

`documentRevision` identifies the saved snapshot that was searched. It is
informational only; search does not return or require an ETag.

### 2.3 Status codes and errors

| Status | Error code | Condition |
| --- | --- | --- |
| `200` | — | Search completed. Results may be empty. |
| `401` | `unauthenticated` | No valid session or MCP credential. |
| `403` | `forbidden` | Credential lacks the `read` scope. |
| `404` | `not_found` | Project missing or owned by another user. |
| `422` | `validation_failed` | Invalid `q`, `limit`, `offset` or unknown query parameter. |
| `429` | `rate_limited` | Search rate limit exceeded. |
| `500` | `stored_data_invalid` | The stored document cannot be read, using the existing error path. |

Search responses use `Cache-Control: no-store`. The response contains project
content, so it must not be cached by a browser or intermediary.

### 2.4 OpenAPI

Add the path and schemas to `server/api/openapi.yaml`:

- `GET /projects/{projectId}/search`, operation id `searchProject`, tag
  `search`;
- parameters `ProjectId`, `SearchQuery`, `SearchLimit`, `SearchOffset`;
- schemas `SearchResponse`, `SearchResult`, `SearchMatch`, `SearchPathItem` and
  `SearchField`;
- `200`, `401`, `403`, `404`, `422` and `429` responses using the existing
  error components.

Regenerate `server/api/generated.d.ts` with `npm run api:types` and run
`npm run api:lint`.

## 3. Server implementation

### 3.1 Pure search module

Add `src/domain/search.ts` with shared constants, types and a pure
`searchChapters` function. It imports `ChapterDocument`, `walkChapters`,
`getPath` and the verification types from the existing domain modules. It must
not import the database, Fastify or React.

Suggested exports:

```ts
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

export interface SearchResultSet {
  query: string;
  total: number;
  truncated: boolean;
  results: SearchResult[];
}

export function normalizeSearchQuery(value: unknown): string | null;
export function searchChapters(
  document: ChapterDocument,
  query: string,
  options?: { limit?: number; offset?: number },
): SearchResultSet;
```

`searchChapters` returns the result set before the API adds `projectId`,
`documentRevision`, `offset` and `limit`. Use the same constants in the UI for
input validation.

### 3.2 Route

Add `server/api/routes/search.ts`:

1. `hooks.requireAuth` authenticates a browser session or the signed internal
   MCP context.
2. Parse `projectId` from the path and query parameters with a strict Zod schema
   in `server/api/schemas.ts`.
3. Call `store.getDocument(auth.user.id, projectId)`. This existing call
   already enforces ownership and throws `404 not_found` for another user's
   project.
4. Call `searchChapters(document.chapters, input.q, { limit, offset })`.
5. Return `SearchResponse` with `projectId`, normalized `query`,
   `documentRevision`, `total`, `offset`, `limit`, `truncated` and `results`.
6. Set `Cache-Control: no-store`.

Register the route in `server/app.ts` next to the coverage route:

```ts
registerSearchRoutes(app, store, hooks);
```

No `ProjectStore` method and no database migration are needed. The route uses
the existing normalized document snapshot.

### 3.3 Rate limit and scan caps

Apply a route-level rate limit with the existing `@fastify/rate-limit` plugin:

- 120 requests per minute;
- keyed by the authenticated user id when available, otherwise the client IP;
- `hook: "preHandler"` so the authenticated context can be used.

The matcher stops after 2,000 matched chapters or 5,000 scanned chapters.
`walkChapters` already guards against cycles and duplicate ids. If the scan stops
early, set `truncated: true`.

### 3.4 Logging

Search terms can contain sensitive document content. Do not write `q` to the
application log. Add a Fastify request serializer that logs the path without the
query string, or strip the query from logged URLs for the search route. The
query is not stored in SQLite, activity, exports or MCP results.

## 4. UI

### 4.1 Routing

Extend `src/hooks/useRoute.ts`:

- add `search` to `ROUTE_VIEWS`;
- split the hash into a path and a query string before parsing segments;
- parse `q` with `URLSearchParams`;
- add `searchQuery: string` to `ParsedRoute` (`""` for every non-search view);
- add `searchQuery?: string | null` to `RouteTarget`;
- parse `#/projects/{projectId}/search?q=...`;
- build the hash for the search view with `?q=` when `searchQuery` is non-empty.

`route.replace` must preserve the current search query when canonicalizing the
search route. In `WorkspaceShell`, when the view is search, include
`searchQuery: route.searchQuery` in the canonical replacement. When navigating
to Search from the sidebar, start with an empty query. When switching projects,
keep the Search view but clear the query.

### 4.2 Search view

Add a lazy `SearchView` and export it from `src/app/lazyViews.ts`. Add a
**Search** item to `Sidebar` using the lucide `Search` icon, and render
`SearchView` from `WorkspaceShell`.

The view receives the project id, the current `searchQuery`, a query-change
callback and the existing `onSelectChapter` callback. It renders:

- a labelled search form with a text input and a submit button;
- an idle state before 2 characters, explaining that search needs at least 2
  characters;
- loading, empty, error and result states;
- a result count and a short note that results reflect the saved document
  revision;
- result cards with the chapter title, a path breadcrumb, the match count and
  up to 5 snippets;
- `<mark>` highlighting using the returned `ranges`;
- a **Load more** button that appends the next page while
  `offset + results.length < total`;
- a note when `truncated` is true, explaining that the search stopped after
  2,000 matched chapters.

Entering the empty Search view focuses the input. Navigation and result clicks
follow the existing focus and chapter-selection patterns. For the search view,
the topbar root title should be "All chapters", not the currently selected
chapter.

### 4.3 Data fetching

Add `src/api/search.ts` with `searchProject(projectId, query, options)` using the
existing `apiRequest` helper. Pass an `AbortController` signal and debounce
input changes by 250 ms. Cancel the previous request when the query changes.
When the normalized query is shorter than 2 characters, clear results and do not
call the API.

Types can live in `src/domain/search.ts` and be re-exported from
`src/api/types.ts` where the rest of the client types live. Keep the server
response types identical to the UI types.

### 4.4 Styling and accessibility

- Add search page, form, result, breadcrumb and highlight styles to
  `src/styles.css` using the existing tokens.
- Use a visible label or visually hidden label and a clear placeholder.
- Use `aria-live="polite"` for the result count and errors.
- Set `aria-busy` while a request is in flight.
- Keep `<mark>` readable without relying on colour alone.
- Ensure the form, result buttons and **Load more** work with the keyboard.
- Add the Search route to the existing accessibility and routing tests.

## 5. MCP

Add one operation to `server/mcp/routes.ts`:

```ts
{
  name: "search_project",
  description:
    "Search the bound project's chapter titles, descriptions, criteria, commit hashes and verification text. Searches one project only; activity and project metadata are not searched.",
  method: "GET",
  path: (args) => {
    const query = new URLSearchParams({ q: String(args.q) });
    if (args.limit !== undefined) query.set("limit", String(args.limit));
    if (args.offset !== undefined) query.set("offset", String(args.offset));
    return `${projectPath(args)}/search?${query.toString()}`;
  },
  schema: {
    projectId: z.string().min(1).max(128),
    q: z.string().trim().min(2).max(200),
    limit: z.number().int().min(1).max(100).optional(),
    offset: z.number().int().min(0).optional(),
  },
  projectScoped: true,
  readOnly: true,
}
```

- `projectId` and `q` are required. There is no way to omit the project and
  search globally.
- A different `projectId` returns the existing `404 not_found` envelope before
  dispatch.
- The tool uses the same REST route through in-process dispatch and returns the
  existing `{ status, body, etag }` envelope with `etag: null`.
- The tool is annotated `readOnlyHint: true` and `destructiveHint: false`.
- It requires the `read` scope. A write grant already includes read under the
  current scope normalization.
- The tool list becomes eleven tools:
  `list_projects`, `get_project`, `update_project`, `delete_project`,
  `get_document`, `replace_document`, `list_activity`, `append_activity`,
  `get_coverage`, `export_project`, `search_project`.
- Search does not change the document, ETag, revision or activity feed.
- If the MCP OAuth phase is delivered, a project-bound OAuth connection gets the
  same tool and the same project isolation. No credential-specific branch is
  added for search.

Update `server/mcp/instructions.md`:

- add `search_project` to the tool guidance;
- state that it searches one project only;
- list the searchable fields;
- explain that commit terms of 4–40 hex characters match by prefix;
- tell the agent to read the document before editing a matched chapter;
- state that search results are chapter-level and reflect the saved document.

## 6. Authorization, limits and security

- Search is a read operation. It uses the same `requireAuth` hook and the same
  project ownership check as `GET /document`.
- A browser session can search only projects it owns. Another user's project
  returns `404 not_found`.
- An MCP credential can search only its bound project. The existing internal
  project-scope guard applies before the route runs.
- There is no `/search` endpoint without a project id, no account-wide search
  and no cross-project aggregation.
- `q` is not persisted in SQLite, activity, exports or MCP results, and is not
  written to logs.
- Search responses use `Cache-Control: no-store`.
- Search does not accept filters, sorting parameters or result fields from the
  caller.
- The scan cap and per-result snippet cap bound CPU and response size.
- The route does not call any test runner, shell command or external service.

## 7. Documentation changes

- `README.md`: mention project search in the UI and MCP feature summary.
- `docs/api.md`: add a **Search a project** section with a curl example, the
  field list, commit-prefix rule, ranking, pagination and error behavior.
- `LAYERS_AGENT_GUIDE.md`: document `search_project`, the required project id,
  searchable fields and the chapter-level result model.
- `server/mcp/instructions.md`: the tool guidance described above.
- `server/api/openapi.yaml`: the search path and schemas.
- `server/api/generated.d.ts`: regenerated from OpenAPI.
- `phases/phase-ideas.md`: remove **P-16 Search** when the phase is delivered.
  Leave P-08 project-list search and filtering in the backlog.
- No `.env.example`, `server/config.ts`, Docker or deployment change is needed.
- Update `AGENTS.md` only if delivery changes repository guidance.

## 8. Tests and acceptance criteria

Local verification is limited to static and build checks:

```sh
npm run lint
npm run format:check
npm run typecheck
npm run api:lint
npm run build
```

CI is the only test gate. The following tests and acceptance checks run in CI or
on the remote test host.

### 8.1 Unit tests

- Case-insensitive substring matching in every searchable field.
- AND behavior across terms and chapters.
- Title, criterion, description and verification ranking.
- Exact commit and commit-prefix matching, including uppercase input.
- A hex term still matching text, and invalid/short/long terms not matching
  commits.
- Duplicate terms, repeated occurrences, overlapping ranges and snippet
  ellipses.
- Query normalization, 1-character rejection and 200/201-character boundaries.
- Document-order tie-breaking, including nested chapters and criteria order.
- Result caps: 5 match entries per chapter and 2,000 matched chapters.
- Path breadcrumbs include the matched chapter.
- No mutation of the input document.
- Route parsing for `#/projects/x/search?q=...`, encoded characters, empty
  queries and canonical replacements.

### 8.2 API tests

- Session-authenticated search succeeds for an owned project.
- Another user's project and a missing project return `404 not_found`.
- Missing, empty, 1-character, 201-character and unknown query parameters return
  `422 validation_failed`.
- `limit` defaults to 20, accepts 1 and 100, and rejects 0 and 101.
- `offset` paginates and returns an empty `results` array beyond the end.
- Empty results return `total: 0`, `truncated: false` and `results: []`.
- `documentRevision` matches the saved document revision.
- Search does not change the document revision, document ETag or activity feed.
- A response includes `Cache-Control: no-store`.
- A search query does not appear in captured application logs.
- The rate limit returns `429 rate_limited` after the configured burst.

### 8.3 Contract tests

- The OpenAPI document validates and the new path and schemas are present.
- Search responses validate against the declared schema.
- Generated types compile after `npm run api:types`.

### 8.4 MCP tests

- Tool discovery includes `search_project` and the existing ten tools.
- Search succeeds with a project API key and the `read` scope.
- Search returns the same body as the REST route through the MCP envelope.
- A different `projectId` returns the `404 not_found` envelope.
- Missing `q` and a query outside 2–200 characters fail validation.
- `limit` and `offset` are passed through.
- Search does not require a write scope and does not change the ETag.
- Activity and project metadata are absent from search results.
- An OAuth-bound credential, if that phase is delivered, gets the same behavior.

### 8.5 UI and accessibility tests

- The sidebar exposes **Search** and navigates to the search route.
- A deep link with `?q=` restores the query and results.
- Typing below 2 characters shows the idle hint and makes no request.
- Debouncing cancels stale requests and only the latest query renders.
- Results show path, title, snippets and highlights.
- Clicking a result opens the chapter in the existing editor.
- **Load more** appends results and respects `total`.
- Empty, loading, error, `truncated` and no-results states render.
- Switching projects clears the query and searches the new project only.
- Keyboard-only navigation and the existing axe checks pass.

### 8.6 Remote acceptance

Publish the image and deploy the exact digest on the shared test host using the
existing loopback-only pattern. Then:

1. Sign in and create a disposable project.
2. Write a document with two chapters, a criterion containing a distinct phrase
   and a commit hash such as `e15d2c7`.
3. Search by the phrase and confirm the expected chapter, snippet and revision.
4. Search by `e15d` and confirm the commit-prefix result.
5. Search for two terms that live in different fields and confirm AND behavior.
6. Confirm another project id returns `404` and no global endpoint exists.
7. Call `search_project` through MCP and confirm the same result.
8. Confirm the document revision and activity feed are unchanged.
9. Clean up the container, volume, test directory and temporary credentials.
10. Record the tested image tags/digest and cleanup result in the handoff.

## 9. Delivery sequence

1. Add `src/domain/search.ts`, constants, types, matcher and unit tests.
2. Add the search query schema, REST route, rate limit and app registration.
3. Add the OpenAPI path and schemas; regenerate types and run `api:lint`.
4. Add the MCP tool and update the MCP instructions.
5. Extend the hash router and add the Search view, API client, styles and
   accessibility coverage.
6. Update `README.md`, `docs/api.md`, `LAYERS_AGENT_GUIDE.md` and remove P-16
   from `phases/phase-ideas.md`.
7. Run the static/build gate, push a branch/PR and wait for CI `verify`.
8. Publish, run the remote acceptance scenarios on the exact digest, clean up,
   mark this phase `delivered`, rename it with `[done]` and update the handoff.

## 10. Boundaries

- No global, account-wide or cross-project search.
- No search over activity, project metadata or test guidelines.
- No fuzzy, semantic, vector, regex, wildcard, boolean or quoted-phrase search.
- No stemming, synonyms, typo correction or diacritic folding.
- No filters, facets, saved searches, search history or recent queries.
- No SQLite FTS table, migration, background index or reindex command.
- No criterion-level deep links or editor scroll/highlight.
- No search over unsaved browser edits.
- No command palette or topbar search field.
- No project-list filtering (P-08).
- No export format change and no new environment variable.
- No change to MCP tool annotations, response envelope or credential model
  beyond adding the read-only search tool.

# Phase 7 — Commit references on documents

Status: delivered  
Date: 2026-11-16

## Goal

Let every document (chapter) record the git commits that implemented it, so a
reader can see what was delivered and where. A document may reference several
commits over time as it is improved.

Phase 7 delivers:

- an ordered `commits` list on every chapter, stored with the document;
- a compact commit editor in the document view, with add and remove;
- manual entry through the UI or the API — no git binary, no repository
  configuration and no provider integration;
- activity entries when a commit is linked or removed;
- commit references on the test-coverage page;
- commits included in `layers-project` exports and accepted on import;
- OpenAPI, Zod, generated types, contract tests and browser coverage for the new
  field.

Phase 7 stays reference-only. It does not check out, validate or inspect a git
repository, and it does not change success-criteria or verification state.

## Locked decisions

| Topic | Decision |
| --- | --- |
| Attach point | Chapters (documents) only; success criteria never carry a commit |
| Cardinality | Multiple commits per document, ordered newest first |
| Maximum | 50 commits per document |
| Semantics | Reference only; no effect on `checked`, coverage counts or verification |
| Stored data | The hash only; no message, author, date, branch or remote URL |
| Source | Manual entry through the UI or the API; never read from a git repository |
| Format | 7–40 hexadecimal characters, case-insensitive input, stored lowercase |
| Validation | Hard reject in the API; imports drop invalid hashes with an issue |
| UI | One compact commit row in the document view, with chips and an add form |
| Bulk operations | None; every document is edited on its own |
| Activity | Linking and removing a commit writes an activity entry |
| Coverage | Commit references on each eligible-chapter row |
| Export/import | Included in `layers-project` v4; v3 and older imports still work |
| Search | Out of scope; P-16 remains separate and builds on this field |
| Authorization | Phase 6 rules unchanged: owner-only access, session or bearer token |
| Repository integration | Out of scope; no GitHub/GitLab calls, no `git` invocation |
| Quality gate | Existing gate plus unit, API, contract and Playwright coverage |

### Derived choices to review

These follow from the answers above but were not stated explicitly. Change them
before implementation if they are wrong.

- **Field name is `commits`.** One document has an array of hashes. There is no
  per-criterion `commitId` and no nested commit objects.
- **`commits` is always present in the normalized domain model.** It is an
  empty array when nothing is linked. The field is optional in API writes and
  imports so older clients and phase 6 exports keep working, and the server
  normalizes missing values to `[]`.
- **Newest first.** Adding a commit prepends it. The list is not sorted
  lexicographically, because the delivery order is the useful order.
- **Duplicates are ignored.** Adding an existing hash is a no-op; the UI shows
  an "already linked" message instead of creating a second chip.
- **Uppercase input is accepted and lowercased.** `ABC1234` is stored as
  `abc1234`. Only hexadecimal characters are accepted at all.
- **Short hashes are allowed as typed.** A 7-character hash stays 7 characters;
  the app does not try to expand it to 40. Two different repositories could
  theoretically produce the same prefix, which is acceptable for a local
  single-project reference.
- **The phase bumps `SCHEMA_VERSION` from 6 to 7 and
  `PROJECT_EXPORT_VERSION` from 3 to 4.** SQLite needs no migration because
  chapters are stored as JSON in `project_documents.chapters_json`; the
  normalization layer adds the missing field on read.
- **Final-level chapters use the same field.** When `finalLevel` is checked,
  new criteria stay in the document instead of creating subdocuments. Those
  criteria are still covered by the document's `commits` list.
- **Commit editing is immediate, not debounced.** A commit change is a small
  structural change, like checking a box.
- **Existing data is never rewritten just to add an empty array.** Reads
  normalize `commits` to `[]`; the row is rewritten on the next document save.

## 1. Domain model

### Chapter record

`src/domain/chapters.ts`:

```ts
export interface Chapter {
  id: string;
  parentId: string | null;
  title: string;
  description: string;
  finalLevel: boolean;
  verification: VerificationRule;
  criteria: Criterion[];
  commits: string[]; // Lowercase hex hashes, newest first.
  childIds: string[];
}
```

- `createChapter` defaults `commits` to `[]` and copies a provided array.
- `patchChapter` continues to accept `Partial<Chapter>`; commit helpers go
  through it so chapters stay immutable.
- `Criterion` is unchanged. The `chapterId` link still points at the
  subchapter created from a criterion; commits live on that subchapter.

### Commit helpers

New `src/domain/commits.ts`:

```ts
export const COMMIT_HASH_PATTERN = /^[0-9a-f]{7,40}$/;
export const MAX_COMMITS_PER_CHAPTER = 50;

export function normalizeCommitHash(value: string): string | null;
export function normalizeCommits(
  value: unknown,
  options?: { issues?: string[] },
): string[];
export function addCommit(commits: string[], hash: string): string[];
export function removeCommit(commits: string[], hash: string): string[];
export function hasCommit(commits: string[], hash: string): boolean;
```

Rules:

- `normalizeCommitHash` trims whitespace, lowercases, and returns the value only
  when it matches `^[0-9a-f]{7,40}$`; otherwise `null`.
- `normalizeCommits` returns `[]` for `null`/`undefined`; records an issue and
  returns `[]` for a non-array; drops non-string values, invalid hashes and
  duplicates with one issue per dropped value; stops at 50 with a "kept the
  first 50 commits" issue.
- `addCommit` normalizes, ignores invalid or duplicate values, prepends the hash
  and caps the list at 50.
- `removeCommit` normalizes and filters; removing an absent hash is a no-op.
- These helpers never mutate their input array.

### Store and stats

- Chapter counts in `ProjectStats` do not change; commits are not criteria.
- `summarizeDocument` continues to count chapters, criteria and checked
  criteria only.

## 2. Normalization, storage and versions

### Chapter normalization

`coerceChapter` in `src/domain/schema.ts` gains:

```ts
commits: normalizeCommits(raw.commits, { issues }),
```

- Phase 6 and older documents load with `commits: []`.
- Invalid or duplicate values in an import are dropped and reported in the
  import `issues` list. The import still succeeds, matching the existing repair
  behaviour for malformed chapters.
- `cleanupDocument` keeps commit arrays as normalized; no link checks apply
  because hashes are not foreign keys.
- `SCHEMA_VERSION` becomes `7`. This is a payload version, not a SQLite
  migration.

### SQLite

No migration is added.

- `project_documents.chapters_json` stores the document as JSON.
- `store.getDocument` already runs `normalizeDocument`; it now fills `commits`.
- `store.saveDocument` normalizes before writing, so persisted rows always have
  explicit commit arrays after the first save.
- `revision` continues to increment on any document change, including a commit
  add or remove.
- ETag and `If-Match` conflict handling are unchanged.

### Export format version 4

`PROJECT_EXPORT_VERSION` becomes `4`.

- `serializeProjectExport` writes `chapters` with `commits` on every chapter.
- `PROJECT_EXPORT_INSTRUCTIONS` gains:
  - a chapter-field line mentioning `commits`;
  - an explanation that commit hashes are lowercase 7–40 hex strings, newest
    first, and are references only.
- `normalizeProjectExport` accepts:
  - v4 exports with `commits`;
  - v3 exports and earlier with no `commits` (normalized to `[]`);
  - array or bare-document imports (unchanged paths).
- Import never validates a hash against a repository and never fails a whole
  import because of one bad hash; it reports it as an issue.

## 3. API contract

### Chapter schema

`server/api/schemas.ts`:

```ts
export const commitHashSchema = z
  .string()
  .trim()
  .transform((value) => value.toLowerCase())
  .pipe(z.string().regex(/^[0-9a-f]{7,40}$/));

export const chapterSchema = z
  .object({
    // existing fields
    commits: z.array(commitHashSchema).max(MAX_COMMITS_PER_CHAPTER).optional(),
    // childIds
  })
  .strict();
```

- `commits` is optional on write for compatibility, but the stored and returned
  value is always an array.
- Invalid values produce the existing `422 validation_failed` response with
  `details[].path` such as `chapters.byId.ch_1.commits.0`.
- Duplicates within one request are not an error at the schema level; the
  domain normalization dedupes them before storage. The UI prevents duplicates
  earlier.
- No new endpoint is added. Commit edits use the existing
  `PUT /api/v1/projects/:id/document` full-document write.
- `GET /api/v1/projects/:id/document` returns `commits` on every chapter.

### Coverage response

`CoverageRow` in `src/domain/verification.ts` gains:

```ts
commits: string[];
```

`getCoverageRows` copies `chapter.commits`. The route serializes it unchanged;
`GET /api/v1/projects/:id/coverage` returns the field for every row.

### OpenAPI

`server/api/openapi.yaml`:

- `Chapter.commits`: array of strings, max 50, each `pattern:
  "^[0-9a-f]{7,40}$"`, described as lowercase, newest-first, reference-only.
  It is not added to `required` so older write clients remain valid; responses
  always include it.
- `CoverageRow.commits`: required array of the same string schema.
- No new paths, security schemes or error codes.
- Regenerate `server/api/generated.d.ts` with `npm run api:types`; CI continues
  to fail on a stale generated file.

### Example write

```json
{
  "chapters": {
    "byId": {
      "ch_1": {
        "id": "ch_1",
        "parentId": null,
        "title": "Sign-in flow",
        "description": "Email and password sign-in.",
        "finalLevel": false,
        "verification": {
          "mode": "human",
          "auto": { "command": "" },
          "human": { "instructions": "Sign in locally." },
          "ai": { "instructions": "" }
        },
        "criteria": [],
        "commits": ["4f2a9c1", "9d0be7a1c2f34d5e6f708192a3b4c5d6e7f80912"],
        "childIds": []
      }
    },
    "rootIds": ["ch_1"]
  },
  "selectedId": "ch_1"
}
```

### Example rejection

```json
{
  "error": {
    "code": "validation_failed",
    "message": "The request did not match the API contract.",
    "details": [
      {
        "path": "chapters.byId.ch_1.commits.0",
        "message": "Invalid"
      }
    ]
  }
}
```

The exact Zod message is not part of the contract; the path and status are.

## 4. React state and UI

### Reducer actions

`src/store/workspaceReducer.ts`:

```ts
| {
    type: "addCommit";
    id: string;
    hash: string;
    activityId?: string;
    time?: string;
  }
| {
    type: "removeCommit";
    id: string;
    hash: string;
    activityId?: string;
    time?: string;
  }
```

- Both actions patch the chapter through the helpers and add an activity entry
  atomically:
  - `Linked commit <hash>` for an add;
  - `Removed commit <hash>` for a remove.
- The activity entry uses the chapter id and title, consistent with criterion
  activity.
- Invalid, duplicate or over-limit adds return the same state and do not log an
  entry.
- Both actions are added to `IMMEDIATE_ACTIONS` so a reload right after the
  click keeps the change.
- `WorkspaceProvider` exposes `addCommit(chapterId, hash)` and
  `removeCommit(chapterId, hash)` next to the existing criterion actions.

### Document view

`src/components/ChapterEditor.tsx` gains a compact commit row, rendered
directly under the title input and above the Description section. It is present
in every document, including root chapters and final-level chapters.

Layout:

```text
Commits  [4f2a9c1 ×] [9d0be7a ×]   [ hash… ] [Add]
```

Behaviour:

- Chips show the hash in a monospace style with a small remove button.
- The remove button has `aria-label={`Remove commit ${hash}`}`.
- The input has an accessible label "Add commit hash" and a placeholder such as
  `e.g. 4f2a9c1`.
- Submitting the small form:
  - trims and lowercases the value;
  - rejects a value that does not match 7–40 hex characters;
  - rejects an already linked hash;
  - rejects an add when 50 commits are already linked;
  - otherwise dispatches `addCommit` and clears the input.
- Validation errors appear in an inline `role="alert"` message next to the row
  and clear on the next edit.
- Enter submits; the add button is reachable by keyboard; chip remove buttons
  are focusable in order.
- Empty state is quiet: just the label, input and a short hint, no placeholder
  card.
- Long hash chips wrap on narrow screens; the description editor keeps its
  current position and styling.

A small presentational component `src/components/ChapterCommits.tsx` owns the
chips and form; `ChapterEditor` passes the chapter and the two actions. This
keeps the editor file from growing further.

### Coverage page

`src/components/TestCoverageView.tsx` adds commit references to each eligible-
chapter row.

- It renders the newest commit as a chip and `+N` when more exist, with a title
  listing all hashes.
- Chapters without commits show nothing extra.
- The references do not affect counts, percentages, eligibility or ordering.
- Long hashes wrap with the rest of the row on narrow screens.

### Activity view

No new activity type is introduced. Commit entries use the existing message,
chapter name, time and actor fields; the activity view renders them unchanged.

## 5. Authorization

Phase 6 rules apply without change:

- every document, coverage, export and import route requires a session cookie or
  bearer token;
- a user can read and write commits only on projects they own;
- another user's project still returns `404`;
- bearer tokens need the `write` scope for document writes, and `read` is enough
  for reads and exports;
- the super admin still cannot open another user's project;
- commit activity is attributed to the acting user, like other activity.

No new role, scope, permission or ownership rule is added.

## 6. Tests and quality gate

### Unit tests (Vitest)

New `tests/unit/commits.test.js`:

- accepts 7, 8 and 40 hex characters; lowercases uppercase input; trims spaces;
- rejects 6 characters, 41 characters, non-hex text, empty strings and `null`;
- `normalizeCommits` handles `undefined`, non-arrays, invalid entries,
  duplicates and the 50-item cap, recording issues;
- `addCommit` prepends, dedupes and caps; `removeCommit` removes and no-ops;
- inputs are not mutated.

Extend `tests/unit/chapters.test.js` and `tests/unit/schema.test.js`:

- `createChapter` defaults to `[]` and copies arrays;
- phase 6 documents without `commits` normalize to `[]` with no issue;
- export v4 round-trips commits; a v3 export imports with empty arrays;
- an import with invalid hashes succeeds and reports issues.

Extend `tests/unit/workspaceReducer.test.js`:

- add and remove patch the chapter and append activity;
- invalid and duplicate adds do not change state or activity;
- both actions are immediate;
- state remains immutable.

Extend verification unit tests:

- coverage rows carry the chapter's commits;
- summaries are unchanged by commits.

### API integration tests (Vitest + Fastify `inject`)

Extend `tests/api/document.test.ts` and add `tests/api/commits.test.ts`:

- a fresh project returns `commits: []` on every chapter;
- PUT accepts short and full hashes, stores lowercase and returns them newest
  first;
- PUT returns `422 validation_failed` for an invalid hash, a too-short hash, a
  non-array value and more than 50 entries;
- duplicates in one request are stored once;
- a commit change increments `revision` and honours `If-Match`;
- the response `activity` contains `Linked commit …` and `Removed commit …`;
- coverage returns `commits` for every row;
- export v4 contains commits; import restores them; a v3 export without
  commits imports cleanly;
- a second user receives `404` for document and coverage reads on a foreign
  project (covered by the existing IDOR suite; add a commit-bearing fixture);
- bearer tokens without `write` cannot modify commits.

### Contract tests

`tests/contract/openapi.test.ts`:

- `Chapter.commits` and `CoverageRow.commits` validate against Zod;
- response examples with commits validate;
- write examples may omit `commits`;
- generated types are current;
- no new security or error-code drift.

### Playwright browser tests (Chromium)

Add scenarios to `tests/verification.spec.js` or a new
`tests/commits.spec.js`:

1. Open a document, add `4f2a9c1`, see the chip and no inline error.
2. Reload and confirm the chip and the activity entry persist.
3. Add a second commit; confirm newest-first order.
4. Remove one commit; reload and confirm it is gone and the activity shows the
   removal.
5. Paste an uppercase hash; confirm it is stored and displayed lowercase.
6. Submit `not-a-hash`; confirm the inline error and that nothing is saved.
7. Submit a duplicate; confirm the "already linked" message.
8. Add and remove a commit using only the keyboard; confirm focus order and
   `aria-label`s.
9. Open the coverage page and confirm the row shows the commit hash.
10. Export the project, inspect the downloaded file for `commits`, import it
    into a fresh project and confirm the values.
11. Repeat add/remove on a final-level chapter whose criteria did not create
    subdocuments.
12. Axe passes on a document with zero, one and several commits.

The two-user isolation suite keeps running: commits must not leak across
projects.

### Quality gate

Unchanged and must stay green:

```sh
npm run lint
npm run format:check
npm run typecheck
npm run test:unit
npm run test:api
npm run test:contract
npm run api:lint
npm run build
npm run test:e2e
npm run test:prod
```

CI needs no new secrets or services.

## 7. Acceptance criteria

- [ ] Every chapter stores `commits` as a normalized array of lowercase
      7–40-character hex hashes, newest first, capped at 50.
- [ ] Phase 6 and older projects load with empty commit lists and no data loss.
- [ ] The document view has one compact commit row with add, remove, duplicate,
      invalid-format, lowercase and limit feedback.
- [ ] Commit add and remove are immediate, survive reload and produce activity
      entries attributed to the acting user.
- [ ] No success criterion, checklist state or verification result changes when
      a commit is linked or removed.
- [ ] The coverage page shows commits without changing counts or eligibility.
- [ ] `layers-project` exports include commits and v4 imports round-trip; v3 and
      older imports still succeed.
- [ ] OpenAPI, Zod and generated types agree; an invalid hash is a `422`.
- [ ] Authorization is unchanged: foreign projects stay `404` and token scopes
      are enforced.
- [ ] Keyboard and axe checks pass for the new row, chips and coverage
      references.
- [ ] README, `docs/api.md` and `AGENTS_template.md` describe the field, format
      and its reference-only meaning.

## 8. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| A hash is ambiguous without a repository name | Document that one project refers to one history; keep repository metadata out of scope and revisit with P-16 or a later integration idea |
| Short hashes collide across repositories | Accept 7–40 characters as typed; users can paste the full hash; no silent expansion |
| Invalid or abbreviated pastes frustrate users | Inline format hint, trim and lowercase input, specific error messages, and import repair with issues instead of failure |
| The commit row adds visual noise to every document | One compact row under the title; chips only when linked, quiet empty state, no new page |
| A commit is linked to the wrong document | Remove is one click, every change is logged, and the activity view shows the chapter |
| Commit references grow unbounded | 50 per document in the contract, with a clear error at the cap |
| Export v4 surprises strict consumers | Explicit version bump, updated export instructions, v3 imports remain supported, README note |
| JSON normalization silently drops bad import data | Every dropped value is reported in the import issues list shown to the user |
| Duplicates from repeated agent writes | Domain-level dedupe makes writes idempotent; UI also warns |
| Commit data is mistaken for verification evidence | UI copy, export instructions and README call it a reference, not a verification result |

## 9. Out of scope

- Search and filtering by commit hash (P-16).
- Git, GitHub, GitLab or other provider integration; no clone, fetch, checkout,
  `git rev-parse` or `git log`.
- Validating that a hash exists in a repository.
- Commit message, author, committer, date, branch, tag, pull request or URL
  metadata.
- Per-criterion commits, per-commit checklists or commit-level verification
  attestation.
- Bulk stamping a commit onto several criteria or documents.
- A commit timeline, diff view or comparison view.
- Automatic checking of criteria when a commit is linked.
- Backfilling commits from git history.
- Changing success-criteria or verification semantics.
- Collaboration, shared projects or per-user commit visibility.
- SQLite table or column changes; the field lives in the existing document JSON.

## 10. Delivery sequence

1. Domain: `commits.ts` helpers, `Chapter.commits`, `createChapter`, constants.
2. Normalization and versions: `coerceChapter`, `SCHEMA_VERSION` 7,
   export instructions, `PROJECT_EXPORT_VERSION` 4, import repair.
3. API: Zod `commits`, OpenAPI `Chapter`/`CoverageRow`, regenerate generated
   types, coverage serialization.
4. State: reducer actions, immediate persistence, activity, provider wiring.
5. UI: `ChapterCommits` in `ChapterEditor`, coverage references, styles.
6. Documentation: README, `docs/api.md`, `AGENTS_template.md`, phase ideas.
7. Tests: unit, API, contract, Playwright, accessibility; run the full gate.

## 11. Files

New:

```text
src/domain/commits.ts
src/components/ChapterCommits.tsx
tests/unit/commits.test.js
tests/api/commits.test.ts
```

Modified:

```text
src/domain/chapters.ts              Chapter.commits, createChapter default
src/domain/schema.ts                normalization, SCHEMA_VERSION 7, export v4
src/domain/verification.ts          CoverageRow.commits
src/store/workspaceReducer.ts       addCommit/removeCommit actions and activity
src/store/WorkspaceProvider.tsx     commit action wiring
src/components/ChapterEditor.tsx    compact commit row
src/components/TestCoverageView.tsx commit references on coverage rows
src/styles.css                      commit chips, row, coverage references
server/api/schemas.ts               commitHashSchema, chapterSchema.commits
server/api/openapi.yaml             Chapter.commits, CoverageRow.commits
server/api/generated.d.ts           regenerated
tests/unit/chapters.test.js         commits default and immutability
tests/unit/schema.test.js           normalization, import, export
tests/unit/workspaceReducer.test.js commit actions and activity
tests/unit/verification.test.js     coverage commits
tests/api/document.test.ts          document and coverage responses
tests/contract/openapi.test.ts      new fields
tests/fixtures.js                   commit-bearing fixtures if needed
tests/verification.spec.js          coverage references
tests/commits.spec.js               browser flows (or extend workspace spec)
tests/accessibility.spec.js         axe coverage for commit states
README.md                           field meaning and format
docs/api.md                         commit examples and errors
AGENTS_template.md                  agent guidance for commit references
phases/phase-ideas.md               P-13 promoted, P-16 updated
```

## 12. Backlog relationship

- Phase 7 delivers **P-13 — commits**. P-13 is removed from
  `phases/phase-ideas.md`.
- **P-16 — Search** remains a separate phase. It can now search commit hashes
  without changing the storage model; keyword search, MCP exposure and search
  UI remain its own work.
- P-14 (Docker) and P-15 (MCP) are unaffected, except that MCP document writes
  must include normalized commit arrays once phase 7 lands.
- No commit metadata is added to the activity schema, so P-04 (durable audit
  log) is unchanged.

## 13. Delivery notes

Implemented as planned:

- `Chapter.commits` is a normalized array of lowercase 7–40 character hex
  hashes, newest first, capped at 50. The field lives in the existing
  `project_documents.chapters_json`, so no SQLite migration was needed.
- `SCHEMA_VERSION` is 7 and `PROJECT_EXPORT_VERSION` is 4. Version 3 imports
  still load with empty commit lists, and invalid hashes in an import are
  dropped with an issue instead of failing the import.
- The API accepts short, full and uppercase hex input and stores it lowercase.
  Invalid values return `422 validation_failed`; duplicates in a request are
  removed before storage; more than 50 values are rejected.
- The document view has a compact **Commits** row with chips, removal and an
  inline add form. It validates format, duplicates and the limit, clears errors
  on the next edit and is fully keyboard operable.
- Linking and removing a commit are immediate actions and append `Linked
  commit …` / `Removed commit …` activity entries attributed to the acting
  user.
- Coverage references are rendered inside each eligible-chapter row as the
  newest hash plus a `+N` count, rather than a separate table column. The
  coverage page is a list, so this matches the existing layout.
- README, `docs/api.md` and `AGENTS_template.md` document the field, format,
  export version and reference-only semantics.

Small deviations from the plan:

- Two existing low-contrast labels surfaced during accessibility checks: the
  new commits label and the activity actor line. Both were darkened to pass
  WCAG AA.
- The contract test now writes a commit through the documented document write
  path, so the new field is covered by the OpenAPI validation in addition to
  the dedicated API tests.

Verification: `format:check`, `lint`, `typecheck`, `test:unit`, `test:api`,
`test:contract`, `api:lint`, `build`, `test:e2e` (45 browser tests) and
`test:prod` all pass.

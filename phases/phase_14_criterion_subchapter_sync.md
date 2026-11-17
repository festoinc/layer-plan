# Phase 14 — Criterion and subchapter stay in sync

Status: draft for review  
Updated: 2026-11-17

## Why this phase

Adding a success criterion already creates a subchapter. Phase 1a moved that
rule into `ProjectStore.saveDocument`, so the browser, the REST API and MCP all
get the same generated chapter, link, activity and `createdSubchapters` report.
Creation is consistent; the pair is not.

Today the link `criterion.chapterId` is only enforced at creation:

- **Editing a criterion** changes only the checklist text. The linked
  subchapter keeps its old title and description, so the two documents drift
  apart.
- **Deleting a criterion** removes the checklist item but leaves the linked
  subchapter and its whole subtree in the tree as an ordinary chapter.
- **Deleting the subchapter** removes the criterion in the browser reducer
  only. Through the REST API or MCP, normalization silently drops the
  `chapterId` and the criterion survives as a standalone item, so identical
  user intent produces different documents.
- **Editing the subchapter** title or description never reaches the criterion.
- The server accepts any write, so an agent can create any of those states and
  nothing reports it.

Phase 1a covered creation with a backend-owned rule and a response report. This
phase extends the same approach to editing, detaching and deleting, so one
shared pure rule keeps every pair identical on every surface.

## Goal

After any successful document write:

- every criterion that created a subchapter still points at a chapter that is a
  direct child of the criterion's chapter, and no chapter is claimed twice;
- for every pair, `criterion.text` and the subchapter `description` are the
  same string and the subchapter `title` is derived from it with the existing
  `deriveCriterionTitle` rule;
- editing either side updates the other, deleting either side removes the
  other, and the write reports what the backend changed;
- the browser, the REST API and MCP produce the same document from the same
  intent;
- the browser still shows the result immediately and survives a reload.

## Locked decisions

| # | Decision | Choice |
| --- | --- | --- |
| 1 | Where is the pairing rule enforced? | **Backend.** `ProjectStore.saveDocument` applies it to every document write. The browser applies the same shared pure function locally for immediate feedback; the save response remains authoritative. |
| 2 | What happens when a write is inconsistent? | **Silent repair.** The write succeeds with `200`, returns the repaired document and a report. No new error code. |
| 3 | Is a new document field added? | **No.** Keep the single link `criterion.chapterId`. No `SCHEMA_VERSION` bump, no migration. |
| 4 | Is there a “customised” pair? | **No.** A pair is always a mirror. Q16: “They always need to be synchronized.” A subchapter title/description edit updates the criterion; a criterion edit updates the subchapter. |
| 5 | What is the canonical content? | **Criterion text.** `criterion.text` is the single Markdown source; `subchapter.description` mirrors it and `subchapter.title = deriveCriterionTitle(text)`. |
| 6 | Editing the subchapter title | **Rewrite the first line.** The typed title replaces the first line of the canonical text; the remaining Markdown lines are kept. The stored title is the derived form of the result. |
| 7 | Deleting a criterion | **Delete the linked subchapter and its whole subtree** when the chapter is still a direct child of the criterion's chapter and no other criterion claims it. |
| 8 | Deleting the subchapter | **Delete the criterion.** The browser already does this; the backend now does it too, so API and MCP match. |
| 9 | Detach | **Remove only `chapterId`.** Criterion and chapter both survive; the chapter becomes an ordinary manual chapter. Detach is not a delete. No detach control is added to the UI in this phase. |
| 10 | Moving a linked subchapter | **Detach.** If the chapter is not a direct child of the criterion's chapter, the link is dropped; nothing is deleted. |
| 11 | Conflicting edits in one write | **Criterion text wins.** If the criterion text and the subchapter description both changed, the criterion's version is stored. |
| 12 | New criterion linked to an existing chapter | **Criterion text wins.** The existing chapter's title and description are overwritten to mirror the criterion. |
| 13 | Existing projects | **No backfill, import or export change.** Drift is repaired on the next write only. Test data can be reset. |
| 14 | Activity | The backend adds one “Deleted subchapter from success criterion” event when it deletes a subchapter. Mirror updates add no event. The client keeps its own criterion event. |
| 15 | API surface | No new endpoint and no new MCP tool. The document write response gains one required object, `criterionSync`. |
| 16 | Text limits | Derived titles are clamped to the existing 200-character chapter title limit, fixing the phase 1a overflow edge case. The criterion text limit is raised to the 100000-character chapter description limit so the two mirrored sides accept the same content. |

## 1. Pairing model

### 1.1 Definitions

A **pair** is three ids:

- `P` — the chapter that owns the checklist item;
- `C` — a criterion in `P.criteria` with a non-empty `chapterId`;
- `S` — the chapter `C.chapterId` points at, with `S.parentId === P.id`.

A chapter is **linked** when some criterion in its parent names it. Every other
chapter is a **manual** chapter. Links are single-source: `C.chapterId` is the
only stored pointer, there is no reverse field and no marker on `S`.

### 1.2 Invariants

After every successful `PUT /api/v1/projects/{projectId}/document` and after the
browser applies the same rule locally:

1. Every non-empty `chapterId` references an existing chapter that is a direct
   child of the criterion's chapter.
2. At most one criterion claims a given chapter.
3. For every pair, `S.description === C.text`.
4. For every pair, `S.title === deriveCriterionTitle(C.text)`.
5. No pair is ever half-deleted: a criterion without its chapter and a linked
   chapter without its criterion cannot be stored.

Everything else about the pair stays independent: `checked`, commits,
verification rules, `finalLevel` and child chapters are never copied between the
criterion and the chapter.

### 1.3 Canonical text and derived fields

`C.text` is the canonical Markdown. It may span several lines. Its limit is
raised from 20000 to 100000 characters to match the chapter description limit,
so a linked subchapter description can always be mirrored without invalidating
the criterion.

- `S.description` is exactly `C.text`.
- `S.title` is `deriveCriterionTitle(C.text)`, clamped to
  `MAX_CHAPTER_TITLE` (200).
- A title edit is applied by replacing the first line of the canonical text:

  ```ts
  replaceFirstLine(text, title) =
    text.includes("\n") ? title + text.slice(text.indexOf("\n")) : title;
  ```

  The rest of the description is preserved. A whitespace-only title is treated
  as `Untitled chapter`, matching the browser.

Example:

```text
criterion.text        = "Reset email\n\nThe email contains one unique link."
subchapter.title      = "Reset email"
subchapter.description= "Reset email\n\nThe email contains one unique link."
```

## 2. Reconciliation rules

The rules live in one pure module, `src/domain/criterionLinks.ts`, and run in
this order inside `saveDocument`, after the existing normalization/validation
and after the `412` revision check.

### 2.1 Inputs

- `previous` — the normalized document currently stored for the project.
- `next` — the normalized document in the request.

The previous document is read from `project_documents.chapters_json` with
`normalizeDocument`. A stored document that cannot be parsed or normalized keeps
the existing `500 stored_data_invalid` behavior; the code does not guess.

Ordering is always deterministic: `walkChapters` pre-order for chapters,
`criteria` array order inside a chapter, `childIds` order for children. Object
key order in `byId` never affects the result.

### 2.2 Step 1 — Link repair

Walk the next document in order and keep a `claimed: Set<chapterId>`:

- drop `chapterId` when the target chapter is missing, is the same chapter, or
  has a different `parentId`;
- drop `chapterId` when the target chapter is already claimed by an earlier
  criterion;
- otherwise keep the link and mark the target claimed.

Repair only removes links. It never deletes or rewrites content. It does not run
on `GET`, import, project duplication or seed data; those keep today's behavior.

### 2.3 Step 2 — Removal cascades

Removal is decided by comparing `previous` and `next`:

**Criterion removed → subchapter deleted.** For every pair in `previous` whose
criterion is absent in `next`:

- if `S` no longer exists in `next`, do nothing;
- if `S` was moved (`S.parentId !== P.id` in `next`), do nothing (the link is
  already dropped by repair);
- if another criterion in `next` claims `S`, do nothing;
- otherwise delete `S` and its whole subtree from `next`.

**Chapter removed → criterion deleted.** Let `removed` be the ids present in
`previous` and absent in `next` (a removed subtree contributes every
descendant id). For every criterion in `previous` whose `chapterId` is in
`removed`, remove the matching `(P.id, C.id)` criterion from `next` when it is
still present.

Apply both rules until no further change (bounded by the chapter count).

Detaching is explicitly **not** a removal: removing only `chapterId` from a
criterion keeps both records and turns the chapter into a manual chapter.

### 2.4 Step 3 — Mirror sync

For every surviving pair, decide which side changed by comparing `previous` and
`next`. If `previous` had no valid pair for `(P, C, S)` — a new criterion, a new
link, or a pair that was invalid before repair — the pair is **new**.

| Case | Result |
| --- | --- |
| New pair | criterion wins: `description = text`, `title = derive(text)` |
| Criterion text changed | criterion wins: `description = text`, `title = derive(text)` |
| Description changed, title unchanged | description wins: `text = description`, `title = derive(description)` |
| Title changed, description unchanged | first-line rewrite: `text = replaceFirstLine(text, title)`, `description = text`, `title = derive(text)` |
| Title and description both changed | description wins: `text = description`, `title = derive(description)` |
| Neither changed | no change, unless the stored pair already drifted; then the criterion text wins |

Notes:

- A criterion edit never changes `checked`.
- A mirror change never changes commits, verification, `finalLevel` or children.
- `description` is stored verbatim (no trimming, Markdown preserved).
- If the derived title exceeds 200 characters it is clamped; the rest of the
  text is untouched.

### 2.5 Step 4 — Creation

Phase 1a creation runs after repair, cascades and sync, unchanged:

- a criterion that is absent from `previous` and has no `chapterId` in `next`
  gets a subchapter when its chapter is not `finalLevel` and its text is not
  empty;
- the generated chapter is created from the current criterion text, so a new
  pair is born already in sync;
- `createdSubchapters` is reported exactly as today.

A new criterion that names a missing or invalid chapter is repaired first, then
treated as unlinked, so it may receive a new subchapter.

### 2.6 Step 5 — selectedId

If reconciliation deleted the chapter named by `input.selectedId`, fall back to
`getDefaultId(chapters, null)` (the first root chapter) instead of returning
`422`. The existing validation still rejects an unknown id that reconciliation
did not touch.

### 2.7 Step 6 — Persist and report

- `chapters_json` and `selected_id` are written once, in the existing
  transaction.
- The revision increments only when the final document differs from the stored
  one; a re-save of an already consistent document is a no-op, exactly like
  phase 1a.
- Stats, coverage, export and activity reflect the reconciled document.
- The response reports what the backend changed, not what the client sent:

```ts
export interface CriterionSync {
  updatedSubchapters: Array<{
    id: string;
    parentId: string;
    criterionId: string;
    title: string;
    description: string;
  }>;
  removedSubchapters: Array<{
    id: string;
    parentId: string;
    criterionId: string;
    title: string;
  }>;
  removedCriteria: Array<{
    chapterId: string;
    criterionId: string;
    text: string;
  }>;
}
```

All arrays are present and may be empty. A UI save that already applied the
rule locally returns empty arrays.

### 2.8 Activity

When the backend deletes a subchapter (criterion removed through API or MCP),
it appends one event per deleted subtree root, before the client entries:

```json
{
  "message": "Deleted subchapter from success criterion",
  "chapterId": null,
  "chapterName": "<removed chapter title>"
}
```

The browser logs its own criterion event. Because the browser also removes the
subchapter locally, the backend sees both records already gone and adds nothing,
so the pair is always reported by exactly one actor. Mirror updates add no
activity, matching today's “Updated description”/“Updated criterion” blur
events.

## 3. Server implementation

### 3.1 Shared pure module

Add `src/domain/criterionLinks.ts`. It imports only domain types and helpers
(`ChapterDocument`, `walkChapters`, `collectSubtreeIds`, `patchChapter`,
`setCriteria`, `deleteSubtree`, `deriveCriterionTitle`, `MAX_CHAPTER_TITLE`). It
must not import SQLite, Fastify or React.

```ts
export interface CriterionSyncActivity {
  message: string;
  chapterId: string | null;
  chapterName: string;
}

export interface CriterionReconciliation {
  document: ChapterDocument;
  sync: CriterionSync;
  activity: CriterionSyncActivity[];
}

export function reconcileCriterionLinks(
  previous: ChapterDocument,
  next: ChapterDocument,
): CriterionReconciliation;

export function applyCriterionSync(
  document: ChapterDocument,
  snapshot: ChapterDocument,
  source: ChapterDocument,
  sync: CriterionSync,
): ChapterDocument;
```

- `reconcileCriterionLinks` implements sections 2.1–2.5 and 2.8. It returns a
  new document and never mutates either input. Heavy untouched subtrees keep
  their object identity, like every other domain operation.
- `applyCriterionSync` is the browser merge helper described in section 4.4.
- Keep `deriveCriterionTitle` in `criteria.ts`; add `MAX_CHAPTER_TITLE` next to
  the other chapter limits and reuse it in the API schema and the derivation.

### 3.2 Store integration

In `SaveDocumentResult` keep `createdSubchapters` and add:

```ts
sync: CriterionSync;
```

In `saveDocument`, replace the current `previousCriterionKeys` /
`expandCriterionSubchapters` sequence with:

1. `previous = normalizeDocument(parsedPrevious).document` (existing stored-data
   error behavior);
2. `reconciled = reconcileCriterionLinks(previous, normalizedChapters)`;
3. `expanded = this.expandCriterionSubchapters(reconciled.document, previous)`;
4. validate the reconciled `selectedId`, compute stats, revision and timestamps;
5. persist, then `insertNewActivity(id, [...clientActivity, ...reconciled.activity, ...expanded.activity], ownerId)`;
6. return `document`, `activity`, `stats`, `createdSubchapters`, `sync`.

`expandCriterionSubchapters` keeps using the store id factory and takes the
reconciled document plus the previous document (it needs the previous criterion
keys, including the ones that survived repair). It no longer re-reads raw JSON.

Do not change `normalizeDocument`, `getDocument`, `importProject`,
`duplicateProject` or `seedSamples`. Read behavior and imports stay exactly as
they are.

### 3.3 Response and OpenAPI

`server/api/routes/document.ts` already spreads the store result. Add:

```json
"criterionSync": {
  "updatedSubchapters": [],
  "removedSubchapters": [],
  "removedCriteria": []
}
```

to the `PUT /projects/{projectId}/document` response.

- Add `CriterionSync`, `UpdatedCriterionSubchapter`, `RemovedCriterionSubchapter`
  and `RemovedCriterion` schemas to `server/api/openapi.yaml`; add
  `criterionSync` to `DocumentWriteResponse.required`.
- Regenerate `server/api/generated.d.ts` with `npm run api:types` and run
  `npm run api:lint`.
- Update `src/api/types.ts` (`DocumentWriteResponse`) so the browser and the
  server share the shape.
- The request contract does not change: no new fields, no new error codes.

## 4. UI

### 4.1 Immediate local rule

The browser must not wait for a round trip to show an edit. The reducer applies
the same `reconcileCriterionLinks` to the local chapters for these actions:

- `setCriterionText` — mirror the subchapter title and description;
- `setChapterField` for `title` and `description` on a linked subchapter —
  mirror the criterion text (and the derived title);
- `removeCriterion` — delete the linked subchapter subtree and log
  “Deleted subchapter from success criterion”;
- `deleteChapter` — keep the existing criterion removal; reconciliation is a
  no-op but runs for safety.

`addCriterion` deliberately does not create a chapter: creation stays
backend-owned from phase 1a. `applyServerChapters` and `replaceWorkspace` never
run the rule; the server document is already reconciled.

The shared function makes the snapshot the browser sends already consistent, so
the backend's `criterionSync` is normally empty for UI saves and the two sides
cannot disagree.

### 4.2 Deleting a criterion

The remove button on a criterion row opens a confirmation dialog when the
cascade would delete more than the mirrored pair:

- the subchapter has child chapters;
- it has its own criteria;
- it has commits;
- its verification mode is not `human` or any verification text is non-empty;
- its description differs from the criterion text (defensive; the invariant
  says it cannot).

Otherwise the pair is deleted immediately, matching the current one-click
removal for standalone criteria.

`DeleteCriterionDialog` follows `DeleteChapterDialog`: title
“Delete “<criterion title>”?”, the subchapter title, the descendant count, a
note that the checklist item and the subchapter are removed together, and the
existing focus trap. The criterion row's remove button label mentions the
cascade when a subchapter is linked.

### 4.3 Link affordance

- A criterion row with `chapterId` gets a link button (lucide `CornerDownRight`)
  labelled `Open subchapter: <title>` that selects the chapter.
- A linked subchapter editor shows a small note under the breadcrumbs:
  “Created from the success criterion in “<parent title>”” with a button that
  selects the parent chapter.
- Both are keyboard reachable and have accessible names; add the new text to the
  Playwright and axe coverage.

There is no detach control in the UI in this phase. Detach stays available
through the REST API and MCP by removing `chapterId`; the docs describe it.

### 4.4 Applying the server response

`WorkspaceProvider.runSave` currently applies `createdSubchapters`. Extend it:

- when the workspace still equals the sent snapshot and the response contains
  created chapters, updated subchapters or removals, replace the chapters with
  `response.chapters` (the authoritative document);
- when the workspace changed while the save was in flight, call
  `applyCriterionSync(current.chapters, snapshot.chapters, response.chapters,
  response.criterionSync)`:
  - remove every `removedSubchapters` subtree and every `removedCriteria`
    criterion that is still present;
  - for `updatedSubchapters`, set title/description only when the current value
    still equals the snapshot value, so a field the user is typing in is never
    overwritten;
  - fall back from a `selectedId` that pointed at a removed chapter;
- apply the same removals to `pendingRef.current` so the debounced next save
  cannot resurrect a chapter the backend deleted;
- update `lastSavedRef` to the merged document before dispatching.

If the server response is empty (the common UI case), behavior is unchanged.

## 5. API, MCP and documentation

### 5.1 REST

No new endpoint. `PUT /projects/{projectId}/document` keeps its `ETag`,
`If-Match`, `412 revision_conflict` and `422 validation_failed` behavior; the
only contract change is the response object described in 2.7/3.3.

### 5.2 MCP

- Keep the tool list unchanged: `replace_document` already returns the envelope
  body, so `criterionSync` arrives automatically.
- Update the `replace_document` description: the backend keeps a criterion and
  its subchapter synchronized; edit the criterion text to change both; deleting
  a criterion or its subchapter removes the pair.
- Update `server/mcp/instructions.md`:
  - the criterion text is the canonical Markdown and the subchapter mirrors it;
  - editing a linked subchapter's title or description also updates the
    criterion; editing the criterion updates the subchapter;
  - deleting a criterion deletes the subchapter subtree, and deleting the
    subchapter deletes the criterion;
  - to keep a chapter while removing its checklist item, remove only
    `chapterId` (detach) and save;
  - do not invent `criterionSync` values; read the returned document;
  - retain the existing rule that new criteria are sent without `chapterId` and
    the backend creates the subchapter.
- Update the MCP test expectation strings that assert the initialization
  instructions.

### 5.3 Docs

- `README.md`: the criterion section states that the checklist item and its
  subchapter stay synchronized, that either side can be edited, and that
  deleting one deletes the other.
- `docs/api.md`: document write section gains a “Criterion subchapters” part with
  the invariants, the precedence rules, detach, the `criterionSync` response and
  a curl example.
- `LAYERS_AGENT_GUIDE.md`: replace “Keep that link consistent” with the exact
  rules and the response fields.
- `server/api/openapi.yaml` + `server/api/generated.d.ts`: section 3.3.
- `phases/phase-ideas.md`: no backlog change. P-16 was already removed by phase
  13; do not add this phase as a new idea.
- `AGENTS.md`: no change unless delivery changes repository guidance.

## 6. Tests and acceptance criteria

CI is the only test gate. The phase is not delivered until `verify` passes with
the new tests.

### 6.1 Unit — `tests/unit/criterionLinks.test.ts`

- Link repair: missing target, self-link, wrong parent, grandchild, duplicate
  claim; first claim wins; repair never deletes content.
- Criterion removal deletes the subtree, including children, criteria, commits
  and verification; it reports `removedSubchapters`.
- No deletion when the chapter was moved, already gone, or claimed by another
  criterion.
- Chapter removal removes matching criteria and reports `removedCriteria`;
  ancestors and moved chapters are unaffected.
- Detach by removing only `chapterId` keeps both records.
- Mirror sync for each row of the table in 2.4, including first-line rewrite,
  multiple Markdown lines, empty title, 200-character clamp, empty text.
- New pair and new link cases: criterion wins; existing chapter is overwritten.
- Idempotency: `reconcile(previous, previous)` returns the same document and an
  empty report; a second pass over a reconciled document changes nothing.
- No mutation of `previous` or `next`, and untouched chapters keep identity.
- Determinism under different `byId` key insertion orders.
- Parity: for the same action, the reducer result equals
  `reconcileCriterionLinks(before, reducerOutput)` — the browser and the backend
  cannot diverge.

### 6.2 UI unit — `tests/unit/workspaceReducer.test.js`

- `setCriterionText` updates the linked subchapter title and description.
- Editing a linked subchapter's description updates the criterion text and
  derived title; editing its title rewrites the first line and keeps the rest.
- `removeCriterion` deletes the subchapter subtree and appends
  “Deleted subchapter from success criterion”.
- `deleteChapter` still removes the parent criterion.
- Standalone criteria are untouched.
- `addCriterion` still creates only the criterion and its activity.

### 6.3 API — `tests/api/document.test.ts` and a focused
`tests/api/criterionLinks.test.ts`

- PUT that edits a criterion text returns the synced subchapter in the document
  and `criterionSync.updatedSubchapters`, persists it, bumps the revision once
  and does not duplicate chapters.
- PUT that edits the subchapter description updates the criterion text; PUT that
  edits its title rewrites the first line.
- PUT that deletes a criterion deletes the subtree, returns
  `removedSubchapters`, removes the chapters from `GET /document`, `coverage`
  and `export`, and adds the deletion activity.
- PUT that deletes a subchapter removes the criterion in `GET /document` and
  returns `removedCriteria`.
- PUT that detaches keeps both and stores no `chapterId`.
- PUT that moves a linked chapter out of its parent detaches it without deleting.
- A stale `selectedId` pointing at a cascaded chapter falls back to the first
  root chapter instead of `422`.
- A second identical save is a no-op: same revision, empty `criterionSync`.
- Stale writes still return `412 revision_conflict` before any reconciliation.
- `finalLevel` still suppresses creation and does not stop sync/delete for an
  existing pair.
- Activity feed shape and actor attribution are unchanged apart from the new
  event.

### 6.4 MCP — `tests/api/mcp.test.ts`

- `replace_document` that edits only the criterion text returns `criterionSync`
  and the mirrored chapter; the response and `get_document` agree.
- `replace_document` that deletes only the criterion removes the subchapter and
  reports it.
- `replace_document` that deletes only the subchapter removes the criterion and
  reports it.
- Detach through `chapterId` removal keeps both records.
- The tool list and annotations are unchanged.
- Initialization instructions contain the new synchronization rules.

### 6.5 Contract

- `npm run api:lint` passes; `criterionSync` is required and every new schema
  validates.
- `npm run api:types` is stable (`git diff --exit-code -- server/api/generated.d.ts`).
- A document write response generated from the app validates against the
  OpenAPI schema in `tests/contract/openapi.test.ts`.

### 6.6 Playwright — `tests/criterionLinks.spec.js`

- Edit a criterion text: the subchapter title/description update immediately,
  the save settles, and a reload shows the same values from the API.
- Edit a linked subchapter description and title: the criterion text updates,
  and the change survives a reload.
- Delete a trivial criterion: no dialog, the subchapter disappears immediately
  and stays gone after reload.
- Delete a criterion whose subchapter has a child chapter: the dialog lists the
  subtree, cancel keeps everything, confirm deletes the checklist item and the
  subtree, and the API document confirms it.
- Delete a subchapter from the sidebar: the parent criterion is gone after
  reload.
- The criterion link button opens the subchapter and the reverse note opens the
  parent.
- Final level still creates no subchapter.
- The new dialog and link controls pass the existing axe checks.

### 6.7 Quality gate

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
```

### 6.8 Remote acceptance

Publish the image, deploy the exact digest on the shared test host with the
existing loopback-only override, and:

1. reset or create a disposable project;
2. add a criterion through the REST API without a subchapter and confirm the
   backend creates it (phase 1a regression);
3. edit the criterion through REST and confirm the subchapter title/description
   in `GET /document`;
4. edit the subchapter description and title through REST and confirm the
   criterion text;
5. delete the criterion and confirm the subchapter subtree, coverage and export
   are gone and the activity has one deletion event;
6. repeat the edit/delete cases through MCP and confirm `criterionSync`;
7. in the browser, edit both sides, delete a trivial and a non-trivial pair, and
   confirm a reload matches the API;
8. confirm no orphaned chapter or half-pair is left;
9. clean up containers, volumes, the test directory and temporary credentials;
10. record the tested tags/digest and cleanup in the handoff.

## 7. Delivery sequence

1. Add `MAX_CHAPTER_TITLE` and the title clamp; add
   `src/domain/criterionLinks.ts` with unit tests.
2. Integrate repair/cascade/sync into `saveDocument`, keep creation, add the
   activity and the `sync` result.
3. Add `criterionSync` to the route response, OpenAPI, generated types and
   `src/api/types.ts`; run `api:lint` and `api:types`.
4. Apply the shared rule in the reducer and add the UI unit tests.
5. Extend `WorkspaceProvider` with the authoritative-response and dirty-state
   paths.
6. Add the delete confirmation, the link affordance and the reverse note.
7. Update MCP descriptions, instructions and tests.
8. Update `README.md`, `docs/api.md` and `LAYERS_AGENT_GUIDE.md`.
9. Run the static/build gate, push a branch/PR, wait for CI `verify`.
10. Publish, run the remote acceptance, clean up, mark this phase `delivered`,
    rename it with `[done]` and update the handoff.

## 8. Boundaries

- No document schema change, no new persisted field and no `SCHEMA_VERSION`
  bump.
- No migration, backfill, import/export change or read-time repair. Existing
  drift is fixed on the next write; the test databases can be reset.
- No new REST endpoint, no new MCP tool and no new permission or scope.
- No detach button in the UI; detach is an API/MCP link removal.
- No change to project creation, duplication, seed data, search, routing or
  activity retention.
- No change to coverage, verification, commits or `finalLevel` semantics.
- No undo, history or trash for pair deletion.
- No change to the phase 1a creation rule or to `createdSubchapters`.
- No browser-only persistence and no offline queue.

## 9. Confirmed decisions

1. **Two-way mirror (Q6/Q16).** Confirmed. A full mirror, including rewriting
the first line of the criterion when the subchapter title changes. There is no
“customised” state.
2. **Detach (Q10).** Confirmed. No detach control in the UI; removing only
`chapterId` through the REST API or MCP detaches the pair and keeps both
records.
3. **Move (Q11).** Confirmed. Moving a linked chapter out of its criterion's
chapter detaches it and deletes nothing.
4. **Link affordance (Q15).** Included: a criterion-row “Open subchapter” button
and a reverse “Created from the success criterion” note that opens the parent.
The reverse note is text plus a button, not a new editor mode.

# Phase 1a — Backend-owned criterion subchapters

Status: draft for review  
Updated: 2026-11-17

## Why this phase

Phase 1 made adding a success criterion create a matching subchapter in the UI:
the criterion stores the new chapter in `criterion.chapterId`, the parent gains
the subchapter in `childIds`, and the subchapter title comes from the first line
of the criterion. **Final level** suppresses the automatic chapter.

That rule currently lives in the browser reducer. API and MCP writes send a
complete document and do not run the rule, so the same criterion can exist with
or without a subchapter depending on the client. A recent MCP instruction change
asked agents to reproduce the rule, but instructions are guidance, not a
contract. This phase moves the rule into `ProjectStore.saveDocument` so every
document write has the same result.

## Decisions to confirm

| # | Decision | Recommendation |
| --- | --- | --- |
| 1 | Should the UI keep creating the subchapter optimistically, or let the backend do it? | **Backend only.** The UI applies the created chapters from the save response. This removes duplicate logic and makes the write response authoritative. |
| 2 | Should existing standalone criteria be converted? | **No backfill.** Only criteria absent from the previously stored document are candidates. |
| 3 | Should a standalone criterion remain possible on a non-final chapter? | **No for new criteria.** Set `finalLevel` on the chapter, or link the criterion to an existing `chapterId`, when a subchapter is not wanted. |
| 4 | What happens for empty or whitespace-only criterion text? | **No subchapter.** Leave the criterion exactly as sent; the UI already prevents empty criteria. |
| 5 | Who records activity? | The client keeps its “Added criterion” event. The backend adds one **“Created subchapter from success criterion”** event for each chapter it creates. |

## Goal

A criterion added by the browser, the REST API or MCP produces the same
subchapter, links, activity and metadata. The rule is enforced in one place, is
covered by backend and UI tests, and the browser does not depend on an agent
following instructions.

## Locked behavior

For every successful `PUT /api/v1/projects/{projectId}/document`:

1. Compare the normalized incoming document with the document currently stored
   for the project.
2. A criterion is **new** when its `(chapterId, criterionId)` pair is absent from
   the previous document. Criterion ids are unique per chapter, not globally.
3. For each new criterion:
   - if the containing chapter has `finalLevel: true`, do nothing;
   - if `criterion.chapterId` is already set, do nothing;
   - if `criterion.text.trim()` is empty, do nothing;
   - otherwise create one subchapter.
4. The new subchapter:
   - gets a fresh chapter id from the store id factory;
   - has `parentId` set to the containing chapter;
   - has `title = deriveCriterionTitle(criterion.text)`;
   - has `description = criterion.text` (the full criterion Markdown);
   - starts with the normal default verification, criteria, commits and
     `childIds`;
   - is appended to the parent `childIds`, matching the UI;
   - is referenced from `criterion.chapterId` in the saved document.
5. Existing criteria are never expanded or backfilled. Removing or unlinking an
   existing criterion-created subchapter is still allowed.
6. Re-saving a document that already contains the generated subchapter changes
   nothing and does not bump the revision.
7. A new criterion with a non-empty `chapterId` is trusted as already linked;
   the backend does not create a second chapter.
8. Created chapters are part of the persisted document, stats, coverage,
   export and activity exactly like manually created chapters.

## Backend implementation

`server/db/store.ts` owns the normalization inside `saveDocument`, after the
existing normalization/validation and inside the same transaction as the document
update.

Add a result shape:

```ts
export interface CreatedCriterionSubchapter {
  id: string;
  parentId: string;
  criterionId: string;
  title: string;
}

export interface SaveDocumentResult {
  document: DocumentSnapshot;
  activity: ActivityEntry[];
  stats: ProjectStats;
  createdSubchapters: CreatedCriterionSubchapter[];
}
```

`createdSubchapters` is `[]` when the write created nothing. The response
document already contains the full subchapter records; the metadata is for
client reconciliation and tests.

The backend adds the subchapter activity entries before inserting activity:

```json
{
  "message": "Created subchapter from success criterion",
  "chapterId": "<new chapter id>",
  "chapterName": "<derived title>"
}
```

Use the store's `newId` factory for chapter and activity ids. Use the existing
`deriveCriterionTitle` and `createSubchapterFromCriterion` domain helpers; do not
duplicate Markdown-title logic in the store.

The previous document is read from `project_documents.chapters_json` after the
revision check. If it cannot be parsed, fail with the existing stored-data error
instead of guessing. The revision increments once, because the generated
chapters are part of the new `chapters_json`.

`POST /projects`, imports and seed data keep their current behavior. A new
project has no criteria; imports preserve their document exactly, including
standalone criteria. The rule applies only to document writes after a project
exists.

## API and MCP contract

`DocumentWriteResponse` gains:

```json
{
  "createdSubchapters": [
    {
      "id": "chapter-id",
      "parentId": "parent-chapter-id",
      "criterionId": "criterion-id",
      "title": "Derived title"
    }
  ]
}
```

- Add the schema and response field to `server/api/openapi.yaml`, regenerate
  `server/api/generated.d.ts`, and update the API docs.
- MCP `replace_document` returns the same envelope body, so agents see the
  generated chapters and metadata automatically.
- Remove the phase 12 MCP instruction that tells agents to create the subchapter
  themselves. Replace it with: send the new criterion without `chapterId`, do
  not invent a subchapter, and use the subchapter returned by the write.
- Update the `replace_document` tool description to say the backend creates the
  subchapter for new criteria unless the chapter is final level.
- Keep the tool list unchanged; no new endpoint or tool is required.

## UI changes

The UI stops generating subchapters locally:

- `workspaceReducer` `addCriterion` adds only the criterion and its “Added
  criterion” activity.
- Remove `createSubchapterFromCriterion`, `subchapterId` and
  `subchapterActivityId` from the reducer action path.
- The editor still reveals the parent branch after submit; the subchapter
  arrives with the immediate save response.

`WorkspaceProvider` applies `createdSubchapters` after every successful save:

1. If the current state’s chapters still equal the saved snapshot, replace the
   workspace chapters with the response document. This is the normal path for
   the immediate criterion save.
2. If the user edited while the save was in flight, merge only the created
   subchapters into the current document:
   - add the subchapter object from the response if it is absent;
   - append its id to the parent’s `childIds` if it is absent;
   - set the matching criterion’s `chapterId` if the criterion still exists and
     is unlinked.
3. Update `lastSavedRef` to the merged document before dispatching so the save
   effect does not immediately schedule a redundant write.
4. Keep the existing activity merge; the backend-created “Created subchapter”
   event arrives in `response.activity`.
5. If a merge cannot apply because the parent chapter or criterion was deleted,
   skip that subchapter; the next save remains the source of truth.

The UI must never send a document back to the server with a server-created
subchapter removed by a stale in-memory snapshot.

## Tests and acceptance criteria

1. **Domain/unit:**
   - title derivation is still shared and unchanged;
   - subchapter shape, parent link, child ordering and `criterion.chapterId`;
   - final-level suppression;
   - existing standalone criteria are not backfilled;
   - linked criteria are not duplicated;
   - empty text does not create a chapter;
   - multiple new criteria in one chapter and across chapters;
   - id factory collisions are handled.
2. **Store/API:**
   - `PUT /document` with a new criterion returns `createdSubchapters`, saves the
     subchapter, links the criterion, increments revision and adds activity;
   - a second identical save is a no-op and does not duplicate chapters;
   - final-level chapters stay flat;
   - existing criteria remain untouched;
   - concurrent stale writes still return `412 revision_conflict`;
   - stats, coverage and export include the generated chapter;
   - project creation and import do not auto-expand documents.
3. **MCP:**
   - `replace_document` with a new criterion creates the subchapter even when the
     caller sends no subchapter;
   - the response envelope includes the created chapter and metadata;
   - the initialization instructions no longer tell agents to create the
     subchapter manually;
   - a final-level chapter remains flat;
   - an agent retry with the returned document is idempotent.
4. **UI unit:**
   - `addCriterion` no longer creates a chapter;
   - applying `createdSubchapters` to a clean snapshot and to a document with
     newer local edits both produce the expected links;
   - activity merge preserves the backend event.
5. **Playwright:**
   - adding a criterion shows the subchapter after the immediate save, survives
     reload, and records both activity entries;
   - Final level prevents the new subchapter;
   - deleting a generated subchapter detaches the criterion and stays deleted;
   - an existing standalone criterion is not converted.
6. **Quality gate:** `npm run lint`, `npm run format:check`, `npm run typecheck`,
   `npm run test:unit`, `npm run test:api`, `npm run test:contract`,
   `npm run api:lint`, `npm run build`, `npm run test:e2e`.
7. **Remote check:** run the exact published image, add a criterion through the
   API/MCP without a subchapter, confirm the generated chapter and activity, and
   confirm the UI and a reload show the same document. Clean up test resources.

## Delivery sequence

1. Add the store normalization, `createdSubchapters` result, activity and tests.
2. Update the REST response, OpenAPI, generated types and docs.
3. Update MCP instructions/tool description and MCP tests.
4. Remove the reducer rule and add UI response reconciliation with unit tests.
5. Add Playwright coverage and run the full CI gate.
6. Publish, run the remote API/MCP/UI check, record the tested digest and clean up.

## Boundaries

- No backfill of existing standalone criteria.
- No new `add_criterion` endpoint or MCP tool.
- No change to import/export behavior, project creation or document schema.
- No change to the final-level flag semantics.
- Phase 12 OAuth behavior is unchanged; only the MCP document instructions and
  the shared document write response change.

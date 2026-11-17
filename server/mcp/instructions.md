# Layers agent instructions

Layers MCP tools are the source of truth. This MCP connection is bound to exactly one project: its owner and the project id are fixed by the credential. The credential may be a project API key or an OAuth connection; the credential type does not change the tools or permissions. Never ask for a password, API key, OAuth code, access token, or another project id in chat. Use list_projects to see the bound project and use that project id on every project tool. A different project id returns not_found. The REST API is not available to this credential.

## What a Layers project looks like

A project holds one goal. The goal is broken into chapters, and every chapter is broken into success criteria. Chapters nest; criteria are the checkable statements. A chapter answers "which part of the goal is this?" and a criterion answers "how do we know this part is done?".

The shape, for an authorization goal:

```text
Chapter: I want authorization to work
├── Criterion: Login should be email
│   └── Subchapter: Login should be email            (created by the backend from that criterion)
│       └── Criterion: When checking login we need to be sure that @ is in the string
└── Criterion: Password needs to be 8 chars
```

How to read that tree:

- The top chapter keeps the user's intent in their own words. Its description can carry context.
- A criterion is one observable expectation. On a non-final chapter it becomes a subchapter whose title is the criterion's first line and whose description is the full criterion text, so a broad criterion such as "Login should be email" can hold its own criteria. The pair stays synchronized: editing either side updates the other, and deleting either side deletes the pair.
- `finalLevel: true` keeps a chapter flat: its criteria stay leaves and no subchapter is created.
- One expectation belongs in one criterion. Splitting "login and password are validated" into two criteria keeps each one checkable.
- Chapters also carry a verification rule (`auto`, `human` or `ai`), the git commits that implemented them, and their child and criterion ordering.

Because of the subchapter rule, a non-final chapter cannot hold a leaf criterion: every new criterion there creates a subchapter, and the backend does not ask. Decide `finalLevel` before you add criteria. Set it to true for chapters whose criteria are leaves, and leave it false only when you intend to decompose the criteria into their own subchapters. Never leave auto-created subchapters empty.

Where the goal lives: put the one-line goal in the project description (it is limited to 280 characters) and let the first root chapter carry the intent in the user's words. Write it once and reference it; do not repeat the goal in every chapter description. A newly created project starts with one placeholder root chapter titled "Overview", so decide whether to rename it into the goal chapter, keep it as a root index, or delete it before adding criteria.

Descriptions and criterion text support GitHub-flavored Markdown. The subchapter title is derived from the first line of the criterion with Markdown markers, links and emphasis removed, so keep the first line short and plain and put detail on later lines. Markdown in a criterion also becomes the subchapter description.

`checked` on a criterion is the person's done/verified checkbox. Preserve it in every write. Change it only when the person says a criterion is verified or no longer verified, and never infer it from tests, commits or your own reading.

## Ask how to plan before writing

When the user starts or reshapes a project and has not already chosen a way of working, ask one short question and wait for the answer:

1. **Whole project first** — the user describes the project globally; you discuss it, propose the structure, and then write all detailed success criteria yourself.
2. **Criterion by criterion** — the user defines the goal, then you walk one criterion at a time and discuss each before writing it.

Do not choose for the user and do not write document content before the answer. If the user already stated a preference, or is clearly continuing an established project, follow that and do not re-ask. The user may switch later; adopt the new mode without rewriting what was already agreed.

### Mode 1 — whole project, then detail

1. Read the project and document. Let the user describe the goal, users, context, non-goals and constraints in their own words.
2. Discuss globally: scope, boundaries, risks, and what "done" means. Write nothing yet.
3. Propose the chapter outline with a one-line purpose per chapter, and for each chapter the criteria you intend to add. Ask for approval, then adjust until the user agrees.
4. After approval, write the approved outline and criteria in a single document write when it fits. This is the one permitted bulk write; after it, continue chapter by chapter.
5. Read the result back, show the tree with the subchapters the backend created, and ask which criteria still need detail. Decompose the broad ones by adding criteria to their subchapters rather than long criterion sentences.

### Mode 2 — criterion by criterion

1. Read the project and document. Ask for the goal as one explicit sentence ("I want ...") and agree the main chapters that will hold the criteria.
2. Write only the agreed goal, chapter titles and descriptions. Do not pre-write criteria the user has not seen.
3. Walk the criteria one at a time: propose one criterion, state exactly what it checks and how it would be verified, wait for the user to accept or correct it, then write it before proposing the next. Each write covers one criterion.
4. When a criterion is broad, offer to open its subchapter and discuss its own criteria one at a time at that point.
5. Keep a short running list of written criteria and open questions so the user always knows where the walk is and what comes next.

In both modes: ask instead of inventing scope, keep one expectation per criterion, avoid duplicates, and stop to confirm before large or destructive rewrites.

## Tool results and revisions

Every tool result is an envelope `{ status, body, etag }`. Check `status` before using `body`. A failed call also returns the envelope with `isError: true` and the API error in `body.error`, which carries `code`, `message` and sometimes `details`. Branch on `error.code`, not only on the HTTP status. `etag` is the exact ETag header value when present, otherwise null.

An ETag is a quoted revision such as `"12"`. Pass the `etag` value to `ifMatch` verbatim, including the quotes. The ETag from get_document belongs to replace_document; the separate ETag from get_project belongs to update_project and delete_project. Never swap them. After a successful write, use the returned `etag` for the next write. On a revision conflict, reread and rebase; never blindly retry or overwrite.

A write that changes nothing keeps the same revision: an identical document, or an activity-only append, returns the current revision instead of a new one. Compare the returned chapters, `stats` or `createdSubchapters` to decide whether your change landed; do not assume a write was lost.

## Reading and writing the document

Read the project and document before changing them. Never invent project, chapter, criterion or activity IDs or existing content. Preserve all unrelated fields, links and ordering. Work on one document at a time unless the user explicitly requests a batch.

get_document returns a read model with `schemaVersion`, `projectId`, `revision`, `updatedAt`, `chapters` and `selectedId`. replace_document accepts only `chapters`, `selectedId` and an optional `activity` array, and it rejects unknown fields. Send the write body in that shape; never send back the read model or the write response.

Every chapter record needs all of its fields. A new chapter looks like this:

```json
{
  "id": "auth-login-email",
  "parentId": "auth",
  "title": "Login should be email",
  "description": "Markdown description.",
  "finalLevel": true,
  "verification": {
    "mode": "human",
    "auto": { "command": "" },
    "human": { "instructions": "Try signing in with an address without @" },
    "ai": { "instructions": "" }
  },
  "criteria": [
    {
      "id": "auth-login-email-1",
      "text": "The login field accepts an email address",
      "checked": false
    }
  ],
  "commits": [],
  "childIds": []
}
```

`commits` may be omitted and defaults to an empty list; everything else above is required. A criterion is `id`, `text`, `checked` and, only when it owns a synchronized subchapter, `chapterId`.

Choose IDs yourself for new chapters, criteria and activity entries: unique, lowercase, readable, at most 128 characters, and stable. Never reuse an ID for a different thing, never rename an existing ID, and never collide with an existing ID. Activity entries with a reused ID are silently dropped, so give every new entry a fresh one.

Every chapter must be reachable exactly once: either listed in `rootIds` or referenced by exactly one parent's `childIds`. The list order is the display order. If you add a chapter to `byId` without linking it, the backend silently promotes it to the root; duplicate or cyclic references are silently dropped, so a broken write can look successful.

To delete a chapter, remove it from `byId`, remove it from its parent's `childIds` or `rootIds`, and decide what happens to its children: reparent them or delete them with it. If the chapter came from a criterion, deleting it also deletes that criterion. To keep the criterion and turn the chapter into a manual chapter, detach by clearing `chapterId` in a separate write before deleting anything.

`selectedId` is the chapter the person currently sees in the browser. Keep it unchanged, or set it to a chapter that exists after your write; it must be null or an existing chapter ID.

The backend creates the matching subchapter when you add a new success criterion to a chapter whose finalLevel is false. Send the new criterion without chapterId and do not invent or append a subchapter yourself; use the chapters and createdSubchapters returned by replace_document. The backend skips final-level chapters, existing criteria, already-linked criteria and empty text. Never backfill subchapters for existing criteria. The response activity includes the backend's subchapter event; keep your own activity entries for the criterion change.

A success criterion with `chapterId` and the subchapter it names are one synchronized pair. The criterion text is the canonical Markdown; the subchapter `description` is the same string and its `title` is derived from the first line. Edit either side and the backend mirrors the change: editing the criterion text updates the subchapter, editing only the subchapter description updates the criterion text, and editing only the subchapter title rewrites the first line of the criterion text. If both sides change in one write, the criterion text wins. Deleting a criterion deletes its subchapter and that subchapter's whole subtree; deleting the subchapter deletes the criterion. A chapter moved out of its criterion's chapter is detached, not deleted. To keep a subchapter while removing its checklist item, detach it by removing only `chapterId` and saving first, then delete the criterion in a later write. Never try to keep the two sides different. Read the returned document and `criterionSync` (`updatedSubchapters`, `removedSubchapters`, `removedCriteria`); never invent those values.

Use search_project to find a chapter by keyword or commit prefix before reading it. Search covers chapter titles, descriptions, criterion text, commit hashes, and the auto, human and ai verification text. It searches only the bound project; activity, project metadata and test guidelines are not searched. Commit terms of 4–40 hexadecimal characters match by prefix. Results are chapter-level and reflect the saved document, so read the matched chapter with get_document before editing it. Search does not change the document or its revision.

Ask the user to confirm before deleting the project or a chapter, removing existing criteria or content, or overwriting conflicting changes. Record meaningful documentation changes in activity.

## Activity

Activity is the project history the person sees. Each new entry is `{ id, message, chapterId, chapterName }`; the server assigns the time and actor. Write one entry per meaningful change, in the user's language, naming the chapter it belongs to, for example "Added 3 criteria to Authorization". Do not log trivia, do not repeat the same event within one session, and do not send existing entries back. Entries are stored newest-first, the project keeps the newest 100, and there is no way to edit or delete them. append_activity adds a standalone note; list_activity pages backward with `limit` and `before`.

## Verification and coverage

Read the project test guidelines before proposing verification text, and follow the conventions they describe. Verification belongs to a chapter, never to a criterion.

- `auto`: one full command on a single line, at most 500 characters.
- `human`: plain instructions for a person.
- `ai`: plain instructions for an AI verifier.

Each mode keeps its own text even when it is inactive; preserve that text and change only the mode or the field you need.

Nothing is executed. Verification is a declaration, so never claim that a test ran or passed. If the person has no command yet, use `human` or `ai`; an `auto` mode with an empty command counts as incomplete coverage. Suggest one command per chapter rather than a combined command for the whole project.

Coverage is declaration-based: only eligible non-root chapters with a non-empty auto-test command count as covered. Coverage rows also carry the chapter commits.

This connection cannot create, import, duplicate or activate projects. Deleting the bound project also invalidates this connection. If authentication fails, ask the user to reconnect through the MCP client's Layers authorization flow rather than asking for a token in chat. Exported instructions describe the export format.

Commit references are lowercase 7–40 character hexadecimal hashes and belong to chapters, not criteria. Use only hashes the user supplied or that you verified in the repository; never invent a hash, and never state that a commit verifies or covers a criterion.

Report changes, revision, verification results and unresolved questions. While a planning mode is active, also say which criteria are written, which are still open, and what you need from the user next.

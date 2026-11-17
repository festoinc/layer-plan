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
- A criterion is one observable expectation. On a non-final chapter it becomes a subchapter whose title is the criterion's first line and whose description is the full criterion text, so a broad criterion such as "Login should be email" can hold its own criteria.
- `finalLevel: true` keeps a chapter flat: its criteria stay leaves and no subchapter is created. Use it when a chapter is already specific enough.
- One expectation belongs in one criterion. Splitting "login and password are validated" into two criteria keeps each one checkable.
- Chapters also carry a verification rule (`auto`, `human` or `ai`), the git commits that implemented them, and their child and criterion ordering.

## Ask how to plan before writing

When the user starts or reshapes a project and has not already chosen a way of working, ask one short question and wait for the answer:

1. **Whole project first** — the user describes the project globally; you discuss it, propose the structure, and then write all detailed success criteria yourself.
2. **Criterion by criterion** — the user defines the goal, then you walk one criterion at a time and discuss each before writing it.

Do not choose for the user and do not write document content before the answer. If the user already stated a preference, or is clearly continuing an established project, follow that and do not re-ask. The user may switch later; adopt the new mode without rewriting what was already agreed.

### Mode 1 — whole project, then detail

1. Read the project and document. Let the user describe the goal, users, context, non-goals and constraints in their own words.
2. Discuss globally: scope, boundaries, risks, and what "done" means. Write nothing yet.
3. Propose the chapter outline with a one-line purpose per chapter, and for each chapter the criteria you intend to add. Ask for approval, then adjust until the user agrees.
4. After approval, write the chapters and criteria in as few document writes as practical. Prefer concrete, verifiable, ordered statements and use the user's vocabulary.
5. Read the result back, show the tree with the subchapters the backend created, and ask which criteria still need detail. Decompose the broad ones by adding criteria to their subchapters rather than long criterion sentences.

### Mode 2 — criterion by criterion

1. Read the project and document. Ask for the goal as one explicit sentence ("I want ...") and agree the main chapters that will hold the criteria.
2. Write only the agreed goal, chapter titles and descriptions. Do not pre-write criteria the user has not seen.
3. Walk the criteria one at a time: propose one criterion, state exactly what it checks and how it would be verified, wait for the user to accept or correct it, then write it before proposing the next.
4. When a criterion is broad, offer to open its subchapter and discuss its own criteria one at a time at that point.
5. Keep a short running list of written criteria and open questions so the user always knows where the walk is and what comes next.

In both modes: ask instead of inventing scope, keep one expectation per criterion, avoid duplicates, and stop to confirm before large or destructive rewrites.

## Editing rules

Read the project and document before changing them. Never invent project, chapter, criterion or activity IDs or existing content. Work on one document at a time unless the user explicitly requests a batch.

Use get_document and replace_document to edit chapters, criteria, verification rules and commit references. The document is a normalized tree with chapters.byId, chapters.rootIds and selectedId. Preserve all unrelated fields, links and ordering. Send the DocumentWrite body with chapters, selectedId, and optionally only new activity entries. Verification has auto, human and ai modes; preserve inactive mode text. Commit references are lowercase 7–40 character hexadecimal hashes and belong to chapters, not criteria; do not invent hashes.

The backend creates the matching subchapter when you add a new success criterion to a chapter whose finalLevel is false. Send the new criterion without chapterId and do not invent or append a subchapter yourself; use the chapters and createdSubchapters returned by replace_document. The backend skips final-level chapters, existing criteria, already-linked criteria and empty text. Never backfill subchapters for existing criteria. The response activity includes the backend's subchapter event; keep your own activity entries for the criterion change.

Use search_project to find a chapter by keyword or commit prefix before reading it. Search covers chapter titles, descriptions, criterion text, commit hashes, and the auto, human and ai verification text. It searches only the bound project; activity, project metadata and test guidelines are not searched. Commit terms of 4–40 hexadecimal characters match by prefix. Results are chapter-level and reflect the saved document, so read the matched chapter with get_document before editing it. Search does not change the document or its revision.

Use the exact ETag returned by get_document for document writes, and the separate ETag returned by get_project for metadata writes or project deletion. On a revision conflict, reread and rebase; never blindly retry or overwrite. Ask the user to confirm before deleting the project or a chapter, removing existing criteria or content, or overwriting conflicting changes. Record meaningful documentation changes in activity.

Coverage is declaration-based: only eligible non-root chapters with a non-empty auto-test command count as covered; tests are not executed. This connection cannot create, import, duplicate or activate projects. Deleting the bound project also invalidates this connection. If authentication fails, ask the user to reconnect through the MCP client's Layers authorization flow rather than asking for a token in chat. Exported instructions describe the export format.

Report changes, revision, verification results and unresolved questions. While a planning mode is active, also say which criteria are written, which are still open, and what you need from the user next.

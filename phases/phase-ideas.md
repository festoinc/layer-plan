# Phase ideas — deferred backlog

Status: living document  
Updated: 2026-11-03

Ideas captured while delivering phase 1 and phase 2 that were deliberately left
out, plus a few candidates raised while planning phase 3. They are consolidated
here so they can be reviewed, promoted into a phase, or dropped without
re-reading the delivery notes.

How to use this file:

- Keep the stable `ID` when referring to an idea in a new phase plan.
- Move an idea to **Promoted** when it gets a phase; keep the history line.
- Add new ideas only with a source and a short reason for deferral.

## Product capabilities

### P-01 — Backend, authentication and accounts

**Source:** phase 1 boundaries, phase 2 out of scope.  
**What:** a real server, database, sign-in, user accounts and account
management.  
**Why deferred:** every phase so far is a local-only prototype; the repository
seam exists so an HTTP implementation can replace `localStorage`.  
**Next step:** define the API boundary first (document, activity, project
catalog), then choose an auth provider.

### P-02 — Collaboration, permissions and shared workspaces

**Source:** phase 1 boundaries, phase 2 out of scope.  
**What:** multiple people editing one project, roles, invitations and
permission checks.  
**Why deferred:** needs P-01 and a conflict-resolution model.  
**Next step:** decide the collaboration model (presence plus last-write-wins,
CRDT, or server-sequenced operations) before UI work.

### P-03 — Cross-device sync and cloud backup

**Source:** phase 1 persistence boundary ("data is specific to the browser and
origin; there is no cross-device synchronization").  
**What:** projects available on another browser or device, automatic remote
backup.  
**Why deferred:** depends on P-01; project export/import is the current manual
workaround.  
**Next step:** reuse the project export format as the sync payload.

### P-04 — Server-side activity audit log

**Source:** phase 1 boundaries ("activity is a browser-local change history,
not a server audit log").  
**What:** durable, attributable activity history that survives storage resets
and supports auditing.  
**Why deferred:** no backend or identity yet.  
**Next step:** define the event schema and retention policy.

## Specification editing

### P-05 — Chapter management UI: delete, move, reorder, duplicate

**Source:** phase 1 boundaries, phase 2 out of scope.  
**What:** expose the phase 2 domain operations in the UI: delete a subtree with
confirmation, move a chapter to another parent, reorder siblings and criteria,
duplicate a subtree, and drag-and-drop reordering.  
**Why deferred:** phase 2 delivered and unit-tested `deleteSubtree`,
`moveChapter`, `reorderCriteria`, `moveCriterion` and `duplicateSubtree`, but no
controls.  
**Next step:** add a chapter actions menu and drag handles; reuse the existing
focus and confirmation patterns.

### P-06 — Real test coverage

**Source:** phase 1 boundaries, phase 2 out of scope.  
**What:** replace the placeholder page with real coverage: persist
`Criterion.coverage = { status: "covered" | "partial" | "missing", tests:
[{ id, name, file, lastRun? }] }`, link criteria to automated tests, and compute
project coverage.  
**Why deferred:** the model is documented in phase 2 but not persisted; needs a
test-report ingestion format.  
**Next step:** choose the report format (JUnit XML, JSON) and add a schema
migration for `Criterion.coverage`.

### P-07 — Code block syntax highlighting

**Source:** phase 1 Markdown notes ("syntax highlighting is not implemented").  
**What:** highlight fenced code blocks in descriptions and criteria.  
**Why deferred:** kept the Markdown bundle small in phase 2 (the vendor chunk is
already the largest).  
**Next step:** lazy-load a highlighter only when a code block is rendered and
measure the bundle cost.

### P-08 — Richer project organisation

**Source:** follow-up to phase 3 scoping; intentionally not in the first
multi-project phase.  
**What:** archive or trash projects, undo delete, favorites, tags, manual
ordering, search and filtering in the project list.  
**Why deferred:** phase 3 covers the full create/open/rename/duplicate/delete
cycle; organisation features need usage feedback first.  
**Next step:** collect which controls are actually used before adding more.

## Quality and platform

### P-09 — Full cross-browser and assistive-technology audit

**Source:** phase 1 boundaries, phase 2 out of scope.  
**What:** automated Firefox and WebKit runs, plus manual screen-reader and
keyboard-only passes.  
**Why deferred:** phase 2 automated Chromium only; axe covers WCAG 2.0/2.1 A
and AA checks but not real assistive-technology behaviour.  
**Next step:** extend the Playwright projects matrix and add a manual checklist
to the release gate.

### P-10 — Self-hosted fonts

**Source:** phase 2 out of scope.  
**What:** ship DM Sans and Manrope as local WOFF2 files instead of Google Fonts
links.  
**Why deferred:** preconnect plus `display=swap` removed the blocking import
chain with less delivery work.  
**Next step:** measure whether the external requests actually matter for the
target audience before adding font assets.

### P-11 — Offline-first shell and installable app

**Source:** implied by "local-only workspace"; not attempted in phases 1–3.  
**What:** a service worker that keeps the app usable offline and an installable
PWA manifest.  
**Why deferred:** the app is a local prototype served by Vite; offline support
was not part of the product brief.  
**Next step:** validate the requirement, then cache the app shell and fonts.

## Design explorations

### P-12 — Dashboard cards, detail inspector and test-linking UI

**Source:** phase 1 ("the earlier dashboard cards, detail inspector, and mock
test-linking interface are not part of the current UI").  
**What:** revisit the discarded dashboard/inspector direction if the product
moves from document editing toward a project overview.  
**Why deferred:** the approved design refresh kept the interface focused on the
chapter editor.  
**Next step:** prototype only if a project dashboard becomes a real need; the
phase 3 projects page is the first step in that direction.

## Promoted

| ID | Idea | Promoted to | Date |
| --- | --- | --- | --- |
| — | Multiple local projects with full lifecycle, project-scoped storage, routes and export/import | Phase 3 | 2026-11-03 |

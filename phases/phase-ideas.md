# Phase ideas — deferred backlog

Status: living document  
Updated: 2026-11-17

Ideas captured during phase delivery and planning that were deliberately left
out. They are consolidated here so they can be reviewed, promoted into a phase,
or dropped without re-reading the delivery notes.

How to use this file:

- Keep the stable `ID` when referring to an idea in a new phase plan.
- Remove an idea once its phase is delivered.
- Add new ideas only with a source and a short reason for deferral.

## Product capabilities

### P-02 — Collaboration, permissions and shared workspaces

**Source:** phase 1 boundaries, phase 2 out of scope.

**What:** multiple people editing one project, roles, invitations and
permission checks.

**Why deferred:** identity and private project ownership are delivered in phase
6, but sharing still needs project memberships, roles, per-user selected
chapters and a conflict-resolution model.

**Next step:** decide the collaboration model (presence plus last-write-wins,
CRDT, or server-sequenced operations) before UI work.

### P-03 — Automated backup and restore

**Source:** phase 1 persistence boundary; cross-device access was delivered by
the API cutover in phase 5 and project ownership in phase 6.

**What:** scheduled server-side backups with a retention policy, plus a tested
restore procedure.

**Status:** projects are server-side and available from any browser or device.
Phase 8 documented manual Docker-volume backup and restore; export/import remains
the manual per-project workaround.

**Why deferred:** automatic scheduling needs a backup target and retention
policy, and restore verification belongs on the deployment host rather than in
the app.

**Next step:** choose the backup target (host directory, object storage or
database dump), schedule it, and automate a restore check.

### P-04 — Durable server-side activity audit log

**Source:** phase 1 boundaries ("activity is a browser-local change history,
not a server audit log").

**Status:** phase 5 moved activity to SQLite and phase 6 added actor
attribution. History is still capped at 100 entries per project and exposed only
through the project activity feed.

**What:** durable, attributable history with a retention policy, audit queries
and an expanded event schema.

**Why deferred:** there is no retention policy, audit permission model, export
or expanded event schema yet.

**Next step:** define retention and audit access, then add an audit query/export
surface and an event schema migration.

## Specification editing

### P-05 — Chapter move, reorder and duplicate UI

**Source:** phase 1 boundaries, phase 2 out of scope.  
**Status:** chapter deletion with confirmation and criterion add/remove are
delivered; moving, reordering and duplicating chapters still have no controls.

**What:** expose the remaining domain operations: move a chapter to another
parent, reorder siblings and criteria, duplicate a subtree, and drag-and-drop
reordering.

**Why deferred:** the domain operations exist and are unit-tested, but the
editor has no move/reorder/duplicate affordances.

**Next step:** add a chapter actions menu and drag handles; reuse the existing
focus and confirmation patterns.

### P-06 — Report-based test coverage

**Source:** phase 1 boundaries, phase 2 out of scope.  
**Status:** partially addressed by phase 4, which delivered declaration-based
coverage from Auto-test commands and project test guidelines.
**What remains:** execute Auto-test commands, ingest test reports, persist
last-run status/results and link individual report cases to criteria.
**Why deferred:** phase 4 intentionally stores declarations without running
tests or recording results.
**Next step:** choose the report format (JUnit XML, JSON), define result
retention, and add a schema migration for the result fields.

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

### P-13 — Database driver selection: SQLite and Postgres

**Source:** phase 5 decision to keep SQLite local while preserving a future
Postgres option.  
**What:** a supported Postgres adapter and a way for the user to select SQLite
or Postgres, including migration and backup guidance.  
**Why deferred:** phase 5 is local-only and uses SQLite behind `server/db`;
adding a second driver now would expand the phase beyond the API cutover.  
**Next step:** introduce a Postgres implementation of `ProjectStore` and the
auth store, migrate the schema, and add an explicit configuration screen or
environment switch.

## Quality and platform

### P-20 — Codex MCP write approvals and destructive confirmation

**Source:** phase 9 remote Codex test.

**What:** verify a working Codex approval flow for MCP writes and ensure a
destructive action receives explicit user confirmation before execution.

**Why deferred:** Codex CLI 0.169.0 connected and read projects, but the test
session's `never` approval policy blocked write calls. On a direct deletion
request, Codex attempted the tool without first asking in chat. MCP server
instructions alone do not enforce confirmation.

**Next step:** test an interactive approval-enabled Codex session, verify a
successful document edit and a confirmed deletion of a disposable project,
and document any client-specific requirements or limitations.

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

### P-17 — Password change and recovery

**Source:** phase 6 boundary: the super admin creates accounts, but passwords
cannot be changed, reset or recovered.

**What:** member self-service password change, admin password reset, and a
recovery flow that works without email delivery.

**Status:** phase 11 delivered super-admin self-service password change from the
account page. Members still cannot change their own passwords, and there is no
admin reset or recovery.

**Why the remainder is deferred:** no email provider exists and member password
management needs an admin reset/recovery policy first.

**Next step:** decide whether recovery is local-only (recovery code or CLI) or
requires SMTP, then add the remaining endpoints, UI and session revocation.

### P-18 — Project transfer and user deletion

**Source:** phase 6 boundary: projects are owned by one user and users are only
disabled, not deleted or transferred.

**What:** reassign a project to another user, delete a user, and define what
happens to owned projects.

**Why deferred:** needs explicit ownership-transfer rules and audit retention
decisions.

**Next step:** define transfer and deletion semantics before adding UI.

### P-19 — Per-user selected chapter

**Source:** phase 6 decision to keep `selectedId` in the project document while
projects are private.

**What:** move the selected chapter from the document into per-user state.

**Why deferred:** only one user can access a project in phase 6, so there is no
observable conflict.

**Next step:** deliver with P-02 sharing, where each member needs their own
selection.

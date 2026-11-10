# Layers

A local workspace for project specifications. Create projects, and inside each
project create chapters and nested subchapters. Each chapter has an editable
Markdown description and a success-criteria checklist. Everything is stored
locally in the browser; there is no backend.

## Run

```sh
npm install
npm run dev
```

The sidebar project switcher opens the project menu. **All projects** opens the
projects page where you can create, rename, duplicate, export, import and delete
projects. Each project keeps its own chapters, verification rules, activity,
selected chapter, test coverage and test guidelines.

Inside a project, use the **+** next to a chapter to add a subchapter, or **New
chapter** to create a top-level chapter. Click a chapter to edit its title,
description, and checklist. Descriptions and success criteria support
GitHub-flavored Markdown. Text displays formatted by default; double-click a
description or checklist item to edit its Markdown, or focus it and press
Enter/F2. Press Escape or Ctrl/Cmd+Enter to finish editing.

Adding a success criterion also creates a subchapter under the current chapter
unless **Final level** is checked. Its title comes from the first line of the
criterion. Manually created subchapters do not add checklist items. Press Enter
to add a criterion and Shift+Enter for a new line. Changes save automatically.

### Verification and coverage

Subchapters get a **Verification Rules** section between Description and Success
criteria. Each subchapter has one rule for that page, regardless of how many
criteria it contains. The rule chooses one mode:

- **Auto-test** — one full command such as `npm test login:test-ok`.
- **Human** — plain instructions for a person.
- **AI** — plain instructions for an AI verifier.

Switching modes keeps the text entered for each mode. Root chapters do not show
verification rules and are excluded from coverage.

The **Test coverage** page lists every verification-eligible chapter, but only
Auto-test chapters with a command count as covered. Human and AI chapters are
shown as uncovered context. Each project has a shared **Test guidelines** field
that is editable directly on the coverage page and is included in exports.

Each document header has a delete action. Deleting asks for confirmation and
removes the chapter, every subchapter beneath it, and any success criterion in
its parent that created it.

## Architecture

```text
src/domain/      Pure models: projects, chapters, criteria, verification, schema
src/store/       Catalog and project repositories, React providers, reducer
src/hooks/       Hash router, memoized chapter tree, focus trap
src/components/  Sidebar, project switcher/page/dialogs, tree, editor, banners
src/app/         App shell, per-project workspace shell, error boundaries
src/Markdown.tsx Markdown preview/editor primitives
src/data.ts      Two sample projects
```

- **Project catalog plus per-project documents.** A compact index stores project
  metadata and chapter/criteria counts. Each project has its own normalized
  chapter document `{ byId, rootIds }`, activity history, selected chapter and
  per-chapter verification rules, so editing one project never rewrites another.
- **One reducer per project document.** `src/store/workspaceReducer.ts` owns
  chapters, criteria, activity and selection for the active project. Ephemeral UI
  state (open branch, create form, mobile drawer, project dialogs) stays in
  components.
- **Repository seams.** `src/store/persistence.ts` is the project document
  repository; `src/store/catalogRepository.ts` owns the project index and project
  lifecycle. Components never touch `localStorage`, so an HTTP repository can
  replace these later.
- **Validation and reset.** `src/domain/schema.ts` repairs saved project data
  (missing fields, duplicate ids, dangling links, cycles, orphans, verification
  rules) and validates the catalog. Phase 4 intentionally starts a fresh v5
  database: the first load clears phase 1–3 project keys and seeds refreshed
  **Website project** and **Mobile app** samples with verification examples and
  test guidelines. Unreadable payloads are copied to a backup key before
  recovery.

### Storage

| Key                               | Contents                                       |
| --------------------------------- | ---------------------------------------------- |
| `layers:projects:v5`              | Project index: metadata, order, active id      |
| `layers:project:<id>:doc:v5`      | Normalized chapters, criteria and verification |
| `layers:project:<id>:activity:v5` | Newest-first activity history (max 100)        |
| `layers:project:<id>:ui:v5`       | Selected chapter for one project               |
| `layers:project:<id>:settings:v5` | Shared project test guidelines                 |
| `layers:backup:*`                 | Automatic backups of unreadable payloads       |

The v5 key namespace carries `schemaVersion` 6 payloads. Older criterion-level
verification rules are normalized onto their chapter when loaded.

Phase 1–3 keys (`layers:projects:v4`, `layers:project:*:v4`, `layers:doc:v3`,
`layers:activity:v3`, `layers:ui:v3`, `layers-chapters-v2`,
`layers-chapters-v1`) and orphan project keys are removed on the first phase 4
load. Backups are kept. This reset is intentional; export anything you need from
the old format before upgrading.

Writes are debounced by 250 ms, structural edits are written immediately, and
pending changes are flushed on blur, `pagehide`, `visibilitychange` and unload.
Project index writes use read-merge-write so edits to different projects do not
overwrite each other. Corrupt project data is backed up and reset per project;
corrupt catalog data is backed up and reseeded. **Export project** and **Import
project** move a complete project (metadata, chapters, criteria, verification
rules, test guidelines, activity and selection) as `layers-project` v3 JSON.
Importing always creates a new project; a name collision gets an `(imported)`
suffix. Existing v1/v2 files still import: older criterion-level verification
rules move to the chapter and missing guidelines start empty. A second tab
adopts external writes unless it has unsaved changes in the same project.

### Routes

Hash routing keeps every project and chapter linkable and survives reload:

- `#/projects` — project list
- `#/projects/<projectId>/chapters/<chapterId>` — specifications
- `#/projects/<projectId>/coverage` — automated test coverage
- `#/projects/<projectId>/activity` — project activity

Old `#/chapters/<id>`, `#/coverage` and `#/activity` links redirect to the active
project. Unknown project ids return to the project list; unknown chapter ids fall
back to the first chapter and the URL is rewritten.

## Verify

```sh
npm run lint
npm run format:check
npm run typecheck
npm run test:unit
npm run build
npm run test:e2e          # Chromium, development server
npm run test:prod         # build + smoke test against the preview server
```

`npm test` runs the unit suite and the browser suite. The browser suite covers
the phase 1–3 scenarios plus chapter verification modes, coverage counting,
inline project test guidelines, project switching, project lifecycle, project isolation,
project export/import, project-scoped routing, v5 storage reset and recovery,
cross-tab sync, write failures, accessibility (axe) and focus management. A
production-build smoke test is available with `npm run test:prod`.

## Runtime boundaries

- No server, database, authentication, collaboration, or permissions.
- Test coverage is declaration-based: commands are stored and counted, but they
  are not executed and no results or report ingestion are recorded.
- Chapter deletion is available with confirmation and subtree cleanup. Reordering
  and drag-and-drop remain tested domain operations without UI.
- Import never overwrites or merges into an existing project.
- Data is per browser and origin. Export a project JSON file to move or back it
  up.

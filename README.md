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
projects. Each project keeps its own chapters, activity, selected chapter and
test-coverage placeholder.

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

## Architecture

```text
src/domain/      Pure models: projects, chapters, criteria, activity, schema
src/store/       Catalog and project repositories, React providers, reducer
src/hooks/       Hash router, memoized chapter tree, focus trap
src/components/  Sidebar, project switcher/page/dialogs, tree, editor, banners
src/app/         App shell, per-project workspace shell, error boundaries
src/Markdown.tsx Markdown preview/editor primitives
src/data.ts      Two sample projects
```

- **Project catalog plus per-project documents.** A compact index stores project
  metadata and chapter/criteria counts. Each project has its own normalized
  chapter document `{ byId, rootIds }`, activity history and selected chapter, so
  editing one project never rewrites another.
- **One reducer per project document.** `src/store/workspaceReducer.ts` owns
  chapters, criteria, activity and selection for the active project. Ephemeral UI
  state (open branch, create form, mobile drawer, project dialogs) stays in
  components.
- **Repository seams.** `src/store/persistence.ts` is the project document
  repository; `src/store/catalogRepository.ts` owns the project index and project
  lifecycle. Components never touch `localStorage`, so an HTTP repository can
  replace these later.
- **Validation and reset.** `src/domain/schema.ts` repairs saved project data
  (missing fields, duplicate ids, dangling links, cycles, orphans) and validates
  the catalog. Phase 3 intentionally starts from a clean multi-project catalog:
  the first load clears the phase 1/2 keys and seeds **Website project** and
  **Mobile app**. Unreadable payloads are copied to a backup key before recovery.

### Storage

| Key                               | Contents                                    |
| --------------------------------- | ------------------------------------------- |
| `layers:projects:v4`              | Project index: metadata, order, active id   |
| `layers:project:<id>:doc:v4`      | Normalized chapter document for one project |
| `layers:project:<id>:activity:v4` | Newest-first activity history (max 100)     |
| `layers:project:<id>:ui:v4`       | Selected chapter for one project            |
| `layers:backup:*`                 | Automatic backups of unreadable payloads    |

Phase 1/2 keys (`layers:doc:v3`, `layers:activity:v3`, `layers:ui:v3`,
`layers-chapters-v2`, `layers-chapters-v1`) and orphan project keys are removed
on the first phase 3 load. Backups are kept. This reset is intentional; export
anything you need from the old format before upgrading.

Writes are debounced by 250 ms, structural edits are written immediately, and
pending changes are flushed on blur, `pagehide`, `visibilitychange` and unload.
Project index writes use read-merge-write so edits to different projects do not
overwrite each other. Corrupt project data is backed up and reset per project;
corrupt catalog data is backed up and reseeded. **Export project** and **Import
project** move a complete project (metadata, chapters, criteria, activity and
selection) as `layers-project` JSON. Importing always creates a new project; a
name collision gets an `(imported)` suffix. A second tab adopts external writes
unless it has unsaved changes in the same project.

### Routes

Hash routing keeps every project and chapter linkable and survives reload:

- `#/projects` — project list
- `#/projects/<projectId>/chapters/<chapterId>` — specifications
- `#/projects/<projectId>/coverage` — test coverage placeholder
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
the phase 1/2 scenarios plus project switching, project lifecycle, project
isolation, project export/import, project-scoped routing, storage reset and
recovery, cross-tab sync, write failures, accessibility (axe) and focus
management. A production-build smoke test is available with `npm run test:prod`.

## Runtime boundaries

- No server, database, authentication, collaboration, or permissions.
- Test coverage is a placeholder per project; the page is lazy-loaded and
  reserved for a later phase.
- Chapter deletion, reordering, and drag-and-drop are available as tested domain
  operations but have no UI yet.
- Import never overwrites or merges into an existing project.
- Data is per browser and origin. Export a project JSON file to move or back it
  up.

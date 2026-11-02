# Layers

A workspace for project specifications. Create chapters in the left sidebar and
nest subchapters at any depth. Each chapter has an editable Markdown description
and a success-criteria checklist. Everything is stored locally in the browser;
there is no backend.

## Run

```sh
npm install
npm run dev
```

Use the **+** next to a chapter to add a subchapter, or **New chapter** to create
a top-level chapter. Click a chapter to edit its title, description, and
checklist. Descriptions and success criteria support GitHub-flavored Markdown.
Text displays formatted by default; double-click a description or checklist item
to edit its Markdown, or focus it and press Enter/F2. Press Escape or
Ctrl/Cmd+Enter to finish editing.

Adding a success criterion also creates a subchapter under the current chapter
unless **Final level** is checked. Its title comes from the first line of the
criterion. Manually created subchapters do not add checklist items. Press Enter
to add a criterion and Shift+Enter for a new line. Changes save automatically.

## Architecture

```text
src/domain/      Pure document model: chapters, criteria, activity, schema
src/store/       Reducer, React provider, persistence/repository layer
src/hooks/       Hash router, memoized chapter tree, focus trap
src/components/  Sidebar, tree, editor, activity, coverage, banners
src/app/         App shell and error boundaries
src/Markdown.tsx Markdown preview/editor primitives
src/data.ts      Sample chapter content
```

- **Normalized document.** `{ byId, rootIds }` with `childIds` and `parentId`.
  Lookups are O(1) and unrelated chapters keep object identity, so sidebar rows
  are memoized and typing does not re-render the whole tree.
- **One reducer for document state.** `src/store/workspaceReducer.ts` owns
  chapters, criteria, activity and selection. Ephemeral UI state (open branch,
  create form, mobile drawer) stays in components.
- **Repository seam.** `src/store/persistence.ts` exposes `load`, `save`,
  `flush`, `subscribe` and status. Components never touch `localStorage`, so an
  HTTP repository can replace it later.
- **Validation and migration.** `src/domain/schema.ts` repairs saved data
  (missing fields, duplicate ids, dangling links, cycles, orphans) and migrates
  the phase 1 nested payload. Unreadable payloads are copied to a backup key
  before a fresh workspace is shown.

### Storage

| Key                  | Contents                                             |
| -------------------- | ---------------------------------------------------- |
| `layers:doc:v3`      | Project metadata and the normalized chapter document |
| `layers:activity:v3` | Newest-first activity history (max 100)              |
| `layers:ui:v3`       | Selected chapter                                     |
| `layers:backup:*`    | Automatic backups of unreadable payloads             |

Writes are debounced by 250 ms, structural edits are written immediately, and
pending changes are flushed on blur, `pagehide`, `visibilitychange` and unload.
Corrupt data is never overwritten before it is backed up. **Export workspace**
and **Import workspace** in the sidebar move the full workspace as JSON. A
second tab adopts external writes unless it has unsaved local changes.

### Routes

Hash routing keeps every chapter linkable and survives reload:

- `#/chapters/<id>` — specifications
- `#/coverage` — test coverage placeholder
- `#/activity` — activity history

Unknown chapter ids fall back to the first chapter and the URL is rewritten.

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
the phase 1 scenarios plus routing, storage migration, corrupt-data recovery,
export/import, cross-tab sync, write failures, accessibility (axe) and focus
management. A production-build smoke test is available with `npm run test:prod`.

## Runtime boundaries

- No server, database, authentication, collaboration, or permissions.
- Test coverage is a placeholder; the page is lazy-loaded and reserved for the
  next phase.
- Chapter deletion, reordering, and drag-and-drop are available as tested domain
  operations but have no UI yet.
- Data is per browser and origin. Export a JSON file to move or back it up.

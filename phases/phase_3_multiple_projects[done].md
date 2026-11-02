# Phase 3 — Multiple projects

Status: delivered  
Date: 2026-11-03

## Goal

Turn Layers from a single local workspace into a local project workspace: create,
open, rename, duplicate, export, import and delete projects, with each project
owning its chapter tree, success criteria, activity history and selection.

Phase 3 stays local-only. It replaces the phase 2 single-project storage model
with a project catalog plus per-project storage, adds project-scoped routes and
seeds two mock projects for demonstration. It does not add a backend, accounts,
collaboration or permissions.

Phase 2 carried-forward ideas (chapter delete/reorder UI, real test coverage,
cross-browser audit) move to [phase-ideas.md](phase-ideas.md) and are not part of
this phase.

## Locked decisions

| Topic | Decision |
| --- | --- |
| Hosting | Local browser only; no backend, auth, sharing or permissions |
| Storage | Per-project keys plus a compact project index (option B) |
| Project limit | 9,999 projects |
| Project fields | name, initials, colour, description, createdAt, updatedAt |
| Scoped data | Chapters, criteria, activity, selected chapter and coverage placeholder are per project |
| Routes | Project id in the URL |
| Navigation | Sidebar project switcher plus a `#/projects` page |
| Lifecycle | Create, open, rename/edit, duplicate, export, import, delete |
| Existing data | Intentionally discarded on first phase 3 load; seed **Website project** and **Mobile app** |
| Export/import | Per project; the export contains every layer of that project |
| Quality gate | Same as phase 2, plus new unit and browser scenarios |
| Visual language | Reuse existing tokens, typography, cards, menus and dialogs |

### Derived choices to review

These follow from the answers above but were not stated explicitly; change them
before implementation if they are wrong.

- Import always creates a new project; there is no replace or merge flow.
- Export is per project; there is no all-projects archive in this phase.
- Duplicating a project copies content and selection, but starts a fresh activity
  history.
- A new project starts with one “Overview” chapter so the editor is immediately
  usable.
- Deleting the last project is allowed and shows the empty projects page.
- Project metadata lives in the catalog index; per-project payloads contain only
  `projectId` plus document, activity and selection data.
- Activity is per project; there is no global feed.

## Prerequisite

The working tree currently contains an uncommitted TypeScript conversion
(`App.tsx`, `Sidebar.tsx`, `persistence.ts`, and so on). Land and verify that
conversion before starting phase 3; this plan assumes the TypeScript sources.

## 1. Domain model

Add `src/domain/projects.ts` for project metadata, summaries, limits and
summarisation. Keep chapter/criterion operations in their existing modules.

```ts
export const MAX_PROJECTS = 9999;

export type ProjectColor =
  | "indigo"
  | "teal"
  | "amber"
  | "rose"
  | "violet"
  | "emerald"
  | "sky"
  | "slate";

export interface Project {
  id: string; // URL-safe, 1-64 chars of [a-zA-Z0-9_-]
  name: string; // trimmed, max 80 chars
  initials: string; // 1-2 uppercase letters/digits
  color: ProjectColor;
  description: string; // trimmed, max 280 chars
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
}

export interface ProjectSummary extends Project {
  chapterCount: number;
  criterionCount: number;
  checkedCount: number;
}

export interface ProjectIndex {
  schemaVersion: number;
  activeProjectId: string | null;
  projectIds: string[];
  projects: Record<string, ProjectSummary>;
}
```

`Workspace` becomes strictly project-scoped. Project metadata moves out of the
document payload and into the catalog index:

```ts
export interface Workspace {
  schemaVersion: number;
  projectId: string;
  chapters: ChapterDocument;
  events: ActivityEntry[];
  selectedId: string | null;
}
```

Functions in `src/domain/projects.ts`:

- `createProjectRecord(input, { id, now })` — factory with defaults.
- `normalizeProject(raw, { id, now })` — repair metadata; derive initials;
  whitelist colours; clamp lengths; validate timestamps.
- `deriveInitials(name)` — first letters of up to two words, fallback `"P"`.
- `isSafeProjectId(id)` — guards storage keys and URLs.
- `summarizeDocument(document)` — `chapterCount`, `criterionCount`,
  `checkedCount` in one pre-order walk.
- `sortProjects(summaries, activeId)` — active first, then `updatedAt` descending.
- `MAX_PROJECTS` — 9,999; enforced by create, duplicate and import.

`SCHEMA_VERSION` becomes `4` for the catalog index and every per-project
payload.

## 2. Storage model

Replace the three fixed phase 2 keys with a catalog plus per-project keys.

| Key | Contents |
| --- | --- |
| `layers:projects:v4` | Catalog index: active id, order, project metadata and stats |
| `layers:project:<id>:doc:v4` | `{ schemaVersion, projectId, chapters }` |
| `layers:project:<id>:activity:v4` | `{ schemaVersion, projectId, events }` |
| `layers:project:<id>:ui:v4` | `{ schemaVersion, projectId, selectedId }` |
| `layers:backup:*` | Unchanged: automatic copies of unreadable payloads |

Catalog index example:

```json
{
  "schemaVersion": 4,
  "activeProjectId": "website",
  "projectIds": ["website", "mobile"],
  "projects": {
    "website": {
      "id": "website",
      "name": "Website project",
      "initials": "W",
      "color": "indigo",
      "description": "Customer-facing website and account flows.",
      "createdAt": "2026-11-03T09:00:00.000Z",
      "updatedAt": "2026-11-03T09:00:00.000Z",
      "chapterCount": 6,
      "criterionCount": 12,
      "checkedCount": 1
    }
  }
}
```

Rules:

- Project ids are generated with `createId()` for new, duplicated and imported
  projects. The two seeded projects use stable ids `website` and `mobile`.
- A project id is never reused. Delete removes the index entry and the three
  project keys.
- Stats are denormalised into the index so the project list does not read every
  project document. They are recomputed on each document flush and repaired when
  a project is opened.
- `updatedAt` changes when project metadata or the chapter document changes, not
  when the selected chapter or activity changes.
- Index writes are read-merge-write: read the stored index, change only the
  affected project entry, write it back. This reduces cross-tab clobbering when
  two tabs edit different projects.
- If the project document is written but the index update fails, the project
  data is safe. The catalog reports a warning and retries on the next flush.

### One-time reset and seed

Phase 3 is allowed to discard the mock phase 1/2 data. On catalog load:

1. If `layers:projects:v4` is missing, perform a one-time reset.
2. Remove `layers:doc:v3`, `layers:activity:v3`, `layers:ui:v3`,
   `layers-chapters-v2`, `layers-chapters-v1` and any orphan
   `layers:project:*` keys.
3. Keep `layers:backup:*` copies.
4. Seed two projects and write the index plus their payloads synchronously.
5. Show an informational banner: “Multi-project storage initialised. Previous
   single-project data was cleared.”

If the index exists but is unreadable, back it up to
`layers:backup:projects-v4:<timestamp>`, then seed the same two projects and show
the same notice. If an individual project document is unreadable, back it up,
replace only that project’s document with an empty one and keep the project in
the catalog.

No migration from v3 is implemented. The README will state that phase 3 starts
from a clean local catalog.

### Seed data

Move the sample workspace into `src/data.ts` as a list:

```ts
export const sampleProjects: SampleProject[] = [
  {
    project: {
      id: "website",
      name: "Website project",
      initials: "W",
      color: "indigo",
      description: "Customer-facing website and account flows.",
    },
    chapters: initialChapters,
    selectedId: "password-reset",
  },
  {
    project: {
      id: "mobile",
      name: "Mobile app",
      initials: "M",
      color: "teal",
      description: "Mobile onboarding, notifications and offline behaviour.",
    },
    chapters: initialMobileChapters,
    selectedId: "mobile-onboarding",
  },
];
```

The Website tree keeps its phase 1 ids (`authentication`, `login`,
`password-reset`, and so on) so existing chapter assertions remain meaningful.
The Mobile tree is new and deliberately different so switching is visible:

```text
Mobile app
├── Onboarding
│   ├── Welcome screens
│   └── Permission prompts
├── Push notifications
│   ├── Opt-in flow
│   └── Delivery rules
└── Offline mode
    ├── Cache policy
    └── Sync conflicts
```

## 3. Repositories

Split the phase 2 repository into a catalog repository and a project repository.
Both keep the existing `load`, `save`, `flush`, `status`, `onStatusChange`,
`subscribe`, `handleStorageEvent`, `hasPending` and `dispose` conventions where
they apply.

### `src/store/catalogRepository.ts`

Owns the index and project lifecycle. It creates a project repository on demand;
the workspace provider owns that repository and disposes it on unmount, so only
the active project has storage listeners.

```ts
createCatalogRepository({ storage?, now?, newId?, debounceMs?, windowObject? })
```

| Method | Behaviour |
| --- | --- |
| `load()` | Seed/reset when needed; return `{ index, notices }` |
| `listProjects()` | `ProjectSummary[]`, active first then `updatedAt` descending |
| `getProject(id)` | Summary or `null` |
| `setActiveProject(id)` | Persist `activeProjectId`; never navigates other tabs |
| `createProject(input)` | New id, empty/one-chapter document, one activity entry |
| `updateProject(id, patch)` | Name, initials, colour, description; `updatedAt` |
| `duplicateProject(id)` | Copy chapters/criteria/selection, reset activity, new name |
| `deleteProject(id)` | Remove index entry and project keys; return next active id |
| `importProject(text)` | Parse and create a new project; never overwrite |
| `exportProject(id, workspace?)` | Full project payload; flush first |
| `createProjectRepository(id)` | New project repository wired to the catalog summary callback |
| `subscribe(listener)` | Catalog changes from this tab or other tabs |
| `status()` / `onStatusChange` | Index read/write health for banners |

All mutations enforce `MAX_PROJECTS`. Creating, duplicating or importing at the
limit returns a typed error; editing and deleting existing projects still work.

### `src/store/persistence.ts` → project repository

Keep the phase 2 write logic, parameterised by project:

```ts
createProjectRepository({
  projectId,
  storage?,
  debounceMs = 250,
  now?,
  newId?,
  onFlush?, // catalog summary update
})
```

- Keys are built with `projectKeys(projectId)` and validated with
  `isSafeProjectId`.
- Document, activity and UI slices keep reference-diff writing so switching
  chapters does not rewrite the document.
- Debounce, immediate structural writes, flush on blur/`pagehide`/
  `beforeunload`/`visibilitychange` and cross-tab adoption stay as delivered in
  phase 2.
- `load()` repairs missing fields, duplicate ids, dangling criterion links,
  cycles and orphans through the existing normalization code.
- A missing document starts an empty document for that project. A corrupt
  document is backed up, replaced with an empty document and reported.
- `onFlush(workspace, changedSlices)` updates the catalog when the document
  changed; selection-only changes do not touch the index.

`readRawBackup` already scans every `layers` key and will include all projects by
default.

## 4. Providers

`main.tsx` mounts a catalog provider above the app. The workspace provider is
mounted per project with a `key`, so switching projects flushes and remounts
cleanly.

```tsx
<ErrorBoundary>
  <ProjectsProvider>
    <App />
  </ProjectsProvider>
</ErrorBoundary>
```

```tsx
// App.tsx
const catalog = useProjects();
const route = useRoute();
const projectId = resolveProjectId(route, catalog);

if (!projectId) return <ProjectsView standalone />;

return (
  <WorkspaceProvider key={projectId} projectId={projectId} catalog={catalog}>
    <WorkspaceShell projectId={projectId} />
  </WorkspaceProvider>
);
```

`WorkspaceShell` is today’s `App` body: sidebar, topbar, banner, editor, activity
and coverage. It also renders `ProjectsView` when `view === "projects"`.

`ProjectsProvider` exposes:

- `projects`, `activeProjectId`, `notices`, `catalogStatus`;
- `createProject`, `updateProject`, `duplicateProject`, `deleteProject`;
- `importProject`, `exportProject`, `setActiveProject`;
- `createProjectRepository(id)`, `dismissNotices`, `retryCatalog`.

Switching flow:

1. The switcher or projects page navigates to the target project route.
2. React unmounts the old workspace provider, whose cleanup flushes pending
   writes and disposes its project repository.
3. The new provider creates a project repository, loads the target project and
   restores its selected chapter.
4. The catalog persists `activeProjectId`.

Deleting the active project must call `flushSave()` **before**
`deleteProject(id)`, otherwise the provider cleanup could recreate the deleted
keys. The plan reserves an explicit `deleteActiveProject` handler in
`WorkspaceShell` for this ordering.

## 5. Routing

Extend `useRoute` with `projectId`, `projects` view and a `legacy` flag.

| Hash | Meaning |
| --- | --- |
| `#/projects` | Project list |
| `#/projects/<projectId>` | Specifications, default selected chapter |
| `#/projects/<projectId>/chapters` | Specifications, no chapter selected |
| `#/projects/<projectId>/chapters/<chapterId>` | Specifications for one chapter |
| `#/projects/<projectId>/coverage` | Test coverage for the project |
| `#/projects/<projectId>/activity` | Activity for the project |
| `#/chapters/<id>`, `#/coverage`, `#/activity`, empty hash | Legacy: redirect to the active project |

`parseRoute` returns `{ view, projectId, chapterId, legacy, valid }`.
`routeToHash` encodes project and chapter ids. Project ids are limited to safe
characters, so encoding is defensive rather than required.

Canonicalisation rules, applied in `WorkspaceShell`:

1. No projects: `#/projects` and the empty projects screen.
2. Legacy or project-less hash: replace with the same view under the active
   project, then continue.
3. Unknown project id: replace with `#/projects`.
4. Project root or `/chapters` with no id: once loaded, replace with the
   project’s selected/default chapter; if the project has no chapters, keep
   `/chapters` and show the editor’s empty state.
5. Unknown chapter id: replace with the first usable chapter.
6. Every successful resolution updates `activeProjectId` in the index.

Browser back/forward continues to work because all state that matters for
navigation is in the hash.

## 6. UI

### Project switcher

Replace the static sidebar project block with a button that opens a project menu.

- Trigger: colour avatar with initials, project name, “Project specification”
  subtitle, chevron. `aria-haspopup="menu"`, `aria-expanded`, accessible name
  “Switch project: <name>”.
- Menu: active project first, then others by `updatedAt`; each row shows avatar,
  name, chapter count and a check for the active project. Bottom items: **All
  projects** and **New project**.
- Keyboard: Arrow Up/Down, Home/End, Enter/Space, Escape. Focus returns to the
  trigger on close. Close on outside click and on route change.
- Selecting a project closes the mobile drawer and navigates to that project.

### Projects page

New lazy-loaded `ProjectsView` at `#/projects`. Reuse the existing card, button
and typography tokens; no new visual language.

- Header: “Projects”, “2 of 9,999 local projects”, primary **New project**.
- Cards sorted active first, then `updatedAt` descending. Each card shows
  avatar/initials, name, description, “N chapters · M criteria · C/M done”, a
  progress bar, relative “Updated …” text and a `…` actions menu.
- Card actions: Open, Rename, Duplicate, Export, Delete.
- Empty state: “No projects yet”, **Create project**, **Import project**.
- Limit state: create/duplicate/import disabled with “Project limit reached
  (9,999)”.
- The sidebar keeps the active project’s chapters visible while the projects page
  is open; selecting a chapter returns to that project’s specifications.

### Dialogs

- **Project dialog** (create and edit): name (required), initials (auto-derived
  from name, editable, 1–2 characters), colour swatches, description (optional,
  280 characters), Save/Cancel. Inline validation; focus trap; Escape cancels.
- **Delete dialog**: names the project, shows chapter/criteria counts, explains
  that activity is removed, offers **Export first**, **Cancel** and **Delete**.
  **Export first** downloads a copy and leaves the dialog open. Focus returns to
  the opener.
- **Import result**: success notice with the imported project name, or an alert
  with the parse/repair issues.

### Sidebar and topbar

- Sidebar tools become **Export project** and **Import project**; the phase 2
  workspace-level labels are removed.
- Add a **Projects** navigation row (grid icon) above Specifications so the
  projects page is reachable from the main navigation.
- Topbar breadcrumb becomes `<project name> › <view or root chapter>`. For the
  projects page it reads `<project name> › Projects`.
- Save status remains per active project; the sidebar footer label stays
  “Saved locally”.
- The Test coverage **Soon** badge and placeholder remain, now scoped to the
  active project.

### Project lifecycle semantics

| Action | Behaviour |
| --- | --- |
| Create | New id, name/initials/colour/description, empty document with one root chapter “Overview”, activity entry “Created project”, becomes active |
| Rename/edit | Metadata only; document untouched; `updatedAt` and that project’s activity record the change |
| Duplicate | New id and name “<name> copy”; copies chapters, criteria, `finalLevel`, checked states and selected chapter; activity resets to “Duplicated from <name>”; opens the copy |
| Export | Flushes pending writes, then downloads the full project payload |
| Import | Always creates a new project; name collisions get “ (imported)”, then “ (imported 2)”; opens it |
| Delete | Confirmation, flush active project first, remove index entry and keys; choose the next project or show the empty projects page |
| Switch | Navigate, flush the old project, restore the target’s selected chapter, keep the current view when it exists |
| Limit | 9,999 projects; block create/duplicate/import with a clear message |

Deleting the last project is allowed and lands on the empty projects page. A
document with no chapters is allowed and shows the existing “No chapters yet”
empty state.

## 7. Export/import format

Project exports are self-contained and round-trip through import. Proposed
`layers-project` format, version 1:

```json
{
  "format": "layers-project",
  "formatVersion": 1,
  "exportedAt": "2026-11-03T12:00:00.000Z",
  "project": {
    "id": "website",
    "name": "Website project",
    "initials": "W",
    "color": "indigo",
    "description": "Customer-facing website and account flows.",
    "createdAt": "2026-11-03T09:00:00.000Z",
    "updatedAt": "2026-11-03T11:30:00.000Z"
  },
  "chapters": {
    "byId": {},
    "rootIds": []
  },
  "activity": [],
  "ui": {
    "selectedId": "password-reset"
  }
}
```

Contents:

- Project metadata (the exported `id` is informational; import always generates
  a new id).
- The complete normalized chapter document, including criteria, `finalLevel` and
  criterion-to-subchapter links.
- The full activity history for that project.
- The selected chapter, validated on import.

Filename: `layers-<slug>-<YYYY-MM-DD>.json`.

Import accepts:

1. `layers-project` v1.
2. Phase 2 workspace exports (`schemaVersion` 3 with `project`, `chapters`,
   `events`, `selectedId`); `account` maps to initials.
3. Phase 1 nested exports or bare `{ chapters: [...] }` payloads through the
   existing normalizer.

Import rules:

- Never overwrite or merge into an existing project. Always create a new one.
- Preserve valid `createdAt`/`updatedAt` from the file; use now when missing.
- Preserve chapter and criterion ids inside the new project; repair links and
  cycles with the existing normalizer.
- Reject files with no usable chapters; report repairs.
- Enforce the 9,999-project limit before writing anything.
- The imported project becomes active and opens on its specifications page.

## 8. Cross-tab, status and resilience

- Catalog index changes propagate through the `storage` event; the project list
  and switcher update in other tabs. Tabs do not navigate automatically.
- Only the active project’s document repository subscribes to its keys. Edits to
  inactive projects are picked up when they are opened.
- If the active project is deleted in another tab, the catalog update redirects
  this tab to the next project or `#/projects`.
- A tab with pending changes still does not adopt external writes for the same
  project, preserving the phase 2 rule.
- Switching, exporting, deleting and unloading all flush pending writes.
- Quota or private-mode failures are isolated per project: one project’s failed
  write leaves other projects usable. Index update failures show a catalog
  warning with retry.
- Corrupt project data recovers that project only; corrupt catalog data follows
  the approved reset-and-seed path and keeps a backup.
- Error screens keep offering the raw `layers*` backup download, which now
  includes every project.

## 9. Files

New:

```text
src/domain/projects.ts
src/store/catalogRepository.ts
src/store/ProjectsProvider.tsx
src/components/ProjectSwitcher.tsx
src/components/ProjectsView.tsx
src/components/ProjectCard.tsx
src/components/ProjectActionsMenu.tsx
src/components/ProjectDialog.tsx
src/components/DeleteProjectDialog.tsx
```

Modified:

```text
src/domain/schema.ts                  v4 workspace and index normalization
src/domain/chapters.ts                unchanged API, used by summariser
src/data.ts                           two sample projects
src/store/persistence.ts              parameterised project repository
src/store/WorkspaceProvider.tsx        projectId, no project metadata
src/store/workspaceReducer.ts          Workspace shape only
src/hooks/useRoute.ts                  project-aware routes
src/app/App.tsx                        catalog/workspace split, canonicalisation
src/main.tsx                           ProjectsProvider mount
src/components/Sidebar.tsx             switcher, projects nav, project tools
src/components/Topbar.tsx              project breadcrumb and projects label
src/components/StorageBanner.tsx       combined catalog/project notices
src/styles.css                         switcher, cards, dialogs, empty state
README.md                              storage, routes, reset warning, lifecycle
```

## 10. Test plan

### Unit (Vitest)

- `projects.test.js`: initials derivation, metadata normalization, colour
  whitelist, length limits, safe ids, summary stats, sort order, 9,999 cap.
- `schema.test.js`: v4 workspace shape, index normalization and repair,
  duplicate/missing project ids, active fallback, per-project payload validation,
  no v3 migration, seed integrity.
- `catalogRepository.test.js`: first-load reset removes legacy keys and seeds two
  projects; create/rename/duplicate/delete; delete active chooses the next;
  delete last empties the catalog; max limit; import/export round-trip; legacy
  import; duplicate names; corrupt index backup; corrupt/missing project data;
  read-merge-write; cross-tab index events; quota failures.
- `persistence.test.js`: project-scoped keys; slice diffing; debounce/flush;
  pending status; cross-tab per project; corrupt document recovery; index
  callback only on document changes.
- `routes.test.js` (new): every project-scoped pattern, legacy patterns,
  encoding, invalid hashes, `routeToHash` round-trip.
- Existing chapter, criteria and reducer suites remain green with the workspace
  shape change.

### Browser (Playwright, Chromium)

1. Two seeded projects appear; switching changes the tree, URL and chapter;
   reload restores the last active project and selected chapter.
2. Full lifecycle: create project, add a chapter, edit metadata, duplicate,
   verify the copy is independent, delete with confirmation, empty state after
   deleting the last project, create again.
3. Isolation: edits, activity history and selection in one project do not leak
   into the other; old activity links still resolve within the project.
4. Export/import: export a project, delete it, import the file, compare metadata,
   chapters, criteria, activity and selection; import a phase 2 workspace export;
   import a duplicate name and verify the suffix.
5. Deep links: project root, chapter, coverage and activity hashes; legacy
   `#/chapters/<id>` redirects to the active project; unknown project redirects
   to `#/projects`; back/forward works.
6. Cross-tab: two tabs on different projects edit independently; the switcher
   list updates; deleting the active project in one tab redirects the other.
7. Storage recovery: corrupt one project document and verify only that project
   resets; verify the reset notice and legacy-key removal; simulate quota failure
   for one project.
8. Projects page and switcher accessibility: axe, keyboard menu navigation,
   dialog focus trap and Escape, focus return, destructive-action labelling.
9. Existing phase 1/2 suites updated for per-project keys, project routes and
   project export/import selectors.

Add a small Playwright storage helper to seed the catalog and project keys
instead of repeating JSON in each spec.

### Quality gate

Same commands as phase 2:

```sh
npm run lint
npm run format:check
npm run typecheck
npm run test:unit
npm run build
npm run test:e2e
npm run test:prod
```

CI runs the same list. The browser suite remains Chromium-only; the cross-browser
audit stays in [phase-ideas.md](phase-ideas.md).

## 11. Delivery sequence

1. Land the in-progress TypeScript conversion.
2. Domain: `projects.ts`, schema v4, two sample projects, unit tests.
3. Storage: catalog and project repositories, reset/seed, migration-free load,
   repository tests.
4. Providers and routes: `ProjectsProvider`, per-project workspace mount,
   project-aware routing and canonicalisation.
5. UI: switcher, projects page, cards, create/edit/duplicate/delete dialogs,
   sidebar/topbar updates, empty and limit states.
6. Export/import: project format, legacy import, round-trip tests.
7. Browser suites, accessibility pass, README and phase notes.
8. Run the full quality gate and record results in the delivered phase document.

## 12. Acceptance criteria

- [ ] First load after phase 3 clears the phase 1/2 mock workspace keys, keeps
      backups, and seeds exactly two projects: Website project and Mobile app.
- [ ] The project switcher and `#/projects` list show both projects and expose
      create, open, rename, duplicate, export, import and delete.
- [ ] Every route contains the project id; reload, back/forward and legacy links
      resolve predictably.
- [ ] Chapters, criteria, activity and selection are isolated per project.
- [ ] Switching flushes pending writes and restores the target project’s last
      selected chapter; the current view is kept when available.
- [ ] Deleting the active or last project lands on a usable next project or the
      empty projects page, with no resurrected storage keys.
- [ ] Export downloads a complete project payload; importing that file creates an
      independent project with the same chapters, criteria, activity and
      selection.
- [ ] Phase 2 exports and legacy nested chapter files still import.
- [ ] 9,999-project cap is enforced by unit tests and surfaced in the UI.
- [ ] Corrupt project data recovers that project only; corrupt catalog data is
      backed up and reseeded.
- [ ] Axe passes on the projects page, switcher menu and dialogs; keyboard and
      focus behaviour is covered by browser tests.
- [ ] The full quality gate is green and the README documents the destructive
      reset, storage keys, routes and project lifecycle.

## 13. Deliberate behaviour changes

- The phase 1/2 local workspace is intentionally discarded on first phase 3 load;
  two mock projects replace it. No v3 migration is offered.
- The URL is project-scoped. Old `#/chapters/<id>`, `#/coverage` and
  `#/activity` hashes redirect to the active project.
- **Export workspace** / **Import workspace** become **Export project** /
  **Import project**. There is no all-projects archive in this phase.
- Project changes are recorded in that project’s activity history; activity is
  no longer global.
- Project metadata is stored in the catalog index, not in the document payload.
- A new project starts with one “Overview” chapter instead of an empty document.
- Duplicating a project copies content and selection but starts a fresh activity
  history.
- Deleting the last project is allowed and shows the empty projects page.
- The sidebar gains a Projects navigation row and a project switcher; the static
  project label is gone.

## 14. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Destructive reset surprises someone with real data | Explicit product-owner approval, prominent README warning, backups kept, notice after reset |
| 9,999 projects exceed the `localStorage` quota before the cap | The cap is a guard, not a capacity promise; summary entries are compact; quota failures are isolated and surfaced per project |
| Two tabs write the index concurrently | Read-merge-write for single-project updates; last-write-wins accepted for simultaneous structural changes on different projects; cross-tab tests cover the common case |
| Provider cleanup recreates a deleted project | Flush before delete; delete removes keys only after the flush; browser test covers deletion of the active project |
| Route refactor regresses deep links | Unit tests for every parse/format pair plus browser tests for reload, legacy redirects and back/forward |
| Active project differs between tabs | Active project is per tab via the URL; the index stores only the default for new tabs |
| Duplicate project activity is confusing | Duplicate starts fresh history with a single “Duplicated from …” entry; documented |
| Existing tests hard-code v3 keys and flat routes | Plan explicitly updates the storage, routing, persistence, workspace and smoke suites |

## 15. Delivery notes

Implemented as planned, with the following concrete details:

- `SCHEMA_VERSION` is `4`; the catalog key is `layers:projects:v4` and project
  payloads use `layers:project:<id>:doc|activity|ui:v4`.
- The first load clears the phase 1/2 keys and orphan project keys, keeps
  `layers:backup:*`, and seeds **Website project** (`website`) and **Mobile app**
  (`mobile`).
- `src/domain/projects.ts` owns project metadata, initials, colours, the 9,999
  cap and document summarisation. `src/domain/schema.ts` owns workspace/index
  normalization and the `layers-project` export format.
- `src/store/catalogRepository.ts` owns the catalog; `src/store/persistence.ts`
  is the per-project document repository; `src/store/ProjectsProvider.tsx` exposes
  the catalog; `src/store/WorkspaceProvider.tsx` mounts one project repository per
  active project and disposes it on unmount.
- `src/app/WorkspaceShell.tsx` keeps the editor shell and canonicalises
  project-scoped URLs. Legacy hashes redirect to the active project.
- The sidebar gained a project switcher, a Projects navigation row and
  project-scoped export/import. The lazy-loaded projects page, project cards,
  create/edit dialog and delete dialog reuse the existing visual tokens.
- New projects start with one `Overview` chapter. Duplicates copy chapters,
  criteria, checked states and selection but start a fresh activity history.
  Imports always create a new project and use an `(imported)` name suffix on
  collision.
- Tests were expanded to 79 unit tests across 7 files and 26 Chromium browser
  tests, including project switching, lifecycle, isolation, cross-tab catalog
  updates, legacy reset, corrupt project recovery, project export/import,
  project-scoped routing and axe checks on the projects page, switcher and
  dialogs.

### Verification

Run on 2026-11-03:

```sh
npm run lint          # clean
npm run format:check  # clean
npm run typecheck     # clean
npm run test:unit     # 79 passed (7 files)
npm run build         # succeeded
npm run test:e2e      # 26 passed (Chromium)
npm run test:prod     # 1 passed (production preview)
```

Production build (gzip): app 22.1 kB, React 69.0 kB, Markdown vendor 50.6 kB,
icons 1.9 kB, projects page 2.0 kB (lazy), activity 0.7 kB (lazy), coverage
0.4 kB (lazy), CSS 6.8 kB.

## 16. Out of scope

Moved to [phase-ideas.md](phase-ideas.md):

- real backend, authentication, accounts, collaboration and permissions;
- cross-device sync and server-side audit history;
- chapter delete/move/reorder/duplicate UI and drag-and-drop;
- real test-coverage computation and `Criterion.coverage` persistence;
- cross-browser and assistive-technology audit;
- self-hosted fonts, offline/PWA support;
- archived/trashed projects, undo delete, favourites, tags, search, manual
  ordering and project merging.

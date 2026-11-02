# Phase 2 — Architecture hardening

Status: delivered  
Date: 2026-10-28

## Goal

Phase 1 delivered a working clickable mockup with all behaviour in one 646-line
component. Phase 2 keeps the product behaviour and the visuals while replacing
the implementation with a structure that can carry the next product phases (test
coverage, real storage, projects, collaboration).

No product feature was removed. Deliberate behaviour changes are listed at the
end.

## 1. Decomposed the `App` monolith

The single `App` component held ten `useState` hooks, the whole chapter tree, all
three workspace pages and the layout. Business rules were untestable because
they lived inside JSX handlers.

Delivered structure:

```text
src/app/            App.jsx, ErrorBoundary.jsx
src/store/          workspaceReducer.js, WorkspaceProvider.jsx, persistence.js
src/domain/         chapters.js, criteria.js, activity.js, schema.js
src/hooks/          useRoute.js, useChapterTree.js, useFocusTrap.js
src/components/     Sidebar.jsx, ChapterTree.jsx, ChapterNode.jsx,
                    ChapterForm.jsx, ChapterEditor.jsx, Topbar.jsx,
                    ActivityView.jsx, TestCoverageView.jsx, StorageBanner.jsx,
                    SkipLink.jsx
src/Markdown.jsx    Markdown editor/preview primitives (unchanged API)
src/data.js         Sample content only
```

Rules applied:

- Document state lives in one reducer; ephemeral UI state (`navOpen`,
  `creating`, `newCriterion`, collapsed branches) stays local to components.
- All tree mutations are pure functions in `src/domain`.
- Components receive data and callbacks; no component reads `localStorage`.

## 2. Real persistence layer

Replaced the single `localStorage` write in a `useEffect` with a repository:

- Separate keys per concern: `layers:doc:v3`, `layers:activity:v3`,
  `layers:ui:v3`. Activity updates no longer rewrite the document.
- Debounced writes (250 ms) with guaranteed flushes on blur, `pagehide`,
  `beforeunload` and `visibilitychange`; structural edits and checkboxes are
  written immediately.
- Only changed slices are serialized (reference comparison), so switching
  chapters does not rewrite the document.
- Runtime validation and repair instead of throwing: defaulted fields, duplicate
  chapter/criterion ids replaced, dangling links dropped, cycles broken, orphans
  recovered.
- Explicit migration from the phase 1 `layers-chapters-v2` payload (nested
  chapters) to the normalized document. The legacy key is kept for rollback.
- Corrupt payloads are copied to `layers:backup:<key>:<timestamp>` and explained
  in a banner before any new data is written.
- Write failures (quota, private mode) surface a banner with **Retry saving** and
  **Download backup**.
- Cross-tab sync via the `storage` event; a tab with pending changes does not
  adopt external writes.
- **Export workspace** / **Import workspace** as JSON, including a full
  round-trip test.

## 3. Normalized document model

The nested `Chapter.children` tree was replaced by:

```text
Workspace { schemaVersion, project, chapters, events, selectedId }
Chapter   { id, parentId, title, description, finalLevel, criteria, childIds }
Criterion { id, text, checked, chapterId? }
Document  { byId: Record<id, Chapter>, rootIds: id[] }
```

Consequences:

- Chapter lookup is O(1). Field edits no longer rebuild every record on the
  path; untouched chapters keep object identity, which the memoized sidebar
  relies on.
- Phase 3 operations are available and unit tested: `deleteSubtree`,
  `moveChapter`, `reorderCriteria`, `moveCriterion`, `duplicateSubtree`,
  `walkChapters`.
- Markdown-to-title derivation, criterion/subchapter creation, criterion
  toggling and removal are pure and covered by unit tests.
- Criterion to subchapter links stay consistent: deleting a chapter detaches
  linked criteria, deleting a criterion never deletes the chapter.
- Sidebar rows are memoized through `useChapterTree`, which preserves node
  identity for untouched subtrees.

## 4. Seams for the next phase

- **Repository interface** (`load`, `save`, `flush`, `status`,
  `onStatusChange`, `subscribe`, `exportWorkspace`, `parseImport`). The
  `localStorage` implementation is swappable without touching components.
- **Hash routing**: `#/chapters/<id>`, `#/coverage`, `#/activity`. Reload keeps
  the exact chapter, browser back/forward works, every chapter is linkable, and
  unknown ids are canonicalized to the first chapter.
- **Project record** (`{ id, name, account }`) replaces the hard-coded
  "Website project" strings, so multi-project support becomes a data change.
- **Test coverage** has a proposed model documented here (not yet persisted):
  `Criterion.coverage = { status: "covered" | "partial" | "missing", tests:
  [{ id, name, file, lastRun? }] }`. Adding it later is a schema migration, not a
  UI rewrite.

## 5. Delivery and rendering performance

- `vite.config.js` with manual chunks (React, vendor/Markdown, icons), ES2022
  output and source maps.
- Activity and Test coverage pages are lazy-loaded.
- The Google Fonts CSS `@import` was replaced by preconnected `<link>` tags with
  `display=swap`, removing the blocking CSS import chain.
- `ChapterNode` is memoized and chapter actions are stable, so typing in the
  editor re-renders only the edited chapter's path, not every sidebar row.
- Markdown previews use `useDeferredValue`.

Measured production build (gzip):

| Chunk | Raw | Gzip |
| --- | --- | --- |
| `index` (app) | 43.1 kB | 14.2 kB |
| `react` | 221.9 kB | 69.1 kB |
| `vendor` (Markdown) | 165.5 kB | 50.6 kB |
| `icons` | 2.8 kB | 1.3 kB |
| CSS | 21.4 kB | 5.2 kB |
| Activity (lazy) | 1.4 kB | 0.7 kB |
| Test coverage (lazy) | 0.6 kB | 0.4 kB |

The total is slightly larger than the phase 1 single 126 kB gzip bundle because
routing, persistence, validation and accessibility code were added. The gain is
cacheable vendor chunks and lazy secondary pages, not a smaller first route;
React and Markdown cannot be dropped from the editor route.

## 6. Quality gate

- **Vitest** unit tests: 53 tests covering chapters, criteria, normalization and
  repair, activity, the reducer and the persistence repository (migration,
  corrupt payload, quota failure, debounce/flush, slice diffing, cross-tab).
- **Type checking** over `src/domain` and the reducers with JSDoc types
  (`allowJs`, `checkJs`, `strict`, `noEmit`).
- **ESLint** flat config with `react`, `react-hooks` and `no-unused-vars`, plus
  **Prettier** check.
- **Playwright** suite: the phase 1 scenarios plus routing, migration, corrupt
  data, flush-on-reload, export/import, cross-tab sync, write failure/retry,
  axe accessibility and focus management.
- **Production smoke** against `vite preview` (`npm run test:prod`).
- **GitHub Actions** workflow running lint, format check, typecheck, unit tests,
  build and the browser suite (committed, not executed here).

## 7. Resilience and accessibility

- Top-level and per-page error boundaries with a recovery screen offering
  reload, raw-storage backup download and a way back to specifications.
- Save status is a live region (`role="status"`, `aria-live="polite"`) and
  reports pending, saved, failed and unavailable states.
- The storage banner offers retry, export and dismissal; import errors are
  announced with `role="alert"`.
- Focus contract: selecting or creating a chapter focuses the chapter title;
  opening the mobile drawer focuses its close button, traps Tab and Escape, and
  restores focus to the opener; a skip link jumps to the document.
- Activity entries for chapters that no longer exist render as text, not broken
  links.
- Axe (WCAG 2.0/2.1 A and AA) passes on specifications, activity and coverage.
  Muted text colors were darkened to reach 4.5:1 contrast; no layout changed.

## Verification

Run from the repository root:

```sh
npm run lint
npm run format:check
npm run typecheck
npm run test:unit     # 53 passed
npm run build
npm run test:e2e      # 19 passed (Chromium)
npm run test:prod     # 1 passed (production preview)
```

Results on 2026-10-28: lint, formatting and type check clean; 53/53 unit tests;
production build succeeds; 19/19 browser tests; production smoke test passes.

The browser suite includes the six phase 1 scenarios unchanged except for one
assertion that read the old `layers-chapters-v2` storage shape. It now asserts
the same invariant (a created criterion links to a generated child chapter with
the criterion Markdown as its description) against `layers:doc:v3`.

## Deliberate behaviour changes

- Storage schema is v3 (see migration above). Old keys remain untouched.
- Activity chapter links now open that chapter. In phase 1 they only changed the
  selected id while leaving the Activity page open.
- Selecting or creating a chapter moves keyboard focus to the title.
- The save indicator shows "Saving changes…" while a debounced write is pending.
- Muted label colors were darkened for WCAG AA contrast.
- Sidebar gained Export/Import workspace controls and the app gained a skip
  link; no existing control was removed.

## Out of scope (carried forward)

All carried-forward ideas are consolidated in
[phase-ideas.md](phase-ideas.md) with stable IDs and their source phases.

# Phase 1 — UI mockup

Status: delivered  
Date: 2026-10-27

## What we built

Layers is a clickable React prototype for writing project specifications as nested chapters. Every chapter has the same simple structure: a description and a success-criteria checklist.

The prototype uses mock data and browser storage. It has no real backend.

## Specification structure

Chapters live in the left sidebar. Each chapter can contain any number of subchapters, with no application-defined nesting limit.

The sample project includes:

```text
Website project
├── Authentication
│   ├── Login form
│   └── Password reset
│       └── Reset email template
│           └── SMTP requirements
└── User profiles
```

Selecting a chapter opens its content in the main document panel. Breadcrumbs show its position in the hierarchy and let users open its ancestors.

## Delivered functionality

### Chapters

- Create a top-level chapter using **New chapter** below the tree.
- Create a subchapter using the **+** on a chapter row. The control appears on hover, keyboard focus, or selection; it stays visible on mobile.
- Expand and collapse branches independently.
- Rename a chapter directly through its title in the document panel.
- Start with an empty description and checklist when creating a chapter.
- Cancel chapter creation using Escape or the cancel control.
- Keep deeply nested navigation accessible through horizontal scrolling within the chapter tree.

The **Chapters** heading has no duplicate add button.

### Description

Each chapter has an editable description supporting GitHub-flavored Markdown.

- Formatted text is shown by default.
- Double-click the text to edit its Markdown source.
- Click outside the editor to return to formatted text.
- For keyboard editing, focus the preview and press Enter or F2. Escape or Ctrl/Cmd+Enter finishes editing and keeps the changes.
- Empty descriptions show a placeholder that can also be double-clicked to edit.

There are no Write/Preview buttons or visible Markdown helper labels.

### Success criteria

Each chapter has its own independent checklist.

- Add a criterion using the input below the checklist.
- Each new criterion also creates a subchapter under the current chapter unless **Final level** is checked. Its title comes from the first line, with common Markdown formatting removed, and its description starts with the full criterion Markdown.
- Keep the parent chapter selected and expand its branch to show the new subchapter.
- Manually created subchapters do not add criteria to the parent checklist.
- Existing criteria are not converted retroactively. After creation, the subchapter can be edited independently; editing or removing a criterion does not rename or delete the subchapter.
- Press Enter to add an item, or use the Add button when text has been entered.
- Use Shift+Enter for a new line inside a criterion.
- Check and uncheck items independently.
- Double-click an item's formatted text to edit its Markdown source.
- Edit one item while the other items stay in preview mode.
- Remove an item using its remove control.
- Show the completed count and a progress indicator when the checklist has items.

### Final level

Each document has a **Final level** checkbox in the top-right corner of its document header. It is off by default, including for existing documents without a saved setting. When checked, adding success criteria does not automatically create subdocuments. Manual subdocuments remain available, and existing subdocuments are kept. Turning it off restores automatic creation for future criteria without backfilling previous ones. The setting is saved per document and recorded in Activity. New subdocuments start with Final level off.

### Markdown

Both descriptions and individual checklist items support:

- Headings, paragraphs, bold, italic, and strikethrough.
- Links, automatic URL linking, and images.
- Ordered and unordered lists, including nested lists.
- GitHub-style task lists.
- Tables and blockquotes.
- Inline code and fenced code blocks.

Markdown source is preserved when switching between editing and preview, navigating between chapters, and reloading the page. Task lists inside Markdown are rendered as preview content; the chapter's outer success-criteria checkboxes are the interactive completion controls.

Raw HTML is skipped, and the renderer's default URL handling is retained. Code blocks use a monospace style; syntax highlighting is not implemented.

### Workspace navigation

The sidebar includes three pages:

| Page | Delivered behavior |
| --- | --- |
| Specifications | Chapter tree, document editor, and success-criteria checklist. |
| Test coverage | A **Soon** badge in navigation and an **In development** placeholder page. |
| Activity | A local history of chapter and checklist changes. |

Activity records chapter creation, subchapter creation, title and description edits, criterion edits, additions, removals, and completion changes. Text edits are recorded when leaving a field rather than on every keystroke. Entries include a timestamp and a link to the affected chapter. The latest 100 entries are retained.

### Local persistence

Chapters, the selected chapter, and activity are automatically saved in browser `localStorage` under `layers-chapters-v2`.

Reloading restores that workspace. Existing saved content is preserved across the design refresh. New browser workspaces use the sample data from `src/data.js`.

The interface shows the local save state. If browser storage cannot be written, it reports that changes are not saved. Data is specific to the browser and origin; there is no cross-device synchronization.

## Visual design

We created an initial image concept, simplified the product through the clickable prototype, and then created and implemented an approved design refresh.

The implemented design includes:

- A warm background and a separate white document surface with a subtle border and shadow.
- Stronger typography, darker readable text, and indigo accents.
- Clear chapter nesting with guide lines, chevrons, folder/document icons, and a selected-row accent.
- A large editable document title and breadcrumb navigation.
- Numbered Description and Success criteria sections on desktop.
- Spacious checklist rows, fine dividers, indigo completion checkboxes, and progress feedback.
- Styled Markdown blockquotes, tables, links, and code blocks.
- Responsive layouts with a collapsible chapter sidebar on mobile.
- Keyboard focus indicators and reduced-motion support.

The final interface keeps the chapter editor simple. The earlier dashboard cards, detail inspector, and mock test-linking interface are not part of the current UI.

## Implementation

| Area | Technology or file |
| --- | --- |
| UI | React 19 and JavaScript/JSX |
| Development and production build | Vite 7 |
| Icons | Lucide React |
| Markdown rendering | `react-markdown` and `remark-gfm` |
| Styling | Responsive CSS; DM Sans and Manrope loaded from Google Fonts, with system font fallbacks |
| Workspace and interactions | [src/main.jsx](../src/main.jsx) |
| Reusable Markdown editor | [src/Markdown.jsx](../src/Markdown.jsx) |
| Sample chapters and tree helpers | [src/data.js](../src/data.js) |
| Visual design | [src/styles.css](../src/styles.css) |
| Browser checks | [tests/workspace.spec.js](../tests/workspace.spec.js) |

The data model is a recursive chapter structure:

```text
Chapter
  id
  title
  description: Markdown string
  finalLevel: boolean (defaults to false)
  criteria: [{ id, text: Markdown string, checked, chapterId?: linked subchapter ID }]
  children: Chapter[]
```

## Running locally

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. To build and serve the production output:

```sh
npm run build
npm run preview
```

The production build is written to `dist/`.

## Validation

The latest implementation passed the production build and all six Chromium browser tests. Desktop and mobile screenshots were also inspected after the design refresh.

The browser tests cover:

1. Creating nested chapters through seven subchapter levels, editing descriptions and criteria, checking items, removing items, and restoring saved data after reload.
2. Collapsing the chapter tree, cancelling creation, renaming chapters, mobile navigation, and viewport overflow checks.
3. Workspace navigation, the test-coverage placeholder, activity recording and persistence, and reopening chapters from activity.
4. Preview by default, double-click and keyboard editing, blur-to-preview behavior, Markdown formatting, source persistence, multiline input, unsafe HTML/URL handling, and mobile overflow checks.

5. Automatic subchapter creation from criteria, Markdown seeding, parent selection, independent manual subchapters, nested creation, and persistence.

6. Final level defaults, per-document persistence, manual creation while enabled, preservation of existing children, and resuming automatic creation without backfilling.

To run the checks:

```sh
npx playwright install chromium
npm test
npm run build
```

## Current boundaries

- No server, database, real authentication, or account management.
- No collaboration, permissions, or shared workspace storage.
- No real test runner, test linking, or computed automated-test coverage. Test coverage is a placeholder.
- Activity is a browser-local change history, not a server audit log.
- Chapter deletion, reordering, and moving between parents are not implemented.
- The prototype has been checked in Chromium; a full cross-browser and accessibility audit has not been performed.

Future ideas from this list are consolidated in
[phase-ideas.md](phase-ideas.md); this section records the phase 1 boundary.

## Follow-up — 2026-10-28

Adding a success criterion now creates its corresponding subchapter immediately. Manual subchapter creation remains independent from the checklist. The original phase was delivered on 2026-10-27; this follow-up extends the chapter workflow.

The follow-up also adds the per-document **Final level** checkbox in the top-right corner of the document header, alongside the breadcrumbs. It is off by default and saved per document. Checking it stops automatic subdocument creation from new success criteria while keeping manual subdocuments available and preserving existing children.

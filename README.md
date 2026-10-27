# Layers

A simple React mockup for project specifications. Create chapters in the left sidebar and nest subchapters at any depth. Each chapter contains an editable description and a success-criteria checklist.

## Run

```sh
npm install
npm run dev
```

Use the **+** next to a chapter to add a subchapter, or **New chapter** to create a top-level chapter. Click a chapter to edit its title, description, and checklist. Descriptions and success criteria support GitHub-flavored Markdown. Text displays formatted by default, including tables, task lists, links, and code blocks. Double-click a description or checklist item to edit its Markdown; click outside to return to formatted text. Keyboard users can focus the text and press Enter or F2 to edit, then Escape or Ctrl/Cmd+Enter to finish. Adding a success criterion also creates a subchapter under the current chapter, using the first line as its title and the full Markdown text as its description. The current chapter stays open. The **Final level** checkbox is off by default. When checked, new criteria stay in the current document without automatically creating subchapters. This setting is saved per document; manual subchapters are still allowed. Manually created subchapters do not add checklist items. Press Enter to add a new checklist item; Shift+Enter inserts a new line. Changes save automatically in browser localStorage. All data is local; there is no backend.

## Verify

```sh
npx playwright install chromium
npm test
npm run build
```

# Phase 4 — Verification criteria

Status: delivered  
Date: 2026-11-03

## Goal

Add a verification layer to success criteria and make test coverage meaningful:

- Every criterion on a chapter with at least one ancestor gets a **Verification
  Rules** section between Description and Success criteria.
- Each criterion chooses exactly one verification mode: **Auto-test**, **Human**
  or **AI**, with mode-specific content.
- Test coverage shows all verification-eligible criteria but counts only
  Auto-test criteria with a command as covered.
- Each project gains one shared **Test guidelines** field for human and AI
  testers.

Phase 4 deliberately starts a fresh local database. The current v4 projects are
mock data and are not migrated.

## Locked decisions

| Topic | Decision |
| --- | --- |
| Eligibility | Criteria on chapters with at least one ancestor (`parentId !== null`) |
| Block layout | One chapter-level **Verification Rules** section, one row per criterion |
| Modes | Exactly one of Auto-test, Human or AI; default Human |
| Mode switching | Each mode keeps its own text; switching back restores it |
| Human field | Plain multi-line text |
| AI field | Plain multi-line instruction |
| Auto-test field | One full single-line command, e.g. `npm test login:test-ok` |
| Validation | No hard blocking; coverage counts only Auto-test with a command |
| Coverage | Show all eligible criteria; only Auto-test with a command contributes |
| Guidelines | One shared plain-text box per project, in project settings |
| Database | New v5 structure from scratch; delete all v4 projects |
| Sample data | Seed two refreshed mock projects with verification examples |
| Quality gate | Same as phase 3, plus verification/coverage tests |

### Derived choices to review

These follow from the answers above but were not stated explicitly.

- Verification-eligible means the criterion's chapter has a parent. Root-chapter
  criteria keep their current UI and are excluded from coverage.
- The Verification Rules section is hidden when a non-root chapter has no
  criteria.
- Section numbers are dynamic: Description `01`, Verification Rules `02`, Success
  criteria `03` when the block is shown; otherwise Success criteria remains `02`.
- Coverage denominator is every verification-eligible criterion in the project.
  Human and AI criteria count as not covered; Auto-test criteria with an empty
  command also count as not covered.
- The coverage page shows Human/AI rows as context but shows commands only for
  Auto-test rows.
- Test guidelines are stored in a separate per-project settings key, not in the
  catalog index, so the project list stays compact.
- Guidelines are not automatically injected into AI verification instructions.
- Existing `layers-project` v1 files remain importable; new exports use v2.
- The phase 4 reset removes v4 project data and legacy keys but keeps
  `layers:backup:*` copies.

## 1. Domain model

Add `src/domain/verification.ts`.

```ts
export type VerificationMode = "auto" | "human" | "ai";

export interface VerificationRule {
  mode: VerificationMode;
  auto: { command: string };
  human: { instructions: string };
  ai: { instructions: string };
}
```

`Criterion` gains a required `verification` field:

```ts
export interface Criterion {
  id: string;
  text: string;
  checked: boolean;
  chapterId?: string;
  verification: VerificationRule;
}
```

Every normalized criterion gets a verification object, including root criteria,
so the data shape is uniform and future chapter moves do not lose rules. The UI
only exposes the block for eligible chapters.

Default:

```ts
{
  mode: "human",
  auto: { command: "" },
  human: { instructions: "" },
  ai: { instructions: "" },
}
```

Limits and normalization:

| Field | Rule |
| --- | --- |
| `mode` | Whitelist; unknown values fall back to `human` |
| `auto.command` | Trim; collapse line breaks to spaces; max 500 chars |
| `human.instructions` | Preserve line breaks; trim outer whitespace; max 2,000 chars |
| `ai.instructions` | Preserve line breaks; trim outer whitespace; max 4,000 chars |
| Missing verification | Replaced with the default |
| Malformed verification | Repaired field by field |

Helpers:

- `createDefaultVerification()`.
- `normalizeVerification(raw)`.
- `isVerificationEligible(chapter)` — `chapter.parentId !== null`.
- `isAutomated(criterion)` — mode is `auto` and `command.trim()` is non-empty.
- `getVerificationCriteria(document)` — pre-order list of
  `{ chapter, criterion }` for eligible chapters.
- `summarizeVerification(document)` — `{ total, automated, human, ai,
  incompleteAuto, percent }` where `total` is eligible criteria and `automated`
  is Auto-test criteria with a command.
- `getCoverageRows(document)` — rows with chapter id/title/path, criterion
  id/text, checked state, mode, command and `automated`.

`createCriterion` and `createSubchapterFromCriterion` add the default. Existing
criterion operations copy the whole rule, including `duplicateSubtree` and
criterion auto-created subchapters.

## 2. Project test guidelines

Add a project settings record rather than bloating the catalog index:

```ts
export interface ProjectSettings {
  schemaVersion: number;
  projectId: string;
  testGuidelines: string; // plain text, max 8,000 chars
}
```

Storage key: `layers:project:<id>:settings:v5`.

`ProjectInput` and `ProjectPatch` gain `testGuidelines?: string`. The catalog:

- writes settings on create;
- updates settings when project settings are saved;
- copies settings when a project is duplicated;
- includes settings in export/import;
- logs “Updated test guidelines” in the project’s activity when the text
  changes;
- exposes `getProjectGuidelines(id)` for dialogs and the coverage page.

The existing project index/stat payload does not change shape. Guidelines never
enter the index.

## 3. Storage v5 and reset

New keys:

| Key | Contents |
| --- | --- |
| `layers:projects:v5` | Project catalog index |
| `layers:project:<id>:doc:v5` | Project document with criteria + verification fields |
| `layers:project:<id>:activity:v5` | Project activity |
| `layers:project:<id>:ui:v5` | Selected chapter |
| `layers:project:<id>:settings:v5` | Project test guidelines |
| `layers:backup:*` | Existing automatic backups |

`SCHEMA_VERSION` becomes `5`. The export format becomes `layers-project` version
`2`.

### One-time reset

Phase 4 intentionally discards the mock v4 projects.

On catalog load:

1. If `layers:projects:v5` is missing, perform a one-time reset.
2. Remove `layers:projects:v4`.
3. Remove every key starting with `layers:project:` whose name ends in `:v4`.
4. Remove the phase 1/2 keys (`layers:doc:v3`, `layers:activity:v3`,
   `layers:ui:v3`, `layers-chapters-v2`, `layers-chapters-v1`).
5. Keep `layers:backup:*` untouched.
6. Seed the new v5 sample projects and write the catalog plus all project
   payloads synchronously.
7. Show an informational banner explaining that the previous mock projects were
   replaced.

No v4 → v5 migration is implemented. A corrupt v5 index follows the phase 3
recovery path: back up, reseed, and report it.

### Seeded projects

Keep the two familiar projects, but seed fresh content that demonstrates the new
model:

- **Website project** (`website`, indigo, “W”).
- **Mobile app** (`mobile`, teal, “M”).

Add representative verification data:

- Root chapters keep criteria without a Verification Rules section.
- Nested chapters get a mix of Auto-test, Human and AI rules.
- Website examples:
  - Login form → Auto-test `npm test login:test-ok`;
  - Password reset → Human instructions;
  - Reset email template → AI instructions.
- Mobile examples:
  - Welcome screens → Auto-test `npm test mobile:welcome`;
  - Permission prompts → AI instructions;
  - Cache policy → Human instructions.
- Both projects get non-empty **Test guidelines** with commands, test-account
  notes and AI/human expectations.

## 4. Reducer and actions

`src/domain/criteria.ts` gains:

- `patchCriterionVerification(document, chapterId, criterionId, patch)`.
- Small helpers for mode and per-mode text updates.

New workspace actions:

```ts
setCriterionVerificationMode(chapterId, criterionId, mode)
setCriterionVerificationText(
  chapterId,
  criterionId,
  field: "auto" | "human" | "ai",
  value: string,
)
```

- Mode changes save immediately and log activity.
- Text changes are debounced like descriptions and criteria text.
- The workspace reducer remains pure; all rule updates go through
  `patchCriterionVerification`.
- `IMMEDIATE_ACTIONS` includes the mode action.
- The provider exposes both actions.

Activity messages:

- `Set auto-test verification: <criterion>`
- `Set human verification: <criterion>`
- `Set AI verification: <criterion>`
- `Updated auto-test command: <criterion>`
- `Updated human verification: <criterion>`
- `Updated AI verification: <criterion>`

Text activity is logged on blur, consistent with descriptions and titles.

## 5. Verification Rules UI

Add `src/components/VerificationRules.tsx` (plus a small mode switch component if
needed).

Placement in `ChapterEditor`:

```text
Document header
Title
Description                   01
Verification Rules            02   (only eligible chapters with criteria)
Success criteria              03
```

For root chapters or chapters with no criteria, the section is omitted and the
success criteria number stays `02`.

Each criterion row contains:

- the criterion text (shortened if long);
- a segmented mode switch: **Auto-test**, **Human**, **AI**;
- the field for the active mode:
  - Auto-test: single-line command input with placeholder
    `npm test login:test-ok`;
  - Human: multi-line plain text with placeholder
    “How should a person verify this?”;
  - AI: multi-line plain text with placeholder
    “What should an AI verifier do?”.

Behavior:

- The mode switch is a radio group for assistive technology
  (`role="radiogroup"`, `role="radio"`, `aria-checked`), with full mode names in
  accessible labels.
- Switching modes does not clear the other mode fields.
- Auto-test with an empty command shows an inline hint:
  “Add a command to count this criterion as covered.”
- No empty-field blocking; drafts are allowed.
- Auto-test input accepts one command; pasted line breaks are collapsed.
- Human/AI text is plain text, not Markdown, and is not previewed.
- Changes autosave with the rest of the project.
- The section is keyboard operable and passes axe.

## 6. Test coverage page

Replace the placeholder `TestCoverageView` with a project-scoped coverage view.

Semantics (option B):

- The page lists every verification-eligible criterion in the project.
- Only Auto-test criteria with a non-empty command count as covered.
- Human, AI and Auto-test-without-command rows are shown as uncovered context.
- Root-chapter criteria are excluded entirely because they have no verification
  rules.
- The percentage is `automated / total eligible`, rounded to the nearest whole
  number.
- No test execution, result recording or report ingestion happens here.

Content:

1. **Test guidelines** panel at the top, read-only, with an **Edit test
   guidelines** button that opens project settings.
2. Summary: “N of M eligible criteria covered by automated tests”, percentage,
   and counts for Human, AI and Auto-test missing a command.
3. Coverage rows grouped or sorted by chapter path. Each row shows:
   - chapter path and chapter title;
   - criterion text;
   - mode badge;
   - checked state;
   - for Auto-test: the command in monospace;
   - a button that opens the chapter.
4. Empty states:
   - no verification-eligible criteria: explain that criteria on subchapters
     are needed;
   - eligible criteria but no automated tests: show 0% and a clear explanation.
5. The page stays lazy-loaded and project-scoped.

## 7. Project settings dialog

Extend the existing create/edit `ProjectDialog`:

- Add a **Test guidelines** textarea below Description.
- Plain text, up to 8,000 characters, 5 rows, with a character counter.
- Help text: shared instructions for human and AI verification, saved with the
  project and included in exports.
- When editing, load the current guidelines through
  `getProjectGuidelines(id)` before opening the dialog.
- When creating, start empty.
- Saving metadata and guidelines is one catalog action; a failure keeps the
  dialog open with an error.
- Duplicated projects copy the guidelines.
- Activity records guideline changes.
- The dialog remains accessible and focus-trapped.

## 8. Export/import

Bump the `layers-project` format to version 2:

```json
{
  "format": "layers-project",
  "formatVersion": 2,
  "exportedAt": "2026-11-03T12:00:00.000Z",
  "project": {},
  "testGuidelines": "Run npm test before verifying. Use test accounts only.",
  "chapters": {},
  "activity": [],
  "ui": {}
}
```

- Criteria inside `chapters` include the full verification object.
- Import v2 reads `testGuidelines`.
- Import v1 maps missing guides to `""` and missing verification objects to the
  default Human rule.
- Import still always creates a new project and never overwrites.
- Export/import round-trip tests cover verification rules and guidelines.

## 9. Files

New:

```text
src/domain/verification.ts
src/components/VerificationRules.tsx
src/components/VerificationModeSwitch.tsx   (optional split)
src/components/CoverageRow.tsx               (optional split)
```

Modified:

```text
src/domain/chapters.ts                  Criterion.verification
src/domain/criteria.ts                  creation + verification patch helpers
src/domain/schema.ts                    v5 normalization, settings, export v2
src/domain/projects.ts                  ProjectInput/Patch guidelines
src/data.ts                             refreshed sample projects with rules
src/store/workspaceReducer.ts           verification actions
src/store/WorkspaceProvider.tsx         verification action wiring
src/store/persistence.ts                v5 keys + settings payload
src/store/catalogRepository.ts          reset, settings read/write/copy/export
src/store/ProjectsProvider.tsx          getProjectGuidelines
src/app/WorkspaceShell.tsx              guideline loading + coverage props
src/app/App.tsx                         standalone project settings guidelines
src/components/ChapterEditor.tsx        Verification Rules section
src/components/ProjectDialog.tsx        Test guidelines field
src/components/TestCoverageView.tsx     real coverage page
src/components/ProjectsView.tsx         pass guideline-aware edit data
src/styles.css                          verification section, switch, coverage
README.md                               v5 storage, verification and coverage
```

## 10. Test plan

### Unit (Vitest)

- Verification defaults, mode whitelist, per-mode text preservation, limits,
  missing/malformed repair.
- `isVerificationEligible`, `isAutomated`, `summarizeVerification`,
  `getCoverageRows`.
- Criterion creation and duplicateSubtree copy verification.
- Reducer mode/text updates and activity entries.
- Schema v5 normalization; v4 reset removes old projects; settings payload
  normalization; export v2 and v1 import.
- Catalog create/update/duplicate/delete/import/export with guidelines; settings
  key presence; activity for guideline changes.
- Coverage calculation: root criteria excluded, auto-without-command uncovered,
  human/AI uncovered, 0/0 empty case.

### Browser (Playwright, Chromium)

1. Root chapter has no Verification Rules; nested chapter shows the section
   between Description and Success criteria.
2. Switching Auto-test/Human/AI shows the correct field; values are preserved
   when switching back and survive reload.
3. Auto-test command counts toward coverage; Human/AI and empty Auto-test do not.
4. Coverage page lists all eligible criteria, excludes root criteria, shows the
   correct percentage and links back to chapters; empty states work.
5. Project guidelines can be edited, are shown on the coverage page, survive
   reload and duplicate, and round-trip through export/import.
6. First load clears v4 projects and shows the two refreshed samples with
   verification examples.
7. Activity records verification mode/text and guideline changes.
8. Axe passes on the Verification Rules section, project dialog and coverage
   page; keyboard mode switching works.
9. Existing phase 1–3 suites update for v5 keys, fresh sample data and the new
   section numbers.

### Quality gate

```sh
npm run lint
npm run format:check
npm run typecheck
npm run test:unit
npm run build
npm run test:e2e
npm run test:prod
```

## 11. Delivery sequence

1. Domain: verification types/helpers, criterion model, schema v5, sample data.
2. Storage: v5 keys, settings payload, reset, catalog guideline CRUD.
3. State: reducer/actions/provider wiring.
4. Editor: Verification Rules section and mode-specific fields.
5. Project settings: guidelines field and guideline loading.
6. Coverage: replace placeholder with the project-scoped coverage view.
7. Export/import v2 and v1 compatibility.
8. Tests, accessibility, README and delivered phase notes.

## 12. Acceptance criteria

- [ ] First load after phase 4 clears all v4 project data and seeds two fresh
      sample projects with verification rules and guidelines.
- [ ] Criteria on chapters with a parent show Verification Rules; root criteria
      do not.
- [ ] Each criterion has one mode switch with Auto-test, Human and AI; each mode
      retains its own content.
- [ ] Auto-test accepts a complete command; Human and AI accept plain text.
- [ ] Verification rules autosave, survive reload and appear in activity.
- [ ] Project settings include a Test guidelines field; it is saved, copied,
      exported and imported.
- [ ] Coverage shows all eligible criteria, counts only Auto-test with a command,
      excludes root criteria and links back to chapters.
- [ ] Project guidelines are visible on the coverage page with a path to edit
      them.
- [ ] axe and keyboard checks pass for the verification section, mode switches,
      project dialog and coverage page.
- [ ] The full quality gate is green and README documents v5, verification and
      coverage semantics.

## 13. Deliberate behaviour changes

- All existing v4 projects are deleted on first phase 4 load. This is intentional
  because they are mock data; backups remain.
- Success criteria now carry verification data, adding a new editor section for
  nested chapters.
- Section numbering is dynamic depending on whether Verification Rules is shown.
- Test coverage is no longer a placeholder and is project-scoped.
- Project settings gain a shared test-guidelines field.
- Project exports move to format version 2; v1 imports remain supported.

## 14. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Destructive v5 reset surprises someone | Product-owner approval, clear banner and README warning, backups retained |
| Long guidelines bloat the catalog | Store guidelines in a per-project settings key, not the index |
| Mode switching loses text | Keep separate content per mode and test toggling |
| Coverage meaning is ambiguous | Document option B explicitly: list all eligible, count only valid Auto-test |
| Root criteria are silently excluded | Explain eligibility in the coverage empty state and README |
| Verification fields become noisy | One chapter-level section with compact per-criterion rows |
| Export/import compatibility regresses | v2 round-trip tests plus v1 import fixtures |
| Auto-created subchapters confuse rule ownership | Rules stay on the criterion’s chapter; new subchapters start with their own default rules |

## 15. Delivery notes

Implemented as planned:

- The initial delivery used schemaVersion 5; the follow-up raised it to 6 while
  keeping the `layers:projects:v5` key namespace and per-project v5 keys.
- The first v5 load clears v4 project/catalog keys plus the phase 1/2 keys, keeps
  `layers:backup:*`, and seeds refreshed **Website project** and **Mobile app**
  samples with verification rules and test guidelines.
- `src/domain/verification.ts` owns modes, per-mode content, normalization,
  eligibility, coverage summarisation and coverage rows.
- The initial delivery stored the verification rule on criteria. The follow-up
  moves it to chapters and migrates the first non-empty criterion rule.
- The editor adds a **Verification Rules** section for chapters with a parent.
  Section numbering is dynamic (Description `01`, Verification `02`, Success
  criteria `03` or `02`). The follow-up removed the earlier criteria condition.
- Auto-test, Human and AI are implemented as a radio-group switch. Auto-test
  stores one command; Human and AI store plain multi-line text. Empty Auto-test
  commands show a coverage hint but do not block editing.
- Test coverage uses option B: it lists all verification-eligible criteria, but
  only Auto-test criteria with a command count as covered. Root criteria are
  excluded. The page shows project guidelines, summary counts, commands, mode
  badges and links back to chapters.
- Project test guidelines live in a separate settings key and are editable in
  project settings. They are copied on duplicate, included in v2 exports,
  imported by v1/v2 imports and displayed on the coverage page.
- Project exports moved to `layers-project` format version 2 with a top-level
  `testGuidelines` field. The follow-up moves to version 3 with verification on
  chapters; v1/v2 imports still work.
- Unit coverage grew to 90 tests across 8 files; the Chromium suite grew to 32
  tests including verification-mode persistence, coverage counting, guideline
  editing and empty coverage states.

### Verification

Run on 2026-11-03:

```sh
npm run lint          # clean
npm run format:check  # clean
npm run typecheck     # clean
npm run test:unit     # 90 passed (8 files)
npm run build         # succeeded
npm run test:e2e      # 32 passed (Chromium)
npm run test:prod     # 1 passed (production preview)
```

Production build (gzip): app 25.0 kB, React 69.0 kB, Markdown vendor 50.6 kB,
icons 1.9 kB, projects page 2.0 kB (lazy), coverage 1.8 kB (lazy), activity
0.7 kB (lazy), CSS 7.8 kB.

## Follow-up — 2026-11-03

After review, the verification model was simplified to one rule per page:

- **Verification moved from criteria to chapters.** Each chapter with a parent
  has one Verification Rules block for that page, regardless of how many success
  criteria it contains. This matches the “enter email” / “six characters” page
  model: each subchapter has one verification rule.
- Section visibility no longer depends on having criteria; every non-root chapter
  shows the block.
- Existing phase 4 data is upgraded in place: normalization looks for the first
  non-empty criterion-level rule and moves it to the chapter, then strips
  verification from criteria. `schemaVersion` is now `6`; the v5 key namespace is
  retained.
- Project exports moved to `layers-project` version `3`. v1/v2 imports still work
  and convert criterion-level rules to chapter-level rules.
- Coverage now counts **eligible chapters**, not criteria. It lists every
  non-root chapter; only Auto-test chapters with a command count as covered.
- The **Soon** badge was removed from Test coverage.
- Test guidelines were removed from project creation/settings. The coverage page
  now has an inline editable **Test guidelines** text area that saves on blur.
- Chapters can now be deleted from the document header. Confirmation explains the
  subtree size and, when the chapter was created from a criterion, warns that the
  parent success criterion will also be removed.
- `deleteSubtree` now removes linked criteria instead of leaving a detached
  checklist item. Deleting a chapter removes its whole subtree and cleans the
  parent checklist. Deleted chapters disappear from coverage and activity links
  remain as plain text.
- Tests were updated: **90 unit tests** and **32 Chromium tests** pass, including
  deletion of a chapter with descendants, parent-criterion cleanup, cancel,
  activity and coverage removal.

## 16. Out of scope

- Running Auto-test commands, recording results or parsing test reports.
- CI integration, test history and last-run timestamps.
- AI execution of verification instructions.
- Markdown preview for verification fields or project guidelines.
- Multiple simultaneous verification modes per criterion.
- Verification Rules on root-chapter criteria.
- Coverage search, filtering or export.
- Reworking the phase 3 project lifecycle.

Real report-based coverage remains tracked in
[phase-ideas.md](phase-ideas.md) as P-06; phase 4 is declaration-based coverage.

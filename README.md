# Layers

A local workspace for project specifications. Create projects, and inside each
project create chapters and nested subchapters. Each chapter has an editable
Markdown description, verification rules and a success-criteria checklist.

Everything is stored in a local Fastify API backed by SQLite. Accounts and
sessions protect the API, projects are private to their owner, and local AI
agents use project-bound MCP API keys or OAuth connections. There is no cloud
service and no browser `localStorage` persistence. The React UI is one client of
the API.

## How Layers thinks

Layers turns a high-level idea into progressively precise, testable
requirements. It is **not a PRD generator**, and it does not ask you to fill in
documentation categories. Requirements, architecture, implementation, testing
and deployment may appear in the tree, but only where they answer a question
about the outcome above them.

The idea in one line: **each child layer answers a specific question about its
parent.**

- **Start from the outcome.** The root chapter states what the user wants, in
  their own words ("it would be cool if all planning happened automatically").
- **Separate ideas, decisions and details.** An idea is what the user wants to
  achieve, a decision is how they chose to achieve it ("send email", "use
  Resend"), and an implementation detail is what must exist for the decision to
  work ("read the key from the environment", "attach a generated PDF"). Unknown
  decisions stay explicit open questions instead of silently becoming
  assumptions.
- **Prefer depth over breadth.** A flat list of unrelated requirements is a
  PRD; a tree where every branch narrows its parent is a plan. The number of
  levels follows the conceptual complexity, not a fixed rule.
- **Decompose until the leaves are checkable.** A broad statement belongs high
  in the tree, where it opens a branch. The final layer holds criteria that name
  the inputs, the action, the observable result and the failure behaviour, so a
  test or a person can check them without guessing.

That last point is enforced by the data model. On a chapter that is not a final
level, every success criterion becomes a subchapter, with the criterion's first
line as its title. So "Employees should receive their schedules automatically"
is the right shape for a branch, while "The email lists every scheduled customer
in visit order" is the right shape for a leaf. Marking a chapter **Final level**
is the claim that the branch is decomposed far enough; it is not a way to stop
nesting.

```text
Good — outcome first, depth where the meaning is:
It would be cool if all planning happened automatically       (root chapter)
├── Employees should receive their schedules automatically     (criterion → subchapter)
│   └── Schedules arrive by email the evening before          (criterion → subchapter)
│       └── The email attaches a PDF with the visits          (criterion → subchapter, final level)
│           ├── It lists every scheduled customer in visit order
│           ├── Every entry has the customer's address
│           └── Every entry has arrival and departure times
└── Customer data should be loaded automatically               (criterion → subchapter, final level)
    ├── It reads the bookings from the configured Google Sheet range
    └── Invalid rows are reported instead of dropped
```

The same contract is given to AI agents connected over MCP: the server sends it
as initialization instructions and exposes it through the
`how_to_work_with_this_mcp` tool. See
[`LAYERS_AGENT_GUIDE.md`](LAYERS_AGENT_GUIDE.md) for the agent-facing version.

## Using Layers

The sidebar project switcher opens the project menu. **All projects** opens the
projects page where you can create, rename, duplicate, export, import and delete
projects. Each project keeps its own chapters, verification rules, activity,
selected chapter, test coverage and test guidelines.

Each project also has a **Search** view. Search is limited to the current
project and covers chapter titles, descriptions, criteria, commit hashes and
verification text. Results link back to the matching chapter.

Inside a project, use the **+** next to a chapter to add a subchapter, or **New
chapter** to create a top-level chapter. Click a chapter to edit its title,
description, and checklist. Descriptions and success criteria support
GitHub-flavored Markdown. Text displays formatted by default; double-click a
description or checklist item to edit its Markdown, or focus it and press
Enter/F2. Press Escape or Ctrl/Cmd+Enter to finish editing.

Adding a success criterion also creates a subchapter under the current chapter
unless **Final level** is checked. The backend applies the same rule for REST
and MCP document writes. Its title comes from the first line of the criterion.
The checklist item and its subchapter stay synchronized: editing either side
updates the other, and deleting one deletes the other. A link button on the
criterion opens its subchapter, and the subchapter shows which criterion created
it. Manually created subchapters do not add checklist items. Press Enter to add
a criterion and Shift+Enter for a new line. Changes save automatically to the
local API.

### Commit references

Every document has a compact **Commits** row under its title. Paste a git commit
hash and choose **Add** to record that the commit implemented the document. A
document can reference several commits, for example when it is improved over
time. Commits are shown newest first and each chip can be removed. Removing a
commit never changes success criteria or verification state.

Hashes are 7–40 hexadecimal characters. Input is case-insensitive and stored in
lowercase. Invalid hashes are rejected, duplicate hashes are ignored, and a
document can reference at most 50 commits. Links are manual only: Layers never
reads a git repository or contacts a git host, and it does not store commit
messages, authors, dates or URLs. The **Test coverage** page shows each
chapter's newest commit.

### Search

Open **Search** in the project sidebar to find a chapter by keyword or commit
prefix. Search covers chapter titles, descriptions, criteria, commit hashes and
the Auto-test, Human and AI verification text. It searches only the current
project; activity and project metadata are not included. Results show the
chapter path and highlighted snippets, and selecting one opens the chapter.
Search never changes the document or its revision.

### Attachments

Every project document can hold supporting files. Open **Attachments** in the
project sidebar, or use the paperclip in the document header, to add, download
and remove them. PDF, CSV/TSV, text, Markdown, log, JSON, YAML, TOON, JPEG, PNG,
XLS/XLSX, DOCX and PPTX are accepted, up to 10 MiB each and 20 files per
project. Text formats are checked as UTF-8, image and PDF signatures are
verified, and OOXML packages must contain their expected document part. The
browser validates the extension and size first, then the API checks the file
signature and stores the bytes in SQLite. Attachment changes appear in activity
but do not change the document or metadata revision, so uploading a file does
not conflict with an open editor. Duplicating a project copies its attachments;
JSON export/import does not include them.

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
shown as uncovered context. Each row shows the chapter's linked commits. Each
project has a shared **Test guidelines** field that is editable directly on the
coverage page and is included in exports.

Each document header has a delete action. Deleting asks for confirmation and
removes the chapter, every subchapter beneath it, and any success criterion in
its parent that created it.

## Accounts and access

- The super admin is configured in `.env` and synchronized into SQLite at
  startup. The env password creates the account on a fresh database; the stored
  password is changed from the account page.
- Sign in at `#/sign-in` with the super-admin email and password.
- The super admin creates member accounts at `#/users` by entering an email and
  password. No email is sent. Member passwords cannot be changed or recovered.
- The super admin changes their own password at `#/account` by entering the
  current password and the new password twice. Other browser sessions are signed
  out; the current session stays signed in.
- Each user owns their projects. Another user's project returns `404`, including
  for the super admin. The super admin manages users but does not bypass project
  ownership.
- The account page at `#/account` lists browser sessions.
- MCP credentials are managed from a project's actions menu (**MCP access**).
  API keys are shown once, stored hashed, and can be read-only or read-write.
  They default to read-write and expire after 3650 days. A user can have 20
  active keys.
- OAuth clients authorize through the browser consent page, choose one project
  and read-only or read-write access, and receive short-lived access tokens plus
  rotating refresh tokens. Connected apps are listed and revocable from **MCP
  access**.
- Both credential types work only with `/mcp` and only for their project; they
  cannot call the REST API or reach another project.
- Login is rate-limited. Browser sessions use an `HttpOnly`, `SameSite=Lax`
  cookie and are never stored in `localStorage`.

Remote MCP clients need HTTPS and the MCP host settings; see
[Remote MCP access](docs/installation.md#remote-mcp-access) for the client setup
and [the API guide](docs/api.md) for the OAuth flow.

## Install and run

Node 22 or newer is required.

```sh
npm install
cp .env.example .env
# edit LAYERS_SUPER_ADMIN_EMAIL and LAYERS_SUPER_ADMIN_PASSWORD
npm run dev
```

The API runs at `http://127.0.0.1:3001` and the Vite UI at
`http://127.0.0.1:5173`. The SQLite database defaults to `data/layers.sqlite`
and is migrated automatically. `npm run build && npm start` serves the built UI
and API from one process.

[`docs/installation.md`](docs/installation.md) covers the rest: every
environment variable, the Docker image and Compose setup, persistence and
backup, remote MCP access, the architecture, the database tables, the REST route
table, the UI routes, the runtime boundaries and the test suites.

## Documentation

| Document                                             | Contents                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------- |
| [`docs/installation.md`](docs/installation.md)       | Install, configuration, Docker, architecture, database, tests |
| [`docs/api.md`](docs/api.md)                         | REST and MCP API guide with curl and agent examples           |
| [`server/api/openapi.yaml`](server/api/openapi.yaml) | Normative API contract                                        |
| [`LAYERS_AGENT_GUIDE.md`](LAYERS_AGENT_GUIDE.md)     | Instructions for AI agents using the MCP endpoint             |
| [`AGENTS.md`](AGENTS.md)                             | Guidance for coding agents working on this repository         |

Deployment is manual: every push to `main` publishes a public `linux/amd64`
image to GitHub Container Registry after the CI quality gate passes, and the
server upgrade is `docker compose pull && docker compose up -d`. There is no
TLS, reverse proxy or automated deployment included.

## License

Layers is free to use, study, change and share for **noncommercial purposes**
under the [PolyForm Noncommercial License 1.0.0](LICENSE). It is not an
open-source license in the OSI sense because commercial use is reserved.

**Attribution is required.** If you use Layers, its code or its planning
approach, credit the original idea and implementation to Anatolii Fesiuk and
link <https://github.com/festoinc/layer-plan>. The license text carries the
Required Notice for this.

**Commercial use needs a license.** Selling Layers, shipping it inside a paid
product, or offering it as a hosted service requires a separate written license
from Anatolii Fesiuk. Open an issue on the repository or contact the copyright
holder to arrange one. Noncommercial organisations, personal projects,
research and evaluation are covered by the license as published.

Contributions are welcome; by opening a pull request you agree that your
contribution is licensed to the project under these terms so it can also be
covered by commercial licenses. This section is a plain-language summary, not
legal advice; the [LICENSE](LICENSE) text controls.

# Layers agent instructions

Layers MCP tools are the source of truth. Your token determines access; never ask for a password or token in chat. Read projects and documents before changing them. Never invent project, chapter, or criterion IDs or existing content. Work on one document at a time unless the user explicitly requests a batch.

Use get_document and replace_document to edit chapters, criteria, verification rules, and commit references. The document is a normalized tree with chapters.byId, chapters.rootIds and selectedId. Preserve all unrelated fields, links, and ordering. Send the DocumentWrite body with chapters, selectedId, and optionally only new activity entries. Verification has auto, human, and ai modes; preserve inactive mode text. Commit references are lowercase 7–40 character hexadecimal hashes and belong to chapters, not criteria; do not invent hashes.

Use the exact ETag returned by get_document for document writes, and the separate ETag returned by get_project for metadata writes or project deletion. On a revision conflict, reread and rebase; never blindly retry or overwrite. Ask the user to confirm before deleting a project or chapter, removing existing criteria or content, or overwriting conflicting changes. Record meaningful documentation changes in activity.

Coverage is declaration-based: only eligible non-root chapters with a non-empty auto-test command count as covered; tests are not executed. Imports create new projects. Exported instructions describe the export format. Report changes, revision, verification results, and unresolved questions.

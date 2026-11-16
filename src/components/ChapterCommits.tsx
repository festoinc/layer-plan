import { FormEvent, useId, useState } from "react";
import { GitCommitHorizontal, X } from "lucide-react";
import {
  MAX_COMMITS_PER_CHAPTER,
  normalizeCommitHash,
} from "../domain/commits";

export interface ChapterCommitsProps {
  commits: string[];
  onAdd: (hash: string) => void;
  onRemove: (hash: string) => void;
}

export function ChapterCommits({
  commits,
  onAdd,
  onRemove,
}: ChapterCommitsProps) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const fieldId = useId();
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;

  function submit(event: FormEvent) {
    event.preventDefault();
    const hash = normalizeCommitHash(value);
    if (!hash) {
      setError("Enter a 7–40 character hexadecimal commit hash.");
      return;
    }
    if (commits.includes(hash)) {
      setError(`Commit ${hash} is already linked to this document.`);
      return;
    }
    if (commits.length >= MAX_COMMITS_PER_CHAPTER) {
      setError(
        `This document already has ${MAX_COMMITS_PER_CHAPTER} linked commits.`,
      );
      return;
    }
    onAdd(hash);
    setValue("");
    setError("");
  }

  return (
    <section className="commits-section" aria-labelledby={`${fieldId}-heading`}>
      <div className="commits-row">
        <span className="commits-label" id={`${fieldId}-heading`}>
          <GitCommitHorizontal size={14} aria-hidden="true" />
          Commits
        </span>
        {commits.length > 0 && (
          <ul className="commit-chips" aria-label="Linked commits">
            {commits.map((hash) => (
              <li className="commit-chip" key={hash}>
                <code title={hash}>{hash}</code>
                <button
                  type="button"
                  className="remove-commit"
                  aria-label={`Remove commit ${hash}`}
                  title={`Remove commit ${hash}`}
                  onClick={() => onRemove(hash)}
                >
                  <X size={11} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <form className="add-commit" onSubmit={submit} noValidate>
          <label className="visually-hidden" htmlFor={fieldId}>
            Add commit hash for this document
          </label>
          <input
            id={fieldId}
            type="text"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="Commit hash"
            value={value}
            aria-invalid={Boolean(error)}
            aria-describedby={`${hintId}${error ? ` ${errorId}` : ""}`}
            onChange={(event) => {
              setValue(event.target.value);
              if (error) setError("");
            }}
          />
          <button type="submit">Add</button>
          <span className="visually-hidden" id={hintId}>
            Use 7 to 40 hexadecimal characters. The hash is stored in lowercase.
          </span>
        </form>
      </div>
      {error && (
        <p className="commit-error" id={errorId} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

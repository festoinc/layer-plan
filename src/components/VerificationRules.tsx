import { FocusEvent } from "react";
import { Chapter } from "../domain/chapters";
import {
  MAX_AI_INSTRUCTIONS,
  MAX_AUTO_COMMAND,
  MAX_HUMAN_INSTRUCTIONS,
} from "../domain/verification";
import { useWorkspaceActions } from "../store/WorkspaceProvider";
import { VerificationModeSwitch } from "./VerificationModeSwitch";

export interface VerificationRulesProps {
  chapter: Chapter;
}

export function VerificationRules({ chapter }: VerificationRulesProps) {
  const {
    setChapterVerificationMode,
    setChapterVerificationText,
    logActivity,
    flushSave,
  } = useWorkspaceActions();
  const subject = chapter.title || "Untitled chapter";
  const mode = chapter.verification.mode;

  function rememberValue(
    event: FocusEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) {
    event.currentTarget.dataset.originalValue = event.currentTarget.value;
  }

  function logTextChange(
    event: FocusEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) {
    if (
      event.currentTarget.value === event.currentTarget.dataset.originalValue
    ) {
      return;
    }
    const message =
      mode === "auto"
        ? `Updated auto-test command: ${subject}`
        : mode === "ai"
          ? `Updated AI verification: ${subject}`
          : `Updated human verification: ${subject}`;
    logActivity(message, {
      chapterId: chapter.id,
      chapterName: chapter.title,
    });
    flushSave();
  }

  return (
    <section
      className="verification-section"
      aria-labelledby="verification-heading"
    >
      <div className="markdown-section-heading verification-heading">
        <span className="section-number" aria-hidden="true">
          02
        </span>
        <h2 id="verification-heading">Verification Rules</h2>
        <VerificationModeSwitch
          mode={mode}
          subject={subject}
          onChange={(nextMode) =>
            setChapterVerificationMode(chapter.id, nextMode)
          }
        />
      </div>
      <p className="verification-intro">
        How this chapter will be verified for {subject}.
      </p>
      {mode === "auto" && (
        <label className="verification-field">
          <span>Auto-test command</span>
          <input
            type="text"
            className="verification-command"
            aria-label={`Auto-test command for ${subject}`}
            placeholder="npm test login:test-ok"
            maxLength={MAX_AUTO_COMMAND}
            value={chapter.verification.auto.command}
            onFocus={rememberValue}
            onBlur={logTextChange}
            onChange={(event) =>
              setChapterVerificationText(chapter.id, "auto", event.target.value)
            }
          />
          {!chapter.verification.auto.command.trim() && (
            <span className="verification-hint">
              Add a command to count this chapter as covered.
            </span>
          )}
        </label>
      )}
      {mode === "human" && (
        <label className="verification-field">
          <span>How a person verifies this</span>
          <textarea
            rows={3}
            aria-label={`Human verification for ${subject}`}
            placeholder="Describe the manual check and expected result…"
            maxLength={MAX_HUMAN_INSTRUCTIONS}
            value={chapter.verification.human.instructions}
            onFocus={rememberValue}
            onBlur={logTextChange}
            onChange={(event) =>
              setChapterVerificationText(
                chapter.id,
                "human",
                event.target.value,
              )
            }
          />
        </label>
      )}
      {mode === "ai" && (
        <label className="verification-field">
          <span>Instructions for an AI verifier</span>
          <textarea
            rows={3}
            aria-label={`AI verification for ${subject}`}
            placeholder="Describe what the AI should inspect, run or report…"
            maxLength={MAX_AI_INSTRUCTIONS}
            value={chapter.verification.ai.instructions}
            onFocus={rememberValue}
            onBlur={logTextChange}
            onChange={(event) =>
              setChapterVerificationText(chapter.id, "ai", event.target.value)
            }
          />
        </label>
      )}
    </section>
  );
}

import {
  VerificationMode,
  verificationModeLabel,
} from "../domain/verification";

const MODES: VerificationMode[] = ["auto", "human", "ai"];

export interface VerificationModeSwitchProps {
  mode: VerificationMode;
  subject: string;
  onChange: (mode: VerificationMode) => void;
}

export function VerificationModeSwitch({
  mode,
  subject,
  onChange,
}: VerificationModeSwitchProps) {
  return (
    <div
      className="verification-mode-switch"
      role="radiogroup"
      aria-label={`Verification mode for ${subject || "Untitled chapter"}`}
    >
      {MODES.map((option) => {
        const text = verificationModeLabel(option);
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={mode === option}
            aria-label={`${text} verification`}
            className={mode === option ? "selected" : ""}
            onClick={() => onChange(option)}
          >
            {text}
          </button>
        );
      })}
    </div>
  );
}

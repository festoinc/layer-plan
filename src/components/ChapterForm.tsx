import { FormEvent } from "react";
import { Check, FileText, X } from "lucide-react";

export interface ChapterFormProps {
  title: string;
  onTitleChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}

export function ChapterForm({
  title,
  onTitleChange,
  onSubmit,
  onCancel,
}: ChapterFormProps) {
  return (
    <form className="chapter-form" onSubmit={onSubmit}>
      <FileText size={15} />
      <input
        autoFocus
        aria-label="New chapter title"
        placeholder="Chapter name…"
        value={title}
        onChange={(event) => onTitleChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onCancel();
          }
        }}
      />
      <button
        className="icon-button"
        type="submit"
        aria-label="Create chapter"
        disabled={!title.trim()}
      >
        <Check size={15} />
      </button>
      <button
        className="icon-button"
        type="button"
        aria-label="Cancel new chapter"
        onClick={onCancel}
      >
        <X size={14} />
      </button>
    </form>
  );
}

import {
  ComponentPropsWithoutRef,
  FocusEvent,
  KeyboardEvent,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export interface MarkdownContentProps extends ComponentPropsWithoutRef<"div"> {
  text: string;
  label?: string;
  placeholder?: string;
}

export function MarkdownContent({
  text,
  label,
  placeholder = "Nothing to preview yet.",
  ...props
}: MarkdownContentProps) {
  return (
    <div className="markdown-body" role="region" aria-label={label} {...props}>
      {text.trim() ? (
        <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
          {text}
        </ReactMarkdown>
      ) : (
        <p className="markdown-empty">{placeholder}</p>
      )}
    </div>
  );
}

export interface AutoTextareaProps extends ComponentPropsWithoutRef<"textarea"> {
  value: string;
}

export function AutoTextarea({ value, ...props }: AutoTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.style.height = "auto";
    ref.current.style.height = `${ref.current.scrollHeight}px`;
  }, [value]);
  return <textarea {...props} ref={ref} value={value} />;
}

export interface EditableMarkdownProps extends ComponentPropsWithoutRef<"textarea"> {
  value: string;
  previewLabel?: string;
  placeholder?: string;
  onBlur?: (event: FocusEvent<HTMLTextAreaElement>) => void;
  onFocus?: (event: FocusEvent<HTMLTextAreaElement>) => void;
}

export function EditableMarkdown({
  value,
  previewLabel,
  onBlur,
  ...props
}: EditableMarkdownProps) {
  const [editing, setEditing] = useState(false);
  // Keep long descriptions typeable: the preview may lag a frame behind the
  // textarea without blocking the input.
  const previewValue = useDeferredValue(value);

  if (editing) {
    return (
      <AutoTextarea
        {...props}
        value={value}
        autoFocus
        onBlur={(event) => {
          onBlur?.(event);
          setEditing(false);
        }}
        onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
          if (
            event.key === "Escape" ||
            (event.key === "Enter" && (event.metaKey || event.ctrlKey))
          ) {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
      />
    );
  }

  return (
    <MarkdownContent
      text={previewValue}
      label={previewLabel}
      placeholder={props.placeholder}
      tabIndex={0}
      title="Double-click to edit · Enter to edit with keyboard"
      onDoubleClick={(event) => {
        event.preventDefault();
        setEditing(true);
      }}
      onKeyDown={(event) => {
        if (
          event.target === event.currentTarget &&
          (event.key === "Enter" || event.key === "F2")
        ) {
          event.preventDefault();
          setEditing(true);
        }
      }}
    />
  );
}

import {
  FocusEvent,
  FormEvent,
  Fragment,
  useEffect,
  useRef,
  useState,
} from "react";
import { ChevronRight, Plus, Trash2, X } from "lucide-react";
import { AutoTextarea, EditableMarkdown } from "../Markdown";
import { Chapter } from "../domain/chapters";
import { criterionProgress } from "../domain/criteria";
import { useWorkspaceActions } from "../store/WorkspaceProvider";
import { VerificationRules } from "./VerificationRules";
import { DeleteChapterDialog } from "./DeleteChapterDialog";

export interface ChapterDeleteInfo {
  descendantCount: number;
  parentTitle?: string;
  linkedCriterionText?: string;
}

export interface ChapterEditorProps {
  chapter: Chapter;
  path: Chapter[];
  autoFocusTitle: boolean;
  onAutoFocused: () => void;
  onSelectChapter: (id: string) => void;
  onRevealChildren: (id: string) => void;
  deleteInfo: ChapterDeleteInfo;
  onDeleteChapter: () => void;
}

export function ChapterEditor({
  chapter,
  path,
  autoFocusTitle,
  onAutoFocused,
  onSelectChapter,
  onRevealChildren,
  deleteInfo,
  onDeleteChapter,
}: ChapterEditorProps) {
  const {
    setChapterField,
    addCriterion,
    setCriterionText,
    toggleCriterion,
    removeCriterion,
    logActivity,
    flushSave,
  } = useWorkspaceActions();
  const titleRef = useRef<HTMLInputElement | null>(null);
  const [newCriterion, setNewCriterion] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const progress = criterionProgress(chapter);
  const showVerification = chapter.parentId !== null;

  useEffect(() => {
    if (!autoFocusTitle) return;
    if (document.activeElement !== titleRef.current) {
      titleRef.current?.focus();
    }
    onAutoFocused();
  }, [autoFocusTitle, chapter.id, onAutoFocused]);

  function rememberValue(
    event: FocusEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) {
    event.currentTarget.dataset.originalValue = event.currentTarget.value;
  }

  function logFieldChange(
    event: FocusEvent<HTMLInputElement | HTMLTextAreaElement>,
    message: string,
    target: Chapter = chapter,
  ) {
    if (
      event.currentTarget.value === event.currentTarget.dataset.originalValue
    ) {
      return;
    }
    logActivity(message, {
      chapterId: target.id,
      chapterName: target.title,
    });
    flushSave();
  }

  function submitCriterion(event: FormEvent) {
    event.preventDefault();
    if (!newCriterion.trim()) return;
    addCriterion(chapter.id, newCriterion);
    onRevealChildren(chapter.id);
    setNewCriterion("");
  }

  return (
    <article className="chapter-editor" key={chapter.id}>
      <div className="document-header">
        <nav className="breadcrumbs" aria-label="Chapter path">
          {path.map((part, index) => (
            <Fragment key={part.id}>
              {index > 0 && <ChevronRight size={12} />}
              <button
                aria-current={index === path.length - 1 ? "page" : undefined}
                onClick={() => onSelectChapter(part.id)}
              >
                {part.title || "Untitled chapter"}
              </button>
            </Fragment>
          ))}
        </nav>
        <div className="document-options">
          <button
            type="button"
            className="icon-button delete-chapter-button"
            aria-label={`Delete chapter: ${chapter.title || "Untitled chapter"}`}
            title="Delete chapter"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 size={16} />
          </button>
          <label
            className="final-level"
            title="Keep new criteria in this document without automatically creating subdocuments"
          >
            <input
              type="checkbox"
              checked={Boolean(chapter.finalLevel)}
              onChange={(event) =>
                setChapterField(chapter.id, "finalLevel", event.target.checked)
              }
            />
            Final level
          </label>
        </div>
      </div>
      <input
        ref={titleRef}
        className="chapter-title"
        aria-label="Chapter title"
        placeholder="Untitled chapter"
        value={chapter.title}
        onFocus={rememberValue}
        onChange={(event) =>
          setChapterField(chapter.id, "title", event.target.value)
        }
        onBlur={(event) => {
          logFieldChange(event, "Updated chapter title");
          if (!chapter.title.trim()) {
            setChapterField(chapter.id, "title", "Untitled chapter");
          }
        }}
      />
      <section
        className="description-section"
        aria-labelledby="description-heading"
      >
        <div className="markdown-section-heading">
          <span className="section-number" aria-hidden="true">
            01
          </span>
          <h2 id="description-heading">Description</h2>
        </div>
        <EditableMarkdown
          previewLabel="Description preview"
          aria-label="Description"
          placeholder="What should this part of the project do?"
          value={chapter.description}
          onFocus={rememberValue}
          onBlur={(event) => logFieldChange(event, "Updated description")}
          onChange={(event) =>
            setChapterField(chapter.id, "description", event.target.value)
          }
          rows={3}
        />
      </section>
      {showVerification && <VerificationRules chapter={chapter} />}
      <section className="criteria-section" aria-labelledby="criteria-heading">
        <div className="criteria-heading">
          <span className="section-number" aria-hidden="true">
            {showVerification ? "03" : "02"}
          </span>
          <h2 id="criteria-heading">Success criteria</h2>
          {progress.total > 0 && (
            <div className="completion-summary">
              <span>
                {progress.done} of {progress.total} complete
              </span>
              <progress
                aria-label="Success criteria completion"
                value={progress.done}
                max={progress.total}
              />
            </div>
          )}
        </div>
        <ul className="criteria-list">
          {chapter.criteria.map((item) => (
            <li
              className={`criterion ${item.checked ? "complete" : ""}`}
              key={item.id}
            >
              <input
                type="checkbox"
                aria-label={`Complete: ${item.text || "Untitled criterion"}`}
                checked={item.checked}
                onChange={() => toggleCriterion(chapter.id, item.id)}
              />
              <EditableMarkdown
                previewLabel="Criterion preview"
                rows={1}
                className="criterion-text"
                aria-label="Criterion text"
                placeholder="Describe a successful outcome…"
                value={item.text}
                onFocus={rememberValue}
                onBlur={(event) =>
                  logFieldChange(
                    event,
                    `Updated criterion: ${event.currentTarget.value}`,
                    chapter,
                  )
                }
                onChange={(event) =>
                  setCriterionText(chapter.id, item.id, event.target.value)
                }
              />
              <button
                className="icon-button remove-criterion"
                aria-label={`Remove criterion: ${item.text || "Untitled criterion"}`}
                title="Remove criterion"
                onClick={() => removeCriterion(chapter.id, item.id)}
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
        <form className="add-criterion" onSubmit={submitCriterion}>
          <Plus size={17} />
          <AutoTextarea
            rows={1}
            aria-label="New success criterion"
            placeholder="Add a success criterion…"
            value={newCriterion}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                submitCriterion(event);
              }
            }}
            onChange={(event) => setNewCriterion(event.target.value)}
          />
          {newCriterion.trim() && (
            <button type="submit">
              Add <span>↵</span>
            </button>
          )}
        </form>
      </section>
      {confirmDelete && (
        <DeleteChapterDialog
          title={chapter.title || "Untitled chapter"}
          descendantCount={deleteInfo.descendantCount}
          parentTitle={deleteInfo.parentTitle}
          linkedCriterionText={deleteInfo.linkedCriterionText}
          onClose={() => setConfirmDelete(false)}
          onDelete={() => {
            setConfirmDelete(false);
            onDeleteChapter();
          }}
        />
      )}
    </article>
  );
}

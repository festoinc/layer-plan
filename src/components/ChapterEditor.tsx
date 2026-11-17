import {
  FocusEvent,
  FormEvent,
  Fragment,
  useEffect,
  useRef,
  useState,
} from "react";
import { ChevronRight, CornerDownRight, Plus, Trash2, X } from "lucide-react";
import { AutoTextarea, EditableMarkdown } from "../Markdown";
import { Chapter, collectSubtreeIds } from "../domain/chapters";
import { criterionProgress, deriveCriterionTitle } from "../domain/criteria";
import {
  useWorkspaceActions,
  useWorkspaceState,
} from "../store/WorkspaceProvider";
import { ChapterCommits } from "./ChapterCommits";
import { VerificationRules } from "./VerificationRules";
import { DeleteChapterDialog } from "./DeleteChapterDialog";
import { DeleteCriterionDialog } from "./DeleteCriterionDialog";

export interface ChapterDeleteInfo {
  descendantCount: number;
  parentTitle?: string;
  linkedCriterionText?: string;
}

/**
 * A mirrored pair has no content of its own, so removing it needs no
 * confirmation. Anything a person would miss triggers the dialog.
 */
function isTrivialSubchapter(
  subchapter: Chapter,
  criterionText: string,
): boolean {
  return (
    subchapter.childIds.length === 0 &&
    subchapter.criteria.length === 0 &&
    subchapter.commits.length === 0 &&
    subchapter.verification.mode === "human" &&
    !subchapter.verification.auto.command.trim() &&
    !subchapter.verification.human.instructions.trim() &&
    !subchapter.verification.ai.instructions.trim() &&
    subchapter.description === criterionText &&
    subchapter.title === deriveCriterionTitle(criterionText)
  );
}

interface PendingCriterionDelete {
  criterionId: string;
  text: string;
  subchapter: Chapter;
  descendantCount: number;
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
    addCommit,
    removeCommit,
    setCriterionText,
    toggleCriterion,
    removeCriterion,
    logActivity,
    flushSave,
  } = useWorkspaceActions();
  const state = useWorkspaceState();
  const titleRef = useRef<HTMLInputElement | null>(null);
  const [newCriterion, setNewCriterion] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pendingCriterionDelete, setPendingCriterionDelete] =
    useState<PendingCriterionDelete | null>(null);
  const progress = criterionProgress(chapter);
  const showVerification = chapter.parentId !== null;
  const parentChapter = chapter.parentId
    ? (state.chapters.byId[chapter.parentId] ?? null)
    : null;
  const sourceCriterion = parentChapter?.criteria.find(
    (item) => item.chapterId === chapter.id,
  );

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

  function requestRemoveCriterion(criterionId: string, text: string) {
    const criterion = chapter.criteria.find((item) => item.id === criterionId);
    const subchapter = criterion?.chapterId
      ? (state.chapters.byId[criterion.chapterId] ?? null)
      : null;
    if (subchapter && !isTrivialSubchapter(subchapter, text)) {
      setPendingCriterionDelete({
        criterionId,
        text,
        subchapter,
        descendantCount: collectSubtreeIds(state.chapters, subchapter.id)
          .length,
      });
      return;
    }
    removeCriterion(chapter.id, criterionId);
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
      {sourceCriterion && parentChapter && (
        <p className="criterion-source-note">
          Created from the success criterion in{" "}
          <button
            type="button"
            className="inline-link"
            onClick={() => onSelectChapter(parentChapter.id)}
          >
            {parentChapter.title || "Untitled chapter"}
          </button>
          . Edit either side and both stay in sync.
        </p>
      )}
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
      <ChapterCommits
        commits={chapter.commits}
        onAdd={(hash) => addCommit(chapter.id, hash)}
        onRemove={(hash) => removeCommit(chapter.id, hash)}
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
          {chapter.criteria.map((item) => {
            const linkedSubchapter = item.chapterId
              ? (state.chapters.byId[item.chapterId] ?? null)
              : null;
            return (
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
                {linkedSubchapter && (
                  <button
                    type="button"
                    className="icon-button criterion-link"
                    aria-label={`Open subchapter: ${linkedSubchapter.title || "Untitled chapter"}`}
                    title="Open subchapter"
                    onClick={() => onSelectChapter(linkedSubchapter.id)}
                  >
                    <CornerDownRight size={14} />
                  </button>
                )}
                <button
                  className="icon-button remove-criterion"
                  aria-label={`Remove criterion: ${item.text || "Untitled criterion"}`}
                  title={
                    linkedSubchapter
                      ? "Remove criterion and subchapter"
                      : "Remove criterion"
                  }
                  onClick={() => requestRemoveCriterion(item.id, item.text)}
                >
                  <X size={14} />
                </button>
              </li>
            );
          })}
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
      {pendingCriterionDelete && (
        <DeleteCriterionDialog
          criterionTitle={
            deriveCriterionTitle(pendingCriterionDelete.text) ||
            "Untitled criterion"
          }
          subchapterTitle={
            pendingCriterionDelete.subchapter.title || "Untitled chapter"
          }
          descendantCount={pendingCriterionDelete.descendantCount}
          parentTitle={chapter.title || "Untitled chapter"}
          onClose={() => setPendingCriterionDelete(null)}
          onDelete={() => {
            const criterionId = pendingCriterionDelete.criterionId;
            setPendingCriterionDelete(null);
            removeCriterion(chapter.id, criterionId);
            flushSave();
          }}
        />
      )}
    </article>
  );
}

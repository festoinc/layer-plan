import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Layers,
  Plus,
  ChevronDown,
  ChevronRight,
  Check,
  X,
  FileText,
  Menu,
  ChartNoAxesColumnIncreasing,
  Clock3,
  Folder,
  CircleCheck,
} from "lucide-react";
import { initialChapters, findChapter, updateChapter } from "./data";
import { AutoTextarea, EditableMarkdown } from "./Markdown";
import "./styles.css";

const STORAGE = "layers-chapters-v2";
function loadWorkspace() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE));
    if (Array.isArray(saved?.chapters) && saved.chapters.length) return saved;
  } catch {
    /* Start with sample chapters if storage is unavailable. */
  }
  return { chapters: initialChapters, selectedId: "password-reset" };
}
const initialWorkspace = loadWorkspace();

function App() {
  const [chapters, setChapters] = useState(initialWorkspace.chapters);
  const [selectedId, setSelectedId] = useState(initialWorkspace.selectedId);
  const [collapsed, setCollapsed] = useState(new Set());
  const [creating, setCreating] = useState(null);
  const [chapterTitle, setChapterTitle] = useState("");
  const [newCriterion, setNewCriterion] = useState("");
  const [navOpen, setNavOpen] = useState(false);
  const [saved, setSaved] = useState(true);
  const [view, setView] = useState("Specifications");
  const [events, setEvents] = useState(initialWorkspace.events || []);
  const found =
    findChapter(chapters, selectedId) || findChapter(chapters, chapters[0].id);
  const { chapter, path } = found;

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE,
        JSON.stringify({ chapters, selectedId, events }),
      );
      setSaved(true);
    } catch {
      setSaved(false);
    }
  }, [chapters, selectedId, events]);

  function logActivity(
    message,
    chapterId = chapter.id,
    chapterName = chapter.title,
  ) {
    setEvents((previous) =>
      [
        {
          id: crypto.randomUUID(),
          message,
          chapterId,
          chapterName,
          time: new Date().toISOString(),
        },
        ...previous,
      ].slice(0, 100),
    );
  }
  function rememberValue(event) {
    event.currentTarget.dataset.originalValue = event.currentTarget.value;
  }
  function logFieldChange(event, message) {
    if (event.currentTarget.value !== event.currentTarget.dataset.originalValue)
      logActivity(message);
  }
  function edit(transform, message) {
    setChapters((previous) => updateChapter(previous, chapter.id, transform));
    if (message) logActivity(message);
  }
  function selectChapter(id) {
    setView("Specifications");
    setSelectedId(id);
    setNewCriterion("");
    setNavOpen(false);
  }
  function startChapter(parentId = null) {
    setView("Specifications");
    setCreating({ parentId });
    setChapterTitle("");
    if (parentId)
      setCollapsed((previous) => {
        const next = new Set(previous);
        next.delete(parentId);
        return next;
      });
  }
  function createChapter(event) {
    event.preventDefault();
    const title = chapterTitle.trim();
    if (!title) return;
    const next = {
      id: crypto.randomUUID(),
      title,
      description: "",
      finalLevel: false,
      criteria: [],
      children: [],
    };
    setChapters((previous) =>
      creating.parentId
        ? updateChapter(previous, creating.parentId, (parent) => ({
            ...parent,
            children: [...parent.children, next],
          }))
        : [...previous, next],
    );
    setCreating(null);
    setChapterTitle("");
    logActivity(
      creating.parentId ? "Created subchapter" : "Created chapter",
      next.id,
      next.title,
    );
    selectChapter(next.id);
  }
  function toggleChapter(id) {
    setCollapsed((previous) => {
      const next = new Set(previous);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function addCriterion(event) {
    event.preventDefault();
    const text = newCriterion.trim();
    if (!text) return;
    const subchapter = chapter.finalLevel
      ? null
      : {
          id: crypto.randomUUID(),
          title:
            text
              .split(/\r?\n/)[0]
              .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/, "")
              .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
              .replace(/\*\*|__|~~|`|\*/g, "")
              .trim() || "Untitled chapter",
          description: text,
          finalLevel: false,
          criteria: [],
          children: [],
        };
    const criterion = {
      id: crypto.randomUUID(),
      text,
      checked: false,
      ...(subchapter ? { chapterId: subchapter.id } : {}),
    };
    edit(
      (current) => ({
        ...current,
        criteria: [...current.criteria, criterion],
        children: subchapter
          ? [...current.children, subchapter]
          : current.children,
      }),
      `Added criterion: ${text}`,
    );
    if (subchapter) {
      logActivity(
        "Created subchapter from success criterion",
        subchapter.id,
        subchapter.title,
      );
      setCollapsed((previous) => {
        const next = new Set(previous);
        next.delete(chapter.id);
        return next;
      });
    }
    setNewCriterion("");
  }
  function chapterForm() {
    return (
      <form className="chapter-form" onSubmit={createChapter}>
        <FileText size={15} />
        <input
          autoFocus
          aria-label="New chapter title"
          placeholder="Chapter name…"
          value={chapterTitle}
          onChange={(event) => setChapterTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setCreating(null);
          }}
        />
        <button
          className="icon-button"
          type="submit"
          aria-label="Create chapter"
          disabled={!chapterTitle.trim()}
        >
          <Check size={15} />
        </button>
        <button
          className="icon-button"
          type="button"
          aria-label="Cancel new chapter"
          onClick={() => setCreating(null)}
        >
          <X size={14} />
        </button>
      </form>
    );
  }
  function renderChapter(item) {
    const isOpen = !collapsed.has(item.id);
    const hasChildren =
      item.children.length > 0 || creating?.parentId === item.id;
    return (
      <li key={item.id} className="chapter-item">
        <div
          className={`chapter-row ${view === "Specifications" && chapter.id === item.id ? "selected" : ""}`}
        >
          {hasChildren ? (
            <button
              className="tree-toggle"
              aria-label={`${isOpen ? "Collapse" : "Expand"} ${item.title}`}
              aria-expanded={isOpen}
              onClick={() => toggleChapter(item.id)}
            >
              {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          ) : (
            <span className="tree-toggle tree-leaf">
              <FileText size={14} />
            </span>
          )}
          {hasChildren && <Folder className="chapter-folder" size={17} />}
          <button
            className="chapter-link"
            aria-current={
              view === "Specifications" && chapter.id === item.id
                ? "page"
                : undefined
            }
            onClick={() => selectChapter(item.id)}
          >
            {item.title || "Untitled chapter"}
          </button>
          <button
            className="chapter-add icon-button"
            aria-label={`Add subchapter to ${item.title || "Untitled chapter"}`}
            title="Add subchapter"
            onClick={() => startChapter(item.id)}
          >
            <Plus size={14} />
          </button>
        </div>
        {hasChildren && isOpen && (
          <ul className="chapter-children">
            {item.children.map(renderChapter)}
            {creating?.parentId === item.id && <li>{chapterForm()}</li>}
          </ul>
        )}
      </li>
    );
  }

  return (
    <div className="app">
      {navOpen && (
        <button
          className="sidebar-backdrop"
          aria-label="Close chapter navigation"
          onClick={() => setNavOpen(false)}
        />
      )}
      <aside className={`sidebar ${navOpen ? "open" : ""}`}>
        <div className="brand">
          <Layers size={27} />
          <span>Layers</span>
          <button
            className="icon-button close-nav"
            aria-label="Close navigation"
            onClick={() => setNavOpen(false)}
          >
            <X size={19} />
          </button>
        </div>
        <div className="project-label">
          <span className="project-icon">W</span>
          <div>
            <strong>Website project</strong>
            <span>Project specification</span>
          </div>
        </div>
        <nav className="workspace-navigation" aria-label="Workspace">
          {[
            ["Specifications", FileText],
            ["Test coverage", ChartNoAxesColumnIncreasing],
            ["Activity", Clock3],
          ].map(([name, Icon]) => (
            <button
              key={name}
              className={view === name ? "active" : ""}
              aria-current={view === name ? "page" : undefined}
              onClick={() => {
                setView(name);
                setCreating(null);
                setNavOpen(false);
              }}
            >
              <Icon size={16} />
              {name}
              {name === "Test coverage" && (
                <span className="soon-badge" aria-hidden="true">
                  Soon
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="chapters-heading">
          <h2>Chapters</h2>
        </div>
        <nav className="chapter-navigation" aria-label="Chapters">
          <ul className="chapter-tree">
            {chapters.map(renderChapter)}
            {creating?.parentId === null && <li>{chapterForm()}</li>}
          </ul>
        </nav>
        <button className="new-chapter" onClick={() => startChapter()}>
          <Plus size={16} />
          New chapter
        </button>
        <div className="sidebar-footer">
          <span className="local-dot" />
          {saved ? "Saved locally" : "Local workspace"}
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <button
            className="icon-button open-nav"
            aria-label="Open chapters"
            onClick={() => setNavOpen(true)}
          >
            <Menu size={19} />
          </button>
          <span>Website project</span>
          <ChevronRight size={13} />
          <span>{view === "Specifications" ? path[0].title : view}</span>
          <div className="save-status" role="status">
            {saved ? (
              <>
                <CircleCheck size={16} />
                All changes saved
              </>
            ) : (
              "Changes are not saved"
            )}
          </div>
        </header>
        {view === "Specifications" && (
          <article className="chapter-editor" key={chapter.id}>
            <div className="document-header">
              <nav className="breadcrumbs" aria-label="Chapter path">
                {path.map((part, index) => (
                  <React.Fragment key={part.id}>
                    {index > 0 && <ChevronRight size={12} />}
                    <button
                      aria-current={
                        index === path.length - 1 ? "page" : undefined
                      }
                      onClick={() => selectChapter(part.id)}
                    >
                      {part.title || "Untitled chapter"}
                    </button>
                  </React.Fragment>
                ))}
              </nav>
              <div className="document-options">
                <label
                  className="final-level"
                  title="Keep new criteria in this document without automatically creating subdocuments"
                >
                  <input
                    type="checkbox"
                    checked={Boolean(chapter.finalLevel)}
                    onChange={(event) =>
                      edit(
                        (current) => ({
                          ...current,
                          finalLevel: event.target.checked,
                        }),
                        event.target.checked
                          ? "Marked chapter as final level"
                          : "Turned off final level",
                      )
                    }
                  />
                  Final level
                </label>
              </div>
            </div>
            <input
              className="chapter-title"
              aria-label="Chapter title"
              placeholder="Untitled chapter"
              value={chapter.title}
              onFocus={rememberValue}
              onChange={(event) =>
                edit((current) => ({ ...current, title: event.target.value }))
              }
              onBlur={(event) => {
                logFieldChange(event, "Updated chapter title");
                if (!chapter.title.trim())
                  edit((current) => ({
                    ...current,
                    title: "Untitled chapter",
                  }));
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
                  edit((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                rows={3}
              />
            </section>
            <section
              className="criteria-section"
              aria-labelledby="criteria-heading"
            >
              <div className="criteria-heading">
                <span className="section-number" aria-hidden="true">
                  02
                </span>
                <h2 id="criteria-heading">Success criteria</h2>
                {chapter.criteria.length > 0 && (
                  <div className="completion-summary">
                    <span>
                      {chapter.criteria.filter((item) => item.checked).length}{" "}
                      of {chapter.criteria.length} complete
                    </span>
                    <progress
                      aria-label="Success criteria completion"
                      value={
                        chapter.criteria.filter((item) => item.checked).length
                      }
                      max={chapter.criteria.length}
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
                      onChange={() =>
                        edit(
                          (current) => ({
                            ...current,
                            criteria: current.criteria.map((criterion) =>
                              criterion.id === item.id
                                ? { ...criterion, checked: !criterion.checked }
                                : criterion,
                            ),
                          }),
                          `${item.checked ? "Unchecked" : "Completed"} criterion: ${item.text}`,
                        )
                      }
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
                        )
                      }
                      onChange={(event) =>
                        edit((current) => ({
                          ...current,
                          criteria: current.criteria.map((criterion) =>
                            criterion.id === item.id
                              ? { ...criterion, text: event.target.value }
                              : criterion,
                          ),
                        }))
                      }
                    />
                    <button
                      className="icon-button remove-criterion"
                      aria-label={`Remove criterion: ${item.text || "Untitled criterion"}`}
                      title="Remove criterion"
                      onClick={() =>
                        edit(
                          (current) => ({
                            ...current,
                            criteria: current.criteria.filter(
                              (criterion) => criterion.id !== item.id,
                            ),
                          }),
                          `Removed criterion: ${item.text}`,
                        )
                      }
                    >
                      <X size={14} />
                    </button>
                  </li>
                ))}
              </ul>
              <form className="add-criterion" onSubmit={addCriterion}>
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
                      addCriterion(event);
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
          </article>
        )}
        {view === "Test coverage" && (
          <section className="chapter-editor overview-page">
            <h1>Test coverage</h1>
            <div className="development-state">
              <span className="development-icon">
                <ChartNoAxesColumnIncreasing size={28} />
              </span>
              <span className="development-badge">In development</span>
              <h2>Test coverage is on its way</h2>
              <p>
                This page will show which success criteria are covered by
                automated tests.
              </p>
            </div>
          </section>
        )}
        {view === "Activity" && (
          <section className="chapter-editor overview-page">
            <h1>Activity</h1>
            <p className="overview-description">
              Changes to your chapters and success criteria.
            </p>
            {events.length ? (
              <ul className="activity-list">
                {events.map((event) => (
                  <li key={event.id}>
                    <span className="activity-marker" />
                    <div>
                      <p>{event.message}</p>
                      <button onClick={() => selectChapter(event.chapterId)}>
                        {event.chapterName || "Untitled chapter"}
                      </button>
                    </div>
                    <time
                      dateTime={event.time}
                      title={new Date(event.time).toLocaleString()}
                    >
                      {new Date(event.time).toLocaleString([], {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="activity-empty">
                <Clock3 size={25} />
                <h2>No activity yet</h2>
                <p>
                  Create a chapter or edit a checklist to see your changes here.
                </p>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);

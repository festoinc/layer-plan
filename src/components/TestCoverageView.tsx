import { useState } from "react";
import {
  ChartNoAxesColumnIncreasing,
  CircleCheck,
  Circle,
  ArrowRight,
} from "lucide-react";
import {
  getCoverageRows,
  summarizeVerification,
  verificationModeLabel,
} from "../domain/verification";
import { useProjects } from "../store/ProjectsProvider";
import { useWorkspaceState } from "../store/WorkspaceProvider";

export interface TestCoverageViewProps {
  onSelectChapter: (id: string) => void;
}

export default function TestCoverageView({
  onSelectChapter,
}: TestCoverageViewProps) {
  const state = useWorkspaceState();
  const { getProjectGuidelines, updateProject } = useProjects();
  const guidelines = getProjectGuidelines(state.projectId);
  const summary = summarizeVerification(state.chapters);
  const rows = getCoverageRows(state.chapters);
  const [guidelinesError, setGuidelinesError] = useState("");

  function saveGuidelines(value: string) {
    if (value === guidelines) return;
    const result = updateProject(state.projectId, { testGuidelines: value });
    setGuidelinesError(
      result.ok
        ? ""
        : result.issues.join(" ") || "Guidelines could not be saved.",
    );
  }

  return (
    <section className="chapter-editor overview-page coverage-page">
      <h1>Test coverage</h1>
      <p className="overview-description">
        Automated tests declared on subchapters. Only chapters with a parent are
        included.
      </p>

      <section
        className="coverage-guidelines"
        aria-labelledby="guidelines-heading"
      >
        <div className="coverage-section-heading">
          <h2 id="guidelines-heading">Test guidelines</h2>
        </div>
        <label className="coverage-guidelines-field">
          <span>Shared instructions for human and AI testers</span>
          <textarea
            key={guidelines}
            defaultValue={guidelines}
            rows={4}
            placeholder="Add commands, test accounts and reporting expectations…"
            onBlur={(event) => saveGuidelines(event.target.value)}
          />
        </label>
        <p className="field-hint">
          Saved automatically when you leave the field. Included in project
          exports.
        </p>
        {guidelinesError && (
          <p className="form-error" role="alert">
            {guidelinesError}
          </p>
        )}
      </section>

      {summary.total === 0 ? (
        <div className="development-state coverage-empty">
          <span className="development-icon">
            <ChartNoAxesColumnIncreasing size={28} />
          </span>
          <h2>No verification chapters yet</h2>
          <p>
            Add a subchapter to give it a verification rule. Root chapters do
            not have verification rules.
          </p>
        </div>
      ) : (
        <>
          <section
            className="coverage-summary"
            aria-labelledby="coverage-summary-heading"
          >
            <div className="coverage-score">
              <strong>{summary.percent}%</strong>
              <div>
                <h2 id="coverage-summary-heading">
                  {summary.automated} of {summary.total} eligible chapters
                  covered
                </h2>
                <p>Only Auto-test chapters with a command count as covered.</p>
              </div>
            </div>
            <progress
              aria-label="Automated test coverage"
              value={summary.automated}
              max={summary.total}
            />
            <dl className="coverage-counts">
              <div>
                <dt>Auto-test</dt>
                <dd>{summary.automated}</dd>
              </div>
              <div>
                <dt>Human</dt>
                <dd>{summary.human}</dd>
              </div>
              <div>
                <dt>AI</dt>
                <dd>{summary.ai}</dd>
              </div>
              <div>
                <dt>Command missing</dt>
                <dd>{summary.incompleteAuto}</dd>
              </div>
            </dl>
          </section>

          <section
            className="coverage-criteria"
            aria-labelledby="criteria-coverage-heading"
          >
            <h2 id="criteria-coverage-heading">Eligible chapters</h2>
            <ul className="coverage-list">
              {rows.map((row) => (
                <li
                  className={`coverage-row coverage-mode-${row.mode} ${row.automated ? "covered" : "uncovered"}`}
                  key={row.chapterId}
                >
                  <span className="visually-hidden">
                    {row.automated ? "Covered" : "Not covered"}
                  </span>
                  <span className="coverage-check" aria-hidden="true">
                    {row.automated ? (
                      <CircleCheck size={17} />
                    ) : (
                      <Circle size={17} />
                    )}
                  </span>
                  <div className="coverage-row-main">
                    <button
                      type="button"
                      className="coverage-criterion-text"
                      onClick={() => onSelectChapter(row.chapterId)}
                    >
                      {row.chapterTitle}
                      <ArrowRight size={13} />
                    </button>
                    <span className="coverage-chapter-path">
                      {row.chapterPath}
                    </span>
                    <span className="coverage-chapter-progress">
                      {row.checkedCount}/{row.criterionCount} criteria complete
                    </span>
                    {row.automated && (
                      <code className="coverage-command">{row.command}</code>
                    )}
                    {row.incompleteAuto && (
                      <span className="coverage-missing-command">
                        Auto-test selected, but no command yet.
                      </span>
                    )}
                  </div>
                  <span className={`coverage-badge coverage-badge-${row.mode}`}>
                    {verificationModeLabel(row.mode)}
                  </span>
                  <span
                    className={`coverage-status ${row.automated ? "covered" : "uncovered"}`}
                  >
                    {row.automated ? "Covered" : "Not covered"}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </section>
  );
}

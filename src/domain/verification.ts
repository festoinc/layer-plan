import { Chapter, ChapterDocument, getPath, walkChapters } from "./chapters";
import type { VerificationMode } from "./verificationTypes";

export * from "./verificationTypes";

export function isVerificationEligible(chapter: Chapter): boolean {
  return chapter.parentId !== null;
}

export function isAutomated(chapter: Chapter): boolean {
  return (
    chapter.verification.mode === "auto" &&
    chapter.verification.auto.command.trim().length > 0
  );
}

export function getVerificationChapters(document: ChapterDocument): Chapter[] {
  return walkChapters(document).filter(isVerificationEligible);
}

export interface VerificationSummary {
  total: number;
  automated: number;
  human: number;
  ai: number;
  incompleteAuto: number;
  percent: number;
}

export function summarizeVerification(
  document: ChapterDocument,
): VerificationSummary {
  let total = 0;
  let automated = 0;
  let human = 0;
  let ai = 0;
  let incompleteAuto = 0;

  for (const chapter of getVerificationChapters(document)) {
    total += 1;
    if (isAutomated(chapter)) {
      automated += 1;
    } else if (chapter.verification.mode === "auto") {
      incompleteAuto += 1;
    } else if (chapter.verification.mode === "human") {
      human += 1;
    } else {
      ai += 1;
    }
  }

  return {
    total,
    automated,
    human,
    ai,
    incompleteAuto,
    percent: total ? Math.round((automated / total) * 100) : 0,
  };
}

export interface CoverageRow {
  chapterId: string;
  chapterTitle: string;
  chapterPath: string;
  mode: VerificationMode;
  command: string;
  automated: boolean;
  incompleteAuto: boolean;
  criterionCount: number;
  checkedCount: number;
  commits: string[];
}

export function getCoverageRows(document: ChapterDocument): CoverageRow[] {
  return getVerificationChapters(document).map((chapter) => ({
    chapterId: chapter.id,
    chapterTitle: chapter.title || "Untitled chapter",
    chapterPath: getPath(document, chapter.id)
      .map((part) => part.title || "Untitled chapter")
      .join(" › "),
    mode: chapter.verification.mode,
    command: chapter.verification.auto.command,
    automated: isAutomated(chapter),
    incompleteAuto:
      chapter.verification.mode === "auto" &&
      !chapter.verification.auto.command.trim(),
    criterionCount: chapter.criteria.length,
    checkedCount: chapter.criteria.filter((criterion) => criterion.checked)
      .length,
    commits: [...chapter.commits],
  }));
}

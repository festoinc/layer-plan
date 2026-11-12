import { ApiError } from "./errors";

export function parseIfMatch(header: string | undefined): number {
  if (!header) {
    throw new ApiError(
      428,
      "precondition_required",
      "This write requires an If-Match header with the current revision.",
    );
  }

  const value = header.trim();
  const match = /^(?:"(\d+)"|(\d+))$/.exec(value);
  if (!match) {
    throw new ApiError(
      400,
      "invalid_if_match",
      'If-Match must be a quoted revision such as "12".',
    );
  }

  const revision = Number(match[1] ?? match[2]);
  if (!Number.isInteger(revision) || revision < 0) {
    throw new ApiError(400, "invalid_if_match", "If-Match is invalid.");
  }
  return revision;
}

export function formatEtag(revision: number): string {
  return `"${revision}"`;
}

export function assertRevision(
  resource: string,
  expected: number,
  current: number,
) {
  if (expected !== current) {
    throw new ApiError(
      412,
      "revision_conflict",
      `The ${resource} changed since it was loaded.`,
      { currentRevision: current },
    );
  }
}

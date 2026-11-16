import { describe, expect, it } from "vitest";
import {
  COMMIT_HASH_PATTERN,
  MAX_COMMITS_PER_CHAPTER,
  addCommit,
  hasCommit,
  normalizeCommitHash,
  normalizeCommits,
  removeCommit,
} from "../../src/domain/commits.js";
import { normalizeDocument } from "../../src/domain/schema.js";

const short = "4f2a9c1";
const full = "9d0be7a1c2f34d5e6f708192a3b4c5d6e7f80912";

describe("commit hashes", () => {
  it("accepts 7 to 40 hexadecimal characters and lowercases them", () => {
    expect(normalizeCommitHash(short)).toBe(short);
    expect(normalizeCommitHash("  ABC1234  ")).toBe("abc1234");
    expect(normalizeCommitHash(full)).toBe(full);
    expect(normalizeCommitHash("A".repeat(40))).toBe("a".repeat(40));
    expect(COMMIT_HASH_PATTERN.test(full)).toBe(true);
  });

  it.each([
    "",
    "   ",
    "abc123",
    "a".repeat(41),
    "not-a-hash",
    "4f2a9c1z",
    "0x4f2a9c1",
  ])("rejects %j", (value) => {
    expect(normalizeCommitHash(value)).toBeNull();
  });

  it("rejects non-string values", () => {
    expect(normalizeCommitHash(null)).toBeNull();
    expect(normalizeCommitHash(1234567)).toBeNull();
  });
});

describe("commit lists", () => {
  it("defaults missing lists to empty", () => {
    expect(normalizeCommits(undefined)).toEqual([]);
    expect(normalizeCommits(null)).toEqual([]);
    expect(normalizeCommits([])).toEqual([]);
  });

  it("keeps valid entries in order, lowercased and deduplicated", () => {
    const issues = [];
    expect(
      normalizeCommits([short, "ABC1234", "bad", full, short, 42], { issues }),
    ).toEqual([short, "abc1234", full]);
    expect(issues).toHaveLength(3);
  });

  it("repairs a non-array value", () => {
    const issues = [];
    expect(normalizeCommits("4f2a9c1", { issues })).toEqual([]);
    expect(issues.join(" ")).toContain("not an array");
  });

  it("caps a list at the per-chapter maximum", () => {
    const values = Array.from(
      { length: MAX_COMMITS_PER_CHAPTER + 5 },
      (_, index) => index.toString(16).padStart(7, "0"),
    );
    const issues = [];
    const commits = normalizeCommits(values, { issues });
    expect(commits).toHaveLength(MAX_COMMITS_PER_CHAPTER);
    expect(commits[0]).toBe(values[0]);
    expect(issues.join(" ")).toContain(`${MAX_COMMITS_PER_CHAPTER}`);
  });

  it("adds newest first and ignores invalid, duplicate and over-limit adds", () => {
    const base = [full];
    expect(addCommit(base, "ABC1234")).toEqual(["abc1234", full]);
    expect(addCommit(base, full)).toBe(base);
    expect(addCommit(base, "nope")).toBe(base);
    expect(base).toEqual([full]);

    const fullList = Array.from(
      { length: MAX_COMMITS_PER_CHAPTER },
      (_, index) => index.toString(16).padStart(7, "0"),
    );
    expect(addCommit(fullList, short)).toBe(fullList);
  });

  it("removes a hash and no-ops for unknown values", () => {
    const base = [short, full];
    expect(removeCommit(base, "4F2A9C1")).toEqual([full]);
    expect(removeCommit(base, "abcdef1")).toBe(base);
    expect(removeCommit(base, "nope")).toBe(base);
    expect(base).toEqual([short, full]);
    expect(hasCommit(base, "4F2A9C1")).toBe(true);
    expect(hasCommit(base, "abcdef1")).toBe(false);
  });
});

describe("document commit normalization", () => {
  it("accepts commits on a normalized document", () => {
    const { document, issues } = normalizeDocument({
      byId: {
        one: {
          id: "one",
          parentId: null,
          title: "One",
          criteria: [],
          childIds: [],
          commits: ["ABC1234", short, "bad"],
        },
      },
      rootIds: ["one"],
    });
    expect(document.byId.one.commits).toEqual(["abc1234", short]);
    expect(issues.join(" ")).toContain("invalid commit hash");
  });

  it("defaults documents without commits to an empty list", () => {
    const { document, issues } = normalizeDocument({
      byId: {
        one: {
          id: "one",
          parentId: null,
          title: "One",
          criteria: [],
          childIds: [],
        },
      },
      rootIds: ["one"],
    });
    expect(document.byId.one.commits).toEqual([]);
    expect(issues).toEqual([]);
  });
});

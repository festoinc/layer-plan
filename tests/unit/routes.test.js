import { describe, expect, it } from "vitest";
import {
  ROUTE_VIEWS,
  parseRoute,
  routeToHash,
} from "../../src/hooks/useRoute.js";

describe("project routes", () => {
  it("parses the project list", () => {
    expect(parseRoute("#/projects")).toEqual({
      view: ROUTE_VIEWS.projects,
      projectId: null,
      chapterId: null,
      legacy: false,
      valid: true,
    });
  });

  it("parses project root and chapter routes", () => {
    expect(parseRoute("#/projects/website")).toMatchObject({
      view: ROUTE_VIEWS.specifications,
      projectId: "website",
      chapterId: null,
      valid: true,
    });
    expect(parseRoute("#/projects/website/chapters")).toMatchObject({
      view: ROUTE_VIEWS.specifications,
      projectId: "website",
      chapterId: null,
      valid: true,
    });
    expect(
      parseRoute("#/projects/website/chapters/password-reset"),
    ).toMatchObject({
      view: ROUTE_VIEWS.specifications,
      projectId: "website",
      chapterId: "password-reset",
      valid: true,
    });
    expect(parseRoute("#/projects/website/coverage")).toMatchObject({
      view: ROUTE_VIEWS.coverage,
      projectId: "website",
      valid: true,
    });
    expect(parseRoute("#/projects/website/activity")).toMatchObject({
      view: ROUTE_VIEWS.activity,
      projectId: "website",
      valid: true,
    });
  });

  it("parses legacy hashes as legacy routes", () => {
    expect(parseRoute("")).toMatchObject({
      view: ROUTE_VIEWS.specifications,
      chapterId: null,
      legacy: true,
      valid: false,
    });
    expect(parseRoute("#/chapters/one")).toMatchObject({
      view: ROUTE_VIEWS.specifications,
      chapterId: "one",
      legacy: true,
      valid: true,
    });
    expect(parseRoute("#/coverage")).toMatchObject({
      view: ROUTE_VIEWS.coverage,
      legacy: true,
      valid: true,
    });
    expect(parseRoute("#/activity")).toMatchObject({
      view: ROUTE_VIEWS.activity,
      legacy: true,
      valid: true,
    });
  });

  it("rejects malformed project routes", () => {
    expect(parseRoute("#/projects/website/nope").valid).toBe(false);
    expect(parseRoute("#/projects/website/chapters/one/extra").valid).toBe(
      false,
    );
    expect(parseRoute("#/nope").valid).toBe(false);
  });

  it("encodes and round-trips project routes", () => {
    const cases = [
      { view: ROUTE_VIEWS.projects },
      { view: ROUTE_VIEWS.specifications, projectId: "website" },
      {
        view: ROUTE_VIEWS.specifications,
        projectId: "website",
        chapterId: "a b/c",
      },
      { view: ROUTE_VIEWS.coverage, projectId: "website" },
      { view: ROUTE_VIEWS.activity, projectId: "website" },
    ];
    for (const target of cases) {
      const hash = routeToHash(target);
      expect(hash.startsWith("#/")).toBe(true);
      const parsed = parseRoute(hash);
      expect(parsed.valid).toBe(true);
      expect(parsed.view).toBe(target.view);
      expect(parsed.projectId ?? null).toBe(target.projectId ?? null);
      expect(parsed.chapterId ?? null).toBe(target.chapterId ?? null);
    }
  });

  it("keeps legacy targets when no project id is supplied", () => {
    expect(routeToHash({ view: ROUTE_VIEWS.coverage })).toBe("#/coverage");
    expect(
      routeToHash({ view: ROUTE_VIEWS.specifications, chapterId: "one" }),
    ).toBe("#/chapters/one");
  });
});

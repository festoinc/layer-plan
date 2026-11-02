import { useCallback, useMemo, useSyncExternalStore } from "react";

export const ROUTE_VIEWS = {
  specifications: "specifications" as const,
  coverage: "coverage" as const,
  activity: "activity" as const,
};

export type RouteView = (typeof ROUTE_VIEWS)[keyof typeof ROUTE_VIEWS];

export interface ParsedRoute {
  view: RouteView;
  chapterId: string | null;
  valid: boolean;
}

export interface RouteTarget {
  view?: RouteView | string;
  chapterId?: string | null;
}

const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (typeof window === "undefined") {
    return () => listeners.delete(listener);
  }
  window.addEventListener("hashchange", listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("hashchange", listener);
    window.removeEventListener("popstate", listener);
  };
}

function getSnapshot(): string {
  return typeof window === "undefined" ? "" : window.location.hash;
}

export function parseRoute(hash: string): ParsedRoute {
  const path = String(hash ?? "")
    .replace(/^#/, "")
    .replace(/^\//, "")
    .replace(/\/$/, "");

  if (!path)
    return { view: ROUTE_VIEWS.specifications, chapterId: null, valid: false };
  if (path === ROUTE_VIEWS.coverage) {
    return { view: ROUTE_VIEWS.coverage, chapterId: null, valid: true };
  }
  if (path === ROUTE_VIEWS.activity) {
    return { view: ROUTE_VIEWS.activity, chapterId: null, valid: true };
  }

  const chapterMatch = path.match(/^chapters\/(.+)$/);
  if (chapterMatch) {
    try {
      return {
        view: ROUTE_VIEWS.specifications,
        chapterId: decodeURIComponent(chapterMatch[1]),
        valid: true,
      };
    } catch {
      return {
        view: ROUTE_VIEWS.specifications,
        chapterId: null,
        valid: false,
      };
    }
  }

  return { view: ROUTE_VIEWS.specifications, chapterId: null, valid: false };
}

export function routeToHash(route: RouteTarget): string {
  if (route.view === ROUTE_VIEWS.coverage) return "#/coverage";
  if (route.view === ROUTE_VIEWS.activity) return "#/activity";
  return route.chapterId
    ? `#/chapters/${encodeURIComponent(route.chapterId)}`
    : "#/chapters";
}

export interface RouteContextValue extends ParsedRoute {
  hash: string;
  navigate: (next: RouteTarget) => void;
  replace: (next: RouteTarget) => void;
}

export function useRoute(): RouteContextValue {
  const hash = useSyncExternalStore(subscribe, getSnapshot, () => "");
  const route = useMemo(() => parseRoute(hash), [hash]);

  const navigate = useCallback((next: RouteTarget) => {
    const target = routeToHash(next);
    if (typeof window === "undefined") return;
    if (window.location.hash === target) {
      notify();
      return;
    }
    window.location.hash = target;
  }, []);

  const replace = useCallback((next: RouteTarget) => {
    const target = routeToHash(next);
    if (typeof window === "undefined") return;
    if (window.location.hash === target) return;
    window.history.replaceState(null, "", target);
    notify();
  }, []);

  return useMemo(
    () => ({ ...route, hash, navigate, replace }),
    [route, hash, navigate, replace],
  );
}

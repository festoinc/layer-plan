import { useCallback, useMemo, useSyncExternalStore } from "react";

export const ROUTE_VIEWS = {
  specifications: "specifications",
  coverage: "coverage",
  activity: "activity",
};

const listeners = new Set();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener) {
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

function getSnapshot() {
  return typeof window === "undefined" ? "" : window.location.hash;
}

/**
 * @param {string} hash
 * @returns {{ view: string, chapterId: string|null, valid: boolean }}
 */
export function parseRoute(hash) {
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

/**
 * @param {{ view?: string, chapterId?: string|null }} route
 * @returns {string}
 */
export function routeToHash(route) {
  if (route.view === ROUTE_VIEWS.coverage) return "#/coverage";
  if (route.view === ROUTE_VIEWS.activity) return "#/activity";
  return route.chapterId
    ? `#/chapters/${encodeURIComponent(route.chapterId)}`
    : "#/chapters";
}

export function useRoute() {
  const hash = useSyncExternalStore(subscribe, getSnapshot, () => "");
  const route = useMemo(() => parseRoute(hash), [hash]);

  const navigate = useCallback((next) => {
    const target = routeToHash(next);
    if (typeof window === "undefined") return;
    if (window.location.hash === target) {
      notify();
      return;
    }
    window.location.hash = target;
  }, []);

  const replace = useCallback((next) => {
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

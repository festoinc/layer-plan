import { useCallback, useMemo, useSyncExternalStore } from "react";

export const ROUTE_VIEWS = {
  projects: "projects" as const,
  specifications: "specifications" as const,
  coverage: "coverage" as const,
  activity: "activity" as const,
  signIn: "sign-in" as const,
  account: "account" as const,
  users: "users" as const,
  oauthConsent: "oauth-consent" as const,
};

export type RouteView = (typeof ROUTE_VIEWS)[keyof typeof ROUTE_VIEWS];

export interface ParsedRoute {
  view: RouteView;
  projectId: string | null;
  chapterId: string | null;
  oauthRequestId?: string | null;
  legacy: boolean;
  valid: boolean;
}

export interface RouteTarget {
  view?: RouteView | string;
  projectId?: string | null;
  chapterId?: string | null;
  oauthRequestId?: string | null;
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

function decode(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function parseRoute(hash: string): ParsedRoute {
  const path = String(hash ?? "")
    .replace(/^#/, "")
    .replace(/^\//, "")
    .replace(/\/$/, "");

  if (!path) {
    return {
      view: ROUTE_VIEWS.specifications,
      projectId: null,
      chapterId: null,
      legacy: true,
      valid: false,
    };
  }

  if (path.startsWith("oauth/consent/")) {
    const rest = path.slice("oauth/consent/".length);
    const requestId = rest && !rest.includes("/") ? decode(rest) : null;
    return {
      view: ROUTE_VIEWS.oauthConsent,
      projectId: null,
      chapterId: null,
      oauthRequestId: requestId,
      legacy: false,
      valid: Boolean(requestId),
    };
  }

  if (path === ROUTE_VIEWS.signIn) {
    return {
      view: ROUTE_VIEWS.signIn,
      projectId: null,
      chapterId: null,
      legacy: false,
      valid: true,
    };
  }
  if (path === ROUTE_VIEWS.account) {
    return {
      view: ROUTE_VIEWS.account,
      projectId: null,
      chapterId: null,
      legacy: false,
      valid: true,
    };
  }
  if (path === ROUTE_VIEWS.users) {
    return {
      view: ROUTE_VIEWS.users,
      projectId: null,
      chapterId: null,
      legacy: false,
      valid: true,
    };
  }

  const segments = path.split("/").filter(Boolean);

  if (segments[0] === "projects") {
    if (segments.length === 1) {
      return {
        view: ROUTE_VIEWS.projects,
        projectId: null,
        chapterId: null,
        legacy: false,
        valid: true,
      };
    }

    const projectId = decode(segments[1]);
    if (!projectId) {
      return {
        view: ROUTE_VIEWS.projects,
        projectId: null,
        chapterId: null,
        legacy: false,
        valid: false,
      };
    }

    if (segments.length === 2) {
      return {
        view: ROUTE_VIEWS.specifications,
        projectId,
        chapterId: null,
        legacy: false,
        valid: true,
      };
    }

    const section = segments[2];
    if (section === "chapters") {
      if (segments.length > 4) {
        return {
          view: ROUTE_VIEWS.specifications,
          projectId,
          chapterId: null,
          legacy: false,
          valid: false,
        };
      }
      return {
        view: ROUTE_VIEWS.specifications,
        projectId,
        chapterId: decode(segments[3]),
        legacy: false,
        valid: true,
      };
    }
    if (section === ROUTE_VIEWS.coverage && segments.length === 3) {
      return {
        view: ROUTE_VIEWS.coverage,
        projectId,
        chapterId: null,
        legacy: false,
        valid: true,
      };
    }
    if (section === ROUTE_VIEWS.activity && segments.length === 3) {
      return {
        view: ROUTE_VIEWS.activity,
        projectId,
        chapterId: null,
        legacy: false,
        valid: true,
      };
    }
    return {
      view: ROUTE_VIEWS.specifications,
      projectId,
      chapterId: null,
      legacy: false,
      valid: false,
    };
  }

  if (path === ROUTE_VIEWS.coverage) {
    return {
      view: ROUTE_VIEWS.coverage,
      projectId: null,
      chapterId: null,
      legacy: true,
      valid: true,
    };
  }
  if (path === ROUTE_VIEWS.activity) {
    return {
      view: ROUTE_VIEWS.activity,
      projectId: null,
      chapterId: null,
      legacy: true,
      valid: true,
    };
  }

  const chapterMatch = path.match(/^chapters(?:\/(.+))?$/);
  if (chapterMatch) {
    return {
      view: ROUTE_VIEWS.specifications,
      projectId: null,
      chapterId: decode(chapterMatch[1]),
      legacy: true,
      valid: true,
    };
  }

  return {
    view: ROUTE_VIEWS.specifications,
    projectId: null,
    chapterId: null,
    legacy: true,
    valid: false,
  };
}

export function routeToHash(route: RouteTarget): string {
  if (route.view === ROUTE_VIEWS.oauthConsent) {
    return route.oauthRequestId
      ? `#/oauth/consent/${encodeURIComponent(route.oauthRequestId)}`
      : "#/oauth/consent";
  }
  if (route.view === ROUTE_VIEWS.projects) return "#/projects";
  if (route.view === ROUTE_VIEWS.signIn) return "#/sign-in";
  if (route.view === ROUTE_VIEWS.account) return "#/account";
  if (route.view === ROUTE_VIEWS.users) return "#/users";

  if (!route.projectId) {
    if (route.view === ROUTE_VIEWS.coverage) return "#/coverage";
    if (route.view === ROUTE_VIEWS.activity) return "#/activity";
    return route.chapterId
      ? `#/chapters/${encodeURIComponent(route.chapterId)}`
      : "#/chapters";
  }

  const base = `#/projects/${encodeURIComponent(route.projectId)}`;
  if (route.view === ROUTE_VIEWS.coverage) return `${base}/coverage`;
  if (route.view === ROUTE_VIEWS.activity) return `${base}/activity`;
  return route.chapterId
    ? `${base}/chapters/${encodeURIComponent(route.chapterId)}`
    : `${base}/chapters`;
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

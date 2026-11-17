import { lazy } from "react";

export const ActivityView = lazy(() =>
  import("../components/ActivityView").then((module) => ({
    default: module.ActivityView,
  })),
);

export const TestCoverageView = lazy(
  () => import("../components/TestCoverageView"),
);

export const ProjectsView = lazy(() =>
  import("../components/ProjectsView").then((module) => ({
    default: module.ProjectsView,
  })),
);

export const SearchView = lazy(() =>
  import("../components/SearchView").then((module) => ({
    default: module.SearchView,
  })),
);

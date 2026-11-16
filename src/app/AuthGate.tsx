import { useEffect } from "react";
import { SignInPage } from "../components/SignInPage";
import { AccountPage } from "../components/AccountPage";
import { UsersPage } from "../components/UsersPage";
import { ROUTE_VIEWS, useRoute } from "../hooks/useRoute";
import { useAuth } from "../store/AuthProvider";
import { ProjectsProvider } from "../store/ProjectsProvider";
import { App } from "./App";

export function AuthGate() {
  const auth = useAuth();
  const route = useRoute();

  useEffect(() => {
    if (auth.status === "authenticated" && route.view === ROUTE_VIEWS.signIn) {
      route.replace({ view: ROUTE_VIEWS.projects });
    }
  }, [auth.status, route]);

  if (auth.status === "loading") {
    return (
      <p className="page-loading" role="status">
        Checking your session…
      </p>
    );
  }

  if (auth.status === "error") {
    return (
      <div className="development-state api-load-error" role="alert">
        <h1>The local API is not available</h1>
        <p>{auth.error}</p>
        <div className="error-actions">
          <button type="button" onClick={auth.retry}>
            Retry
          </button>
          <a href="/api/v1/docs" target="_blank" rel="noreferrer">
            Open API docs
          </a>
        </div>
      </div>
    );
  }

  if (auth.status === "unauthenticated") {
    return <SignInPage />;
  }

  if (route.view === ROUTE_VIEWS.signIn) {
    return (
      <p className="page-loading" role="status">
        Loading workspace…
      </p>
    );
  }

  if (route.view === ROUTE_VIEWS.account) {
    return <AccountPage />;
  }

  if (route.view === ROUTE_VIEWS.users) {
    if (auth.user?.role !== "super_admin") {
      return (
        <div className="development-state api-load-error" role="alert">
          <h1>Not available</h1>
          <p>Only the super admin can manage users.</p>
          <a href="#/projects">Back to projects</a>
        </div>
      );
    }
    return <UsersPage />;
  }

  return (
    <ProjectsProvider key={auth.user?.id}>
      <App />
    </ProjectsProvider>
  );
}

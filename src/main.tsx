import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { ErrorBoundary } from "./app/ErrorBoundary";
import { ProjectsProvider } from "./store/ProjectsProvider";
import "./styles.css";

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(
    <ErrorBoundary>
      <ProjectsProvider>
        <App />
      </ProjectsProvider>
    </ErrorBoundary>,
  );
}

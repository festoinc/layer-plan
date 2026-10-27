import { createRoot } from "react-dom/client";
import { App } from "./app/App.jsx";
import { ErrorBoundary } from "./app/ErrorBoundary.jsx";
import { WorkspaceProvider } from "./store/WorkspaceProvider.jsx";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <ErrorBoundary>
    <WorkspaceProvider>
      <App />
    </WorkspaceProvider>
  </ErrorBoundary>,
);

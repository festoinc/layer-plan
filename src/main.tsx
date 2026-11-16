import { createRoot } from "react-dom/client";
import { AuthGate } from "./app/AuthGate";
import { ErrorBoundary } from "./app/ErrorBoundary";
import { AuthProvider } from "./store/AuthProvider";
import "./styles.css";

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(
    <ErrorBoundary>
      <AuthProvider>
        <AuthGate />
      </AuthProvider>
    </ErrorBoundary>,
  );
}

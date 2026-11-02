import { Component, ErrorInfo, ReactNode } from "react";
import { downloadJson, readRawBackup } from "../store/persistence";

export interface ErrorBoundaryProps {
  children?: ReactNode;
}

export interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Layers crashed while rendering:", error, info);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <div className="error-fallback" role="alert">
        <h1>Something went wrong</h1>
        <p>
          The workspace could not be displayed. Saved data is still in this
          browser and can be downloaded before reloading.
        </p>
        <pre>{String(this.state.error?.message ?? this.state.error)}</pre>
        <div className="error-actions">
          <button type="button" onClick={() => window.location.reload()}>
            Reload workspace
          </button>
          <button
            type="button"
            onClick={() =>
              downloadJson(readRawBackup(), "layers-raw-backup.json")
            }
          >
            Download backup
          </button>
          <a href="#/">Back to specifications</a>
        </div>
      </div>
    );
  }
}

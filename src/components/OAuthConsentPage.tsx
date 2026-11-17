import { FormEvent, useEffect, useId, useState } from "react";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { decideOAuthConsent, getOAuthConsent } from "../api/oauth";
import { errorMessage } from "../api/client";
import type { OAuthConsentResponse } from "../api/types";

export interface OAuthConsentPageProps {
  requestId: string;
}

function scopeLabel(scopes: string[]): string {
  return scopes.includes("write") ? "Read and write" : "Read only";
}

export function OAuthConsentPage({ requestId }: OAuthConsentPageProps) {
  const projectId = useId();
  const [data, setData] = useState<OAuthConsentResponse | null>(null);
  const [selectedProject, setSelectedProject] = useState("");
  const [scope, setScope] = useState<"read" | "write">("write");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void getOAuthConsent(requestId)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setSelectedProject(result.projects[0]?.id ?? "");
        setScope(result.request.scopes.includes("write") ? "write" : "read");
      })
      .catch((caught) => {
        if (!cancelled) setError(errorMessage(caught));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [requestId]);

  function finish(redirectTo: string) {
    window.location.assign(redirectTo);
  }

  async function decide(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !data) return;
    setPending(true);
    setError("");
    try {
      const result = await decideOAuthConsent(requestId, {
        decision: "approve",
        projectId: selectedProject,
        scopes: scope === "write" ? ["read", "write"] : ["read"],
      });
      finish(result.redirectTo);
    } catch (caught) {
      setError(errorMessage(caught));
      setPending(false);
    }
  }

  async function deny() {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const result = await decideOAuthConsent(requestId, {
        decision: "deny",
      });
      finish(result.redirectTo);
    } catch (caught) {
      setError(errorMessage(caught));
      setPending(false);
    }
  }

  if (loading) {
    return (
      <main className="auth-page oauth-consent-page">
        <div className="auth-card oauth-consent-card">
          <p className="page-loading" role="status">
            Loading authorization request…
          </p>
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="auth-page oauth-consent-page">
        <div className="auth-card oauth-consent-card">
          <div className="auth-brand">
            <ShieldCheck size={25} />
            <span>Layers</span>
          </div>
          <h1>Authorization unavailable</h1>
          <p className="auth-intro">
            {error || "This request could not be loaded."}
          </p>
          <a className="secondary-button" href="#/projects">
            <ArrowLeft size={15} />
            Back to Layers
          </a>
        </div>
      </main>
    );
  }

  const canWrite = data.request.scopes.includes("write");
  const noProjects = data.projects.length === 0;

  return (
    <main className="auth-page oauth-consent-page">
      <div className="auth-card oauth-consent-card">
        <div className="auth-brand">
          <ShieldCheck size={25} />
          <span>Layers</span>
        </div>
        <p className="oauth-consent-eyebrow">Authorization request</p>
        <h1>Connect {data.request.clientName}</h1>
        <p className="auth-intro">
          This app wants to use the Layers MCP tools for one of your projects.
          It will send you back to{" "}
          <strong className="oauth-redirect-host">
            {data.request.redirectHost}
          </strong>{" "}
          after you decide.
        </p>

        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}

        <form className="oauth-consent-form" onSubmit={decide}>
          <div className="oauth-consent-field">
            <label htmlFor={projectId}>Project</label>
            {noProjects ? (
              <p className="account-hint" role="status">
                You do not have a project yet. Create one, then reload this page
                to authorize the app.
              </p>
            ) : (
              <select
                id={projectId}
                value={selectedProject}
                onChange={(event) => setSelectedProject(event.target.value)}
                required
              >
                {data.projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <fieldset className="oauth-scope-fieldset">
            <legend>Access</legend>
            <label>
              <input
                type="radio"
                name="scope"
                value="read"
                checked={scope === "read"}
                onChange={() => setScope("read")}
              />
              <span>
                <strong>Read only</strong>
                <small>See projects, documents, activity and coverage.</small>
              </span>
            </label>
            {canWrite && (
              <label>
                <input
                  type="radio"
                  name="scope"
                  value="write"
                  checked={scope === "write"}
                  onChange={() => setScope("write")}
                />
                <span>
                  <strong>Read and write</strong>
                  <small>
                    Also edit documents, metadata and activity for this project.
                  </small>
                </span>
              </label>
            )}
          </fieldset>

          <p className="account-hint">
            This connection is limited to the project you choose. You can revoke
            it later from the project menu under <strong>MCP access</strong>.
          </p>

          <div className="oauth-consent-actions">
            <button
              className="primary-button"
              type="submit"
              disabled={pending || noProjects || !selectedProject}
            >
              {pending ? "Authorizing…" : `Allow ${scopeLabel([scope])}`}
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => void deny()}
              disabled={pending}
            >
              Deny
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}

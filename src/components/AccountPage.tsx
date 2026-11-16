import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { errorMessage } from "../api/client";
import type { SessionInfo } from "../api/types";
import { ROUTE_VIEWS, useRoute } from "../hooks/useRoute";
import { useAuth } from "../store/AuthProvider";

function formatDate(value: string | null): string {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

export function AccountPage() {
  const auth = useAuth();
  const route = useRoute();
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setSessions(await auth.listSessions());
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [auth]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function revokeSession(id: string) {
    setError("");
    try {
      await auth.revokeSession(id);
      if (auth.session?.id === id) {
        route.navigate({ view: ROUTE_VIEWS.signIn });
        return;
      }
      setNotice("Session revoked.");
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function revokeOtherSessions() {
    setError("");
    try {
      await auth.revokeOtherSessions();
      setNotice("Other sessions revoked.");
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  const user = auth.user;
  if (!user) return null;

  return (
    <main className="account-page">
      <a className="back-link" href="#/projects">
        <ArrowLeft size={16} />
        Back to projects
      </a>
      <header className="account-header">
        <div>
          <h1>Account</h1>
          <p>
            {user.displayName} · {user.email}
          </p>
        </div>
        <span className="role-badge">
          <ShieldCheck size={15} />
          {user.role === "super_admin" ? "Super admin" : "Member"}
        </span>
      </header>

      {error && (
        <div className="account-error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="account-notice" role="status">
          {notice}
        </div>
      )}

      <section className="account-section" aria-labelledby="account-profile">
        <h2 id="account-profile">Profile</h2>
        <dl className="account-details">
          <div>
            <dt>Email</dt>
            <dd>{user.email}</dd>
          </div>
          <div>
            <dt>Display name</dt>
            <dd>{user.displayName}</dd>
          </div>
          <div>
            <dt>Role</dt>
            <dd>{user.role === "super_admin" ? "Super admin" : "Member"}</dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd>{formatDate(user.createdAt)}</dd>
          </div>
        </dl>
        <p className="account-hint">
          Password changes and recovery are not available in this version.
        </p>
      </section>

      <section className="account-section" aria-labelledby="account-sessions">
        <div className="section-heading">
          <h2 id="account-sessions">Sessions</h2>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void revokeOtherSessions()}
            disabled={loading || sessions.length < 2}
          >
            Sign out other sessions
          </button>
        </div>
        {loading ? (
          <p role="status">Loading sessions…</p>
        ) : (
          <ul className="session-list">
            {sessions.map((session) => (
              <li key={session.id}>
                <div>
                  <strong>
                    {session.current ? "This session" : "Browser session"}
                  </strong>
                  <span>{session.userAgent || "Unknown client"}</span>
                  <span>
                    Last seen {formatDate(session.lastSeenAt)} · expires{" "}
                    {formatDate(session.expiresAt)}
                  </span>
                </div>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void revokeSession(session.id)}
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="account-hint">
        Project API keys are managed from a project's actions menu. Open
        Projects, choose <strong>API keys</strong>, and create a key for that
        project.
      </p>
    </main>
  );
}

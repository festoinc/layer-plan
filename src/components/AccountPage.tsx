import { FormEvent, useCallback, useEffect, useId, useState } from "react";
import { ArrowLeft, KeyRound, ShieldCheck } from "lucide-react";
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
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const currentPasswordId = useId();
  const newPasswordId = useId();
  const confirmPasswordId = useId();

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

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (changingPassword) return;
    setError("");
    setNotice("");
    if (newPassword.length < 12) {
      setError("The new password must be at least 12 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("The new passwords do not match.");
      return;
    }
    if (newPassword === currentPassword) {
      setError("Choose a new password that differs from the current one.");
      return;
    }
    setChangingPassword(true);
    try {
      await auth.changePassword({ currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setNotice("Password changed. Other sessions were signed out.");
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setChangingPassword(false);
    }
  }

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
          {user.role === "super_admin"
            ? "Change your password below. Password recovery is not available."
            : "Password changes and recovery are not available for member accounts."}
        </p>
      </section>

      {user.role === "super_admin" && (
        <section className="account-section" aria-labelledby="account-password">
          <h2 id="account-password">Change password</h2>
          <p className="account-hint">
            Confirm with your current password. Other browser sessions will be
            signed out.
          </p>
          <form
            className="token-form password-form"
            onSubmit={(event) => void changePassword(event)}
          >
            <div>
              <label htmlFor={currentPasswordId}>Current password</label>
              <input
                id={currentPasswordId}
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
              />
            </div>
            <div>
              <label htmlFor={newPasswordId}>New password</label>
              <input
                id={newPasswordId}
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={200}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                required
              />
            </div>
            <div>
              <label htmlFor={confirmPasswordId}>Confirm new password</label>
              <input
                id={confirmPasswordId}
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={200}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
              />
            </div>
            <button
              className="primary-button"
              type="submit"
              disabled={changingPassword}
            >
              <KeyRound size={15} />
              {changingPassword ? "Changing…" : "Change password"}
            </button>
          </form>
        </section>
      )}

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
        Project API keys and OAuth connections are managed from a project's
        actions menu. Open Projects, choose <strong>MCP access</strong>, and
        create a key or review connected apps for that project.
      </p>
    </main>
  );
}

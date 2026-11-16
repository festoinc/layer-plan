import { FormEvent, useCallback, useEffect, useId, useState } from "react";
import { ArrowLeft, ShieldCheck, UserPlus, UsersRound } from "lucide-react";
import { errorMessage } from "../api/client";
import type { AuthUser } from "../api/types";
import { useAuth } from "../store/AuthProvider";

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString();
}

export function UsersPage() {
  const auth = useAuth();
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [creating, setCreating] = useState(false);
  const emailId = useId();
  const nameId = useId();
  const passwordId = useId();
  const confirmId = useId();

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setUsers(await auth.listUsers());
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

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating) return;
    if (password !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }
    setCreating(true);
    setError("");
    setNotice("");
    try {
      const user = await auth.createUser({
        email: email.trim(),
        password,
        displayName: displayName.trim() || undefined,
      });
      setEmail("");
      setDisplayName("");
      setPassword("");
      setConfirmPassword("");
      setNotice(`Created ${user.email}. Share the password securely.`);
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setCreating(false);
    }
  }

  async function toggleDisabled(user: AuthUser) {
    setError("");
    try {
      await auth.setUserDisabled(user.id, !user.disabledAt);
      setNotice(user.disabledAt ? "User enabled." : "User disabled.");
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  return (
    <main className="account-page users-page">
      <a className="back-link" href="#/projects">
        <ArrowLeft size={16} />
        Back to projects
      </a>
      <header className="account-header">
        <div>
          <h1>Users</h1>
          <p>Create member accounts and revoke access.</p>
        </div>
        <span className="role-badge">
          <ShieldCheck size={15} />
          Super admin
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

      <section
        className="account-section"
        aria-labelledby="create-user-heading"
      >
        <h2 id="create-user-heading">
          <UserPlus size={18} />
          Create user
        </h2>
        <p className="account-hint">
          No email is sent. Give the password to the person directly. Passwords
          cannot be changed or recovered in this version.
        </p>
        <form className="user-form" onSubmit={createUser}>
          <div>
            <label htmlFor={emailId}>Email</label>
            <input
              id={emailId}
              type="email"
              autoComplete="off"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
          <div>
            <label htmlFor={nameId}>Display name (optional)</label>
            <input
              id={nameId}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              maxLength={80}
            />
          </div>
          <div>
            <label htmlFor={passwordId}>Password</label>
            <input
              id={passwordId}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={12}
              maxLength={200}
              required
            />
          </div>
          <div>
            <label htmlFor={confirmId}>Confirm password</label>
            <input
              id={confirmId}
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              minLength={12}
              maxLength={200}
              required
            />
          </div>
          <button className="primary-button" type="submit" disabled={creating}>
            <UserPlus size={15} />
            {creating ? "Creating…" : "Create user"}
          </button>
        </form>
      </section>

      <section className="account-section" aria-labelledby="user-list-heading">
        <div className="section-heading">
          <h2 id="user-list-heading">
            <UsersRound size={18} />
            All users
          </h2>
        </div>
        {loading ? (
          <p role="status">Loading users…</p>
        ) : (
          <ul className="user-list">
            {users.map((user) => (
              <li key={user.id}>
                <div>
                  <strong>{user.displayName}</strong>
                  <span>{user.email}</span>
                  <span>
                    {user.role === "super_admin" ? "Super admin" : "Member"} ·
                    created {formatDate(user.createdAt)}
                  </span>
                </div>
                {user.disabledAt ? (
                  <>
                    <span className="token-revoked">Disabled</span>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => void toggleDisabled(user)}
                    >
                      Enable
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => void toggleDisabled(user)}
                    disabled={user.id === auth.user?.id}
                    title={
                      user.id === auth.user?.id
                        ? "You cannot disable your own account."
                        : undefined
                    }
                  >
                    Disable
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

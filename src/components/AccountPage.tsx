import { FormEvent, useCallback, useEffect, useId, useState } from "react";
import { ArrowLeft, Check, Copy, KeyRound, ShieldCheck } from "lucide-react";
import { errorMessage } from "../api/client";
import type { ApiTokenInfo, SessionInfo } from "../api/types";
import { ROUTE_VIEWS, useRoute } from "../hooks/useRoute";
import { useAuth } from "../store/AuthProvider";

function formatDate(value: string | null): string {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

function scopeLabel(scopes: string[]): string {
  return scopes.includes("write") ? "Read and write" : "Read only";
}

export function AccountPage() {
  const auth = useAuth();
  const route = useRoute();
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [tokens, setTokens] = useState<ApiTokenInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tokenName, setTokenName] = useState("");
  const [tokenScope, setTokenScope] = useState<"read" | "write">("write");
  const [createdToken, setCreatedToken] = useState("");
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);
  const nameId = useId();
  const scopeId = useId();

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [nextSessions, nextTokens] = await Promise.all([
        auth.listSessions(),
        auth.listTokens(),
      ]);
      setSessions(nextSessions);
      setTokens(nextTokens);
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

  async function createToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating) return;
    setCreating(true);
    setError("");
    setCreatedToken("");
    setCopied(false);
    try {
      const result = await auth.createToken({
        name: tokenName.trim() || "API token",
        scopes: tokenScope === "write" ? ["read", "write"] : ["read"],
      });
      setCreatedToken(result.token);
      setTokenName("");
      setNotice("API token created. Copy it now; it will not be shown again.");
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setCreating(false);
    }
  }

  async function revokeToken(id: string) {
    setError("");
    try {
      await auth.revokeToken(id);
      setNotice("API token revoked.");
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function copyToken() {
    try {
      await navigator.clipboard.writeText(createdToken);
      setCopied(true);
    } catch {
      setError("The token could not be copied. Select it manually.");
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

      <section className="account-section" aria-labelledby="account-tokens">
        <div className="section-heading">
          <h2 id="account-tokens">API tokens</h2>
        </div>
        <p className="account-hint">
          API tokens let local AI agents use the API without your password.
          Create a token here and set it as <code>LAYERS_API_TOKEN</code> in the
          agent environment.
        </p>

        {createdToken && (
          <div className="token-created" role="status">
            <div>
              <strong>Copy this token now</strong>
              <p>It will not be shown again.</p>
              <code>{createdToken}</code>
            </div>
            <button type="button" onClick={() => void copyToken()}>
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        )}

        <form className="token-form" onSubmit={createToken}>
          <div>
            <label htmlFor={nameId}>Token name</label>
            <input
              id={nameId}
              value={tokenName}
              onChange={(event) => setTokenName(event.target.value)}
              placeholder="Local coding agent"
              maxLength={80}
            />
          </div>
          <div>
            <label htmlFor={scopeId}>Scope</label>
            <select
              id={scopeId}
              value={tokenScope}
              onChange={(event) =>
                setTokenScope(event.target.value as "read" | "write")
              }
            >
              <option value="write">Read and write</option>
              <option value="read">Read only</option>
            </select>
          </div>
          <button className="primary-button" type="submit" disabled={creating}>
            <KeyRound size={15} />
            {creating ? "Creating…" : "Create token"}
          </button>
        </form>

        {loading ? (
          <p role="status">Loading tokens…</p>
        ) : tokens.length ? (
          <ul className="token-list">
            {tokens.map((token) => (
              <li key={token.id}>
                <div>
                  <strong>{token.name}</strong>
                  <span>
                    {token.prefix}… · {scopeLabel(token.scopes)}
                  </span>
                  <span>
                    Created {formatDate(token.createdAt)} · last used{" "}
                    {formatDate(token.lastUsedAt)}
                  </span>
                </div>
                {token.revokedAt ? (
                  <span className="token-revoked">Revoked</span>
                ) : (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => void revokeToken(token.id)}
                  >
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="account-hint">No API tokens yet.</p>
        )}
      </section>
    </main>
  );
}

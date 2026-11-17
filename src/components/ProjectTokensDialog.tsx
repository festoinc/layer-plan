import {
  FormEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Check, Copy, KeyRound, X } from "lucide-react";
import { errorMessage } from "../api/client";
import {
  createProjectToken,
  listProjectTokens,
  revokeProjectToken,
} from "../api/tokens";
import { listProjectOAuthGrants, revokeProjectOAuthGrant } from "../api/oauth";
import type { ApiTokenInfo, OAuthGrantInfo } from "../api/types";
import { ProjectSummary } from "../domain/projects";
import { useFocusTrap } from "../hooks/useFocusTrap";

export interface ProjectTokensDialogProps {
  project: ProjectSummary;
  onClose: () => void;
}

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "Never";
}

function scopeLabel(scopes: string[]): string {
  return scopes.includes("write") ? "Read and write" : "Read only";
}

export function ProjectTokensDialog({
  project,
  onClose,
}: ProjectTokensDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const nameId = useId();
  const scopeId = useId();
  const expiryId = useId();
  const [tokens, setTokens] = useState<ApiTokenInfo[]>([]);
  const [grants, setGrants] = useState<OAuthGrantInfo[]>([]);
  const [revokingGrant, setRevokingGrant] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"read" | "write">("write");
  const [expiresInDays, setExpiresInDays] = useState("3650");
  const [createdToken, setCreatedToken] = useState("");
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);

  useFocusTrap(true, dialogRef, onClose);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [tokenList, grantList] = await Promise.all([
        listProjectTokens(project.id),
        listProjectOAuthGrants(project.id),
      ]);
      setTokens(tokenList.tokens);
      setGrants(grantList.grants);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating) return;
    const days = Number(expiresInDays);
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      setError("Expiry must be between 1 and 3650 days.");
      return;
    }
    setCreating(true);
    setError("");
    setCreatedToken("");
    setCopied(false);
    try {
      const result = await createProjectToken(project.id, {
        name: name.trim() || "MCP client",
        scopes: scope === "write" ? ["read", "write"] : ["read"],
        expiresInDays: days,
      });
      setCreatedToken(result.token);
      setName("");
      setNotice("API key created. Copy it now; it will not be shown again.");
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string) {
    setError("");
    try {
      await revokeProjectToken(project.id, id);
      setNotice("API key revoked.");
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function revokeGrant(id: string) {
    setError("");
    try {
      await revokeProjectOAuthGrant(project.id, id);
      setNotice("OAuth connection revoked.");
      setRevokingGrant(null);
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(createdToken);
      setCopied(true);
    } catch {
      setError("The API key could not be copied. Select it manually.");
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="modal project-tokens-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={dialogRef}
      >
        <div className="modal-header">
          <div>
            <h2 id={titleId}>MCP access for {project.name}</h2>
            <p>
              API keys and OAuth connections work only with the MCP endpoint and
              only for this project. Create a key for clients that accept a
              bearer token, or approve an OAuth client from its consent page.
            </p>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close MCP access dialog"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="account-notice" role="status">
            {notice}
          </p>
        )}

        {createdToken && (
          <div className="token-created" role="status">
            <div>
              <strong>Copy this API key now</strong>
              <p>It will not be shown again.</p>
              <code>{createdToken}</code>
            </div>
            <button type="button" onClick={() => void copy()}>
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        )}

        <form className="token-form" onSubmit={create}>
          <div>
            <label htmlFor={nameId}>Key name</label>
            <input
              id={nameId}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Codex on my laptop"
              maxLength={80}
            />
          </div>
          <div>
            <label htmlFor={scopeId}>Scope</label>
            <select
              id={scopeId}
              value={scope}
              onChange={(event) =>
                setScope(event.target.value as "read" | "write")
              }
            >
              <option value="write">Read and write</option>
              <option value="read">Read only</option>
            </select>
          </div>
          <div>
            <label htmlFor={expiryId}>Expires in days</label>
            <input
              id={expiryId}
              type="number"
              min={1}
              max={3650}
              value={expiresInDays}
              onChange={(event) => setExpiresInDays(event.target.value)}
            />
          </div>
          <button className="primary-button" type="submit" disabled={creating}>
            <KeyRound size={15} />
            {creating ? "Creating…" : "Create API key"}
          </button>
        </form>

        {loading ? (
          <p role="status">Loading MCP access…</p>
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
                    {formatDate(token.lastUsedAt)} · expires{" "}
                    {formatDate(token.expiresAt)}
                  </span>
                </div>
                {token.revokedAt ? (
                  <span className="token-revoked">Revoked</span>
                ) : (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => void revoke(token.id)}
                  >
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="account-hint">No API keys for this project yet.</p>
        )}

        <h3 className="token-section-title">Connected apps</h3>
        <p className="account-hint">
          Apps authorized through OAuth are listed here. Revoking a connection
          invalidates its access and refresh tokens immediately.
        </p>
        {loading ? (
          <p role="status">Loading OAuth connections…</p>
        ) : grants.length ? (
          <ul className="token-list">
            {grants.map((grant) => (
              <li key={grant.id}>
                <div>
                  <strong>{grant.clientName}</strong>
                  <span>
                    {scopeLabel(grant.scopes)} · connected{" "}
                    {formatDate(grant.createdAt)}
                  </span>
                  <span>
                    Last used {formatDate(grant.lastUsedAt)} · refresh expires{" "}
                    {formatDate(grant.expiresAt)}
                  </span>
                </div>
                {grant.revokedAt ? (
                  <span className="token-revoked">Revoked</span>
                ) : revokingGrant === grant.id ? (
                  <div className="inline-confirm">
                    <button
                      type="button"
                      className="danger-button"
                      onClick={() => void revokeGrant(grant.id)}
                    >
                      Confirm revoke
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setRevokingGrant(null)}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setRevokingGrant(grant.id)}
                  >
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="account-hint">
            No OAuth connections for this project yet.
          </p>
        )}
      </div>
    </div>
  );
}

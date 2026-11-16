import { FormEvent, useEffect, useId, useRef, useState } from "react";
import { LockKeyhole } from "lucide-react";
import { errorMessage } from "../api/client";
import { useAuth } from "../store/AuthProvider";

export function SignInPage() {
  const { signIn, reason } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const emailRef = useRef<HTMLInputElement | null>(null);
  const emailId = useId();
  const passwordId = useId();
  const errorId = useId();

  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await signIn(email.trim(), password);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <LockKeyhole size={25} />
          <span>Layers</span>
        </div>
        <h1>Sign in</h1>
        <p className="auth-intro">
          Accounts are created by the workspace super admin. Password recovery
          is not available in this version.
        </p>
        {reason === "expired" && (
          <p className="auth-notice" role="status">
            Your session expired. Sign in again.
          </p>
        )}
        {reason === "signed-out" && (
          <p className="auth-notice" role="status">
            You have signed out.
          </p>
        )}
        <form className="auth-form" onSubmit={submit}>
          {error && (
            <div className="auth-error" id={errorId} role="alert">
              {error}
            </div>
          )}
          <label htmlFor={emailId}>Email</label>
          <input
            ref={emailRef}
            id={emailId}
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            aria-describedby={error ? errorId : undefined}
          />
          <label htmlFor={passwordId}>Password</label>
          <input
            id={passwordId}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            aria-describedby={error ? errorId : undefined}
          />
          <button className="primary-button" type="submit" disabled={pending}>
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}

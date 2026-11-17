import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import * as authApi from "../api/auth";
import {
  errorMessage,
  isUnauthenticated,
  UNAUTHORIZED_EVENT,
} from "../api/client";
import type { AuthUser, SessionInfo } from "../api/types";

export type AuthStatus =
  "loading" | "unauthenticated" | "authenticated" | "error";

export type AuthReason = "none" | "expired" | "signed-out";

export interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  session: SessionInfo | null;
  error: string | null;
  reason: AuthReason;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  retry: () => void;
  listSessions: () => Promise<SessionInfo[]>;
  revokeSession: (id: string) => Promise<void>;
  revokeOtherSessions: () => Promise<void>;
  changePassword: (input: {
    currentPassword: string;
    newPassword: string;
  }) => Promise<void>;
  listUsers: () => Promise<AuthUser[]>;
  createUser: (input: {
    email: string;
    password: string;
    displayName?: string;
  }) => Promise<AuthUser>;
  setUserDisabled: (id: string, disabled: boolean) => Promise<AuthUser>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState<AuthReason>("none");

  const load = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const result = await authApi.getSession();
      setUser(result.user);
      setSession(result.session);
      setReason("none");
      setStatus("authenticated");
    } catch (caught) {
      setUser(null);
      setSession(null);
      if (isUnauthenticated(caught)) {
        setReason("none");
        setStatus("unauthenticated");
      } else {
        setError(errorMessage(caught));
        setStatus("error");
      }
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    const onUnauthorized = () => {
      setUser(null);
      setSession(null);
      setReason("expired");
      setStatus("unauthenticated");
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => {
      window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const result = await authApi.login(email, password);
    setUser(result.user);
    setSession(result.session);
    setError(null);
    setReason("none");
    setStatus("authenticated");
  }, []);

  const signOut = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      setUser(null);
      setSession(null);
      setError(null);
      setReason("signed-out");
      setStatus("unauthenticated");
    }
  }, []);

  const listSessions = useCallback(async () => {
    const result = await authApi.listSessions();
    return result.sessions;
  }, []);

  const revokeSession = useCallback(
    async (id: string) => {
      await authApi.revokeSession(id);
      if (session?.id === id) {
        setUser(null);
        setSession(null);
        setReason("signed-out");
        setStatus("unauthenticated");
      }
    },
    [session?.id],
  );

  const revokeOtherSessions = useCallback(async () => {
    await authApi.revokeOtherSessions();
  }, []);

  const changePassword = useCallback(
    async (input: { currentPassword: string; newPassword: string }) => {
      await authApi.changePassword(input);
    },
    [],
  );

  const listUsers = useCallback(async () => {
    const result = await authApi.listUsers();
    return result.users;
  }, []);

  const createUser = useCallback(
    async (input: { email: string; password: string; displayName?: string }) =>
      authApi.createUser(input),
    [],
  );

  const setUserDisabled = useCallback(
    async (id: string, disabled: boolean) =>
      authApi.setUserDisabled(id, disabled),
    [],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      session,
      error,
      reason,
      signIn,
      signOut,
      retry: () => void load(),
      listSessions,
      revokeSession,
      revokeOtherSessions,
      changePassword,
      listUsers,
      createUser,
      setUserDisabled,
    }),
    [
      status,
      user,
      session,
      error,
      reason,
      signIn,
      signOut,
      load,
      listSessions,
      revokeSession,
      revokeOtherSessions,
      changePassword,
      listUsers,
      createUser,
      setUserDisabled,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside an AuthProvider.");
  }
  return context;
}

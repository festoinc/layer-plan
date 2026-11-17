import { apiRequest } from "./client";
import type {
  AuthUser,
  LoginResponse,
  MeResponse,
  SessionsResponse,
  UserResponse,
  UsersResponse,
} from "./types";

export async function login(
  email: string,
  password: string,
): Promise<LoginResponse> {
  const response = await apiRequest<LoginResponse>("/auth/login", {
    method: "POST",
    body: { email, password },
  });
  return response.data;
}

export async function logout(): Promise<void> {
  await apiRequest<void>("/auth/logout", { method: "POST" });
}

export async function getSession(): Promise<LoginResponse> {
  const response = await apiRequest<LoginResponse>("/auth/session");
  return response.data;
}

export async function getMe(): Promise<AuthUser> {
  const response = await apiRequest<MeResponse>("/me");
  return response.data.user;
}

export async function listSessions(): Promise<SessionsResponse> {
  const response = await apiRequest<SessionsResponse>("/auth/sessions");
  return response.data;
}

export async function revokeSession(id: string): Promise<void> {
  await apiRequest<void>(`/auth/sessions/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function revokeOtherSessions(): Promise<void> {
  await apiRequest<void>("/auth/sessions", { method: "DELETE" });
}

export async function changePassword(input: {
  currentPassword: string;
  newPassword: string;
}): Promise<void> {
  await apiRequest<void>("/me/password", {
    method: "POST",
    body: input,
  });
}

export async function listUsers(): Promise<UsersResponse> {
  const response = await apiRequest<UsersResponse>("/users");
  return response.data;
}

export async function createUser(input: {
  email: string;
  password: string;
  displayName?: string;
}): Promise<AuthUser> {
  const response = await apiRequest<UserResponse>("/users", {
    method: "POST",
    body: input,
  });
  return response.data.user;
}

export async function setUserDisabled(
  id: string,
  disabled: boolean,
): Promise<AuthUser> {
  const response = await apiRequest<UserResponse>(
    `/users/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: { disabled },
    },
  );
  return response.data.user;
}

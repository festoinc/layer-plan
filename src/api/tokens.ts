import { apiRequest } from "./client";
import type {
  ApiTokenInfo,
  CreateTokenResponse,
  TokensResponse,
} from "./types";

export async function listProjectTokens(
  projectId: string,
): Promise<TokensResponse> {
  const response = await apiRequest<TokensResponse>(
    `/projects/${encodeURIComponent(projectId)}/tokens`,
  );
  return response.data;
}

export async function createProjectToken(
  projectId: string,
  input: {
    name: string;
    scopes?: Array<"read" | "write">;
    expiresInDays?: number;
  },
): Promise<CreateTokenResponse> {
  const response = await apiRequest<CreateTokenResponse>(
    `/projects/${encodeURIComponent(projectId)}/tokens`,
    {
      method: "POST",
      body: input,
    },
  );
  return response.data;
}

export async function revokeProjectToken(
  projectId: string,
  tokenId: string,
): Promise<void> {
  await apiRequest<void>(
    `/projects/${encodeURIComponent(projectId)}/tokens/${encodeURIComponent(tokenId)}`,
    { method: "DELETE" },
  );
}

export type { ApiTokenInfo };

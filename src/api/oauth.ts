import { apiRequest } from "./client";
import type {
  OAuthConsentDecision,
  OAuthConsentDecisionResponse,
  OAuthConsentResponse,
  OAuthGrantsResponse,
} from "./types";

export async function getOAuthConsent(
  requestId: string,
): Promise<OAuthConsentResponse> {
  const response = await apiRequest<OAuthConsentResponse>(
    `/oauth/authorize/${encodeURIComponent(requestId)}`,
  );
  return response.data;
}

export async function decideOAuthConsent(
  requestId: string,
  input: OAuthConsentDecision,
): Promise<OAuthConsentDecisionResponse> {
  const response = await apiRequest<OAuthConsentDecisionResponse>(
    `/oauth/authorize/${encodeURIComponent(requestId)}/decision`,
    {
      method: "POST",
      body: input,
    },
  );
  return response.data;
}

export async function listProjectOAuthGrants(
  projectId: string,
): Promise<OAuthGrantsResponse> {
  const response = await apiRequest<OAuthGrantsResponse>(
    `/projects/${encodeURIComponent(projectId)}/oauth-grants`,
  );
  return response.data;
}

export async function revokeProjectOAuthGrant(
  projectId: string,
  grantId: string,
): Promise<void> {
  await apiRequest<void>(
    `/projects/${encodeURIComponent(projectId)}/oauth-grants/${encodeURIComponent(grantId)}`,
    { method: "DELETE" },
  );
}

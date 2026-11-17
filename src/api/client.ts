const API_BASE = import.meta.env.VITE_API_URL ?? "/api/v1";
const REQUEST_TIMEOUT_MS = 15_000;

interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class ApiUnavailableError extends Error {
  constructor(message = "The local API is not reachable.") {
    super(message);
    this.name = "ApiUnavailableError";
  }
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  etag?: number;
  keepalive?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface ApiResponse<T> {
  data: T;
  status: number;
  etag: number | null;
}

export const UNAUTHORIZED_EVENT = "layers:unauthorized";

function notifyUnauthorized(path: string): void {
  if (path.startsWith("/auth/login") || path.startsWith("/auth/session")) {
    return;
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  }
}

function revisionFromEtag(etag: string | null): number | null {
  if (!etag) return null;
  const match = /^"(\d+)"$/.exec(etag.trim());
  return match ? Number(match[1]) : null;
}

async function parseError(response: Response): Promise<ApiError> {
  let body: ApiErrorBody = {};
  try {
    body = (await response.json()) as ApiErrorBody;
  } catch {
    // Keep the fallback message.
  }
  const code = body.error?.code ?? "request_failed";
  const message =
    body.error?.message ??
    `The API returned ${response.status} ${response.statusText}.`;
  return new ApiError(response.status, code, message, body.error?.details);
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<ApiResponse<T>> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? REQUEST_TIMEOUT_MS,
  );
  const abortFromCaller = () => controller.abort();
  options.signal?.addEventListener("abort", abortFromCaller);

  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.etag !== undefined) headers["If-Match"] = `"${options.etag}"`;

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method: options.method ?? "GET",
      headers,
      credentials: "include",
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      keepalive: options.keepalive,
      signal: controller.signal,
    });

    if (!response.ok) {
      if (response.status === 401) notifyUnauthorized(path);
      throw await parseError(response);
    }

    if (response.status === 204) {
      return {
        data: undefined as T,
        status: response.status,
        etag: revisionFromEtag(response.headers.get("etag")),
      };
    }

    return {
      data: (await response.json()) as T,
      status: response.status,
      etag: revisionFromEtag(response.headers.get("etag")),
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiUnavailableError("The API request timed out.");
    }
    throw new ApiUnavailableError();
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}

export async function apiRequestText(
  path: string,
  options: RequestOptions = {},
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? REQUEST_TIMEOUT_MS,
  );
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.etag !== undefined) headers["If-Match"] = `"${options.etag}"`;
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method: options.method ?? "GET",
      headers,
      credentials: "include",
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
    if (!response.ok) {
      if (response.status === 401) notifyUnauthorized(path);
      throw await parseError(response);
    }
    return await response.text();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiUnavailableError("The API request timed out.");
    }
    throw new ApiUnavailableError();
  } finally {
    clearTimeout(timeout);
  }
}

export function isUnauthenticated(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError || error instanceof ApiUnavailableError) {
    return error.message;
  }
  if (error instanceof Error && error.message) return error.message;
  return "The request could not be completed.";
}

export function isRevisionConflict(error: unknown): boolean {
  return error instanceof ApiError && error.status === 412;
}

export interface BlobResponse {
  blob: Blob;
  filename: string | null;
}

function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const extended = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (extended) {
    try {
      return decodeURIComponent(extended[1]);
    } catch {
      return extended[1];
    }
  }
  const quoted = /filename="([^"]+)"/i.exec(header);
  return quoted ? quoted[1] : null;
}

export async function apiRequestBlob(
  path: string,
  options: { timeoutMs?: number } = {},
): Promise<BlobResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 60_000,
  );
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      credentials: "include",
      signal: controller.signal,
    });
    if (!response.ok) {
      if (response.status === 401) notifyUnauthorized(path);
      throw await parseError(response);
    }
    return {
      blob: await response.blob(),
      filename: filenameFromDisposition(
        response.headers.get("content-disposition"),
      ),
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiUnavailableError("The download timed out.");
    }
    throw new ApiUnavailableError();
  } finally {
    clearTimeout(timeout);
  }
}

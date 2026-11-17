export class OAuthProtocolError extends Error {
  readonly status: number;
  readonly code: string;
  readonly description?: string;
  readonly headers?: Record<string, string>;

  constructor(
    status: number,
    code: string,
    description?: string,
    headers?: Record<string, string>,
  ) {
    super(description ?? code);
    this.name = "OAuthProtocolError";
    this.status = status;
    this.code = code;
    this.description = description;
    this.headers = headers;
  }
}

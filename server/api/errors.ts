import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

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

export function errorBody(code: string, message: string, details?: unknown) {
  return {
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
    },
  };
}

export function zodDetails(error: ZodError): Array<{
  path: string;
  message: string;
}> {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

export function sendError(reply: FastifyReply, error: ApiError) {
  return reply
    .code(error.status)
    .send(errorBody(error.code, error.message, error.details));
}

export function notFoundHandler(_request: FastifyRequest, reply: FastifyReply) {
  return reply
    .code(404)
    .send(errorBody("not_found", "The requested resource was not found."));
}

export function errorHandler(
  error: FastifyError | ApiError | ZodError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (error instanceof ApiError) {
    return sendError(reply, error);
  }

  if (error instanceof ZodError) {
    return reply
      .code(422)
      .send(
        errorBody(
          "validation_failed",
          "The request did not match the API contract.",
          zodDetails(error),
        ),
      );
  }

  const statusCode = (error as FastifyError).statusCode;
  if (statusCode === 413) {
    return reply
      .code(413)
      .send(
        errorBody(
          "payload_too_large",
          "The request body is larger than the 10 MB limit.",
        ),
      );
  }
  if (statusCode === 400) {
    return reply
      .code(400)
      .send(errorBody("invalid_json", "The request body is not valid JSON."));
  }

  request.log.error({ err: error }, "Unhandled API error");
  return reply
    .code(500)
    .send(
      errorBody(
        "internal_error",
        "The server could not complete the request. Check the API logs.",
      ),
    );
}

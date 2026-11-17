import { MAX_ATTACHMENT_BASE64_LENGTH } from "../../src/domain/attachments";

/**
 * A maximum-size attachment is base64-encoded in the JSON upload body. Leave
 * room for the filename, JSON keys and surrounding envelope.
 */
export const ATTACHMENT_UPLOAD_BODY_LIMIT =
  MAX_ATTACHMENT_BASE64_LENGTH + 64 * 1024;

/**
 * MCP wraps the upload arguments in a JSON-RPC request and returns attachment
 * content in a text result, so its body limit is larger than the REST route.
 */
export const MCP_BODY_LIMIT = 15 * 1024 * 1024;

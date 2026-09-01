// Canonical bridge protocol — shared between DebugKits web app and the Chrome Extension.
// This is the SSOT. Both consumers import from this package.

export const BRIDGE_PROTOCOL_VERSION = "1" as const

export const REQUEST_BODY_SIZE_LIMIT = 10 * 1024 * 1024  // 10 MB
export const RESPONSE_BODY_SIZE_LIMIT = 20 * 1024 * 1024 // 20 MB
export const REQUEST_TIMEOUT_DEFAULT = 30_000
export const REQUEST_TIMEOUT_MAX = 300_000

export type HttpMethod =
  | "GET" | "POST" | "PUT" | "PATCH"
  | "DELETE" | "HEAD" | "OPTIONS"

export type ExtensionErrorCode =
  | "URL_INVALID"           // URL could not be parsed
  | "URL_PROTOCOL_BLOCKED"  // non-http(s) protocol rejected
  | "ORIGIN_FORBIDDEN"      // sender origin not in allowlist
  | "SCHEMA_INVALID"        // message failed schema validation
  | "REQUEST_BODY_TOO_LARGE"
  | "RESPONSE_TOO_LARGE"
  | "REQUEST_NOT_FOUND"     // cancel sent for unknown requestId
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "ABORTED"
  | "INTERNAL_ERROR"

// ── Web → Extension ─────────────────────────────────────────────────────────

export interface BridgeHttpRequest {
  type: "HTTP_REQUEST"
  version: typeof BRIDGE_PROTOCOL_VERSION
  requestId: string
  method: HttpMethod
  /** Fully resolved URL including query string (assembled on the web side) */
  url: string
  /** Fully resolved headers including auth (assembled on the web side) */
  headers: Record<string, string>
  /** Serialized body string. FormData is pre-encoded as application/x-www-form-urlencoded */
  body?: string
  /** Request timeout in ms. Clamped to [1000, REQUEST_TIMEOUT_MAX] */
  timeout?: number
}

export interface BridgeCancelRequest {
  type: "HTTP_CANCEL"
  version: typeof BRIDGE_PROTOCOL_VERSION
  requestId: string
}

export type WebToExtensionMessage = BridgeHttpRequest | BridgeCancelRequest

// ── Extension → Web ─────────────────────────────────────────────────────────

export interface BridgeSuccessResponse {
  type: "HTTP_RESPONSE"
  requestId: string
  status: number
  statusText: string
  headers: Record<string, string>
  /** Raw response body text */
  body: string
  /** Elapsed time in milliseconds */
  time: number
  /** Response body byte length */
  size: number
}

export interface BridgeErrorResponse {
  type: "HTTP_ERROR"
  requestId: string
  code: ExtensionErrorCode
  message: string
}

export type ExtensionToWebMessage = BridgeSuccessResponse | BridgeErrorResponse

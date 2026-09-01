// Security validation — runs in the background service worker before any request is executed.
// Two layers of origin checking: Chrome enforces externally_connectable at the manifest level,
// and this module re-validates at the code level so no single misconfiguration is exploitable.

import type { ExtensionErrorCode, WebToExtensionMessage } from "../types/protocol"
import { BRIDGE_PROTOCOL_VERSION } from "../types/protocol"

// Injected at build time by esbuild define. See scripts/build.mjs.
declare const __ALLOWED_ORIGINS__: string[]

const ALLOWED_ORIGINS: ReadonlySet<string> = new Set(__ALLOWED_ORIGINS__)
const ALLOWED_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:"])

export function validateSender(sender: chrome.runtime.MessageSender): ExtensionErrorCode | null {
  if (!sender.origin) return "ORIGIN_FORBIDDEN"
  if (!ALLOWED_ORIGINS.has(sender.origin)) return "ORIGIN_FORBIDDEN"
  // Prevent subpath spoofing: URL must start with the validated origin
  if (sender.url && !sender.url.startsWith(sender.origin)) return "ORIGIN_FORBIDDEN"
  return null
}

export function validateTargetUrl(url: string): ExtensionErrorCode | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return "URL_INVALID"
  }
  // Explicitly reject everything that is not http(s).
  // This blocks file://, chrome://, chrome-extension://, javascript:, data:, ftp:, etc.
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) return "URL_PROTOCOL_BLOCKED"
  return null
}

export function validateSchema(message: unknown): message is WebToExtensionMessage {
  if (!message || typeof message !== "object") return false
  const m = message as Record<string, unknown>

  if (m["version"] !== BRIDGE_PROTOCOL_VERSION) return false

  if (m["type"] === "HTTP_REQUEST") {
    return (
      typeof m["requestId"] === "string" &&
      m["requestId"].length > 0 &&
      typeof m["method"] === "string" &&
      typeof m["url"] === "string" &&
      m["url"].length > 0 &&
      (m["headers"] === undefined || (typeof m["headers"] === "object" && m["headers"] !== null)) &&
      (m["body"] === undefined || typeof m["body"] === "string") &&
      (m["timeout"] === undefined || typeof m["timeout"] === "number")
    )
  }

  if (m["type"] === "HTTP_CANCEL") {
    return typeof m["requestId"] === "string" && m["requestId"].length > 0
  }

  return false
}

// Security validation — runs in the background service worker before any request is executed.
// Two layers of origin checking: Chrome enforces externally_connectable at the manifest level,
// and this module re-validates at the code level so no single misconfiguration is exploitable.

import type { ExtensionErrorCode, WebToExtensionMessage } from "../types/protocol.ts"
import {
  BRIDGE_PROTOCOL_VERSION,
  ALLOWED_HTTP_METHODS,
  REQUEST_ID_MAX_LENGTH,
  REQUEST_TIMEOUT_MIN,
  REQUEST_TIMEOUT_MAX,
} from "../types/protocol.ts"

// Injected at build time by esbuild define (see scripts/build.mjs).
// Declared as possibly undefined so that direct execution in test environments
// (where the define substitution has not run) falls back safely to an empty set.
declare const __ALLOWED_ORIGINS__: string[] | undefined

const ALLOWED_ORIGINS: ReadonlySet<string> = new Set(
  typeof __ALLOWED_ORIGINS__ !== "undefined" ? __ALLOWED_ORIGINS__ : []
)
const ALLOWED_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:"])
const ALLOWED_METHODS_SET: ReadonlySet<string> = new Set(ALLOWED_HTTP_METHODS)

export function validateSender(sender: chrome.runtime.MessageSender): ExtensionErrorCode | null {
  if (!sender.origin) return "ORIGIN_FORBIDDEN"
  if (!ALLOWED_ORIGINS.has(sender.origin)) return "ORIGIN_FORBIDDEN"
  // Prevent subpath spoofing: URL must start with the validated origin
  if (sender.url && !sender.url.startsWith(sender.origin)) return "ORIGIN_FORBIDDEN"
  return null
}

/**
 * Returns true when the hostname is a loopback, link-local, or RFC-1918 private address.
 *
 * Covered ranges:
 *   IPv4  127.0.0.0/8   loopback
 *         10.0.0.0/8    private (class A)
 *         172.16.0.0/12 private (class B)
 *         192.168.0.0/16 private (class C)
 *         169.254.0.0/16 link-local
 *         0.0.0.0/8     unspecified
 *   IPv6  ::1            loopback
 *         ::             unspecified
 *         fc00::/7       ULA (fc** / fd**)
 *         fe80::/10      link-local (fe80–febf)
 *   Name  localhost / *.localhost (RFC 6761)
 *
 * KNOWN LIMITATION — DNS Rebinding:
 *   This check operates on the URL hostname string only. A public-looking domain
 *   (e.g. evil.example.com) that DNS-resolves to a private IP at request time will
 *   NOT be caught here, because the Chrome Extension JavaScript layer has no reliable
 *   way to observe the final resolved IP before fetch() completes. Full mitigation
 *   requires server-side DNS validation or Private Network Access headers
 *   (https://wicg.github.io/private-network-access/). This function eliminates the
 *   obvious direct-literal attack path; DNS rebinding remains a known residual risk.
 */
export function isPrivateOrLocalHost(hostname: string): boolean {
  // Strip surrounding brackets from IPv6 addresses as returned by URL.hostname.
  // new URL("http://[::1]/").hostname === "[::1]"; bare "::1" is required below.
  const h = (hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname).toLowerCase()

  // localhost and .localhost TLD (RFC 6761)
  if (h === "localhost" || h.endsWith(".localhost")) return true

  // IPv6 loopback, unspecified, ULA (fc00::/7), and link-local (fe80::/10)
  if (h === "::1" || h === "::") return true
  if (h.startsWith("fc") || h.startsWith("fd")) return true
  // fe80::/10 covers fe80:: through febf:: — second nibble 8, 9, a, or b
  if (/^fe[89ab][0-9a-f]:/.test(h)) return true

  // IPv4 — new URL() normalises short-form addresses for http(s) URLs per the
  // WHATWG spec (e.g. 127.1 → 127.0.0.1), so the hostname is always dotted-quad.
  const parts = h.split(".")
  if (parts.length === 4) {
    const octets = parts.map(Number)
    const valid = octets.every(
      (n, i) => Number.isInteger(n) && parts[i] === String(n) && n >= 0 && n <= 255
    )
    if (valid) {
      const [a, b] = octets
      if (a === 127) return true                      // 127.0.0.0/8   loopback
      if (a === 10) return true                       // 10.0.0.0/8    private
      if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12 private
      if (a === 192 && b === 168) return true         // 192.168.0.0/16 private
      if (a === 169 && b === 254) return true         // 169.254.0.0/16 link-local
      if (a === 0) return true                        // 0.0.0.0/8     unspecified
    }
  }

  return false
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
  // Block requests targeting localhost or private/link-local network ranges.
  if (isPrivateOrLocalHost(parsed.hostname)) return "PRIVATE_NETWORK_BLOCKED"
  return null
}

/**
 * Returns true if `v` is a plain object (not null, not an array) whose every
 * own-enumerable value is a string.  Used to validate the `headers` field.
 *
 * Note on prototype-pollution keys (__proto__, constructor, prototype):
 *   Messages arrive via chrome.runtime.onMessageExternal, which applies the
 *   structured-clone algorithm.  Structured clone sets __proto__ etc. as plain
 *   own properties, not as prototype setters — there is no actual pollution risk
 *   in the current code path.  The headers object is passed directly to fetch(),
 *   which handles it through the internal Headers class without Object.assign or
 *   spread.  We therefore validate value types only and do not special-case keys.
 */
function isPlainStringRecord(v: unknown): v is Record<string, string> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false
  return Object.entries(v as Record<string, unknown>).every(
    ([, val]) => typeof val === "string"
  )
}

/**
 * Runtime schema guard for messages received from external web pages.
 *
 * Validates each field against the protocol definition strictly:
 *   - method    must be one of the seven uppercase HttpMethod literals
 *   - headers   if present, must be a plain {string: string} object
 *   - timeout   if present, must be a finite number in [REQUEST_TIMEOUT_MIN, REQUEST_TIMEOUT_MAX]
 *   - requestId must be a non-empty string ≤ REQUEST_ID_MAX_LENGTH chars
 *   - url       must be a non-empty string (format/target validated downstream)
 *   - body      if present, must be a string (size validated in executor)
 *
 * Unknown extra fields are silently ignored for forward-compatibility.
 */
export function validateSchema(message: unknown): message is WebToExtensionMessage {
  if (!message || typeof message !== "object") return false
  const m = message as Record<string, unknown>

  if (m["version"] !== BRIDGE_PROTOCOL_VERSION) return false

  if (m["type"] === "HTTP_REQUEST") {
    // requestId: non-empty string, bounded length to prevent abuse
    if (
      typeof m["requestId"] !== "string" ||
      m["requestId"].length === 0 ||
      m["requestId"].length > REQUEST_ID_MAX_LENGTH
    ) return false

    // method: must be one of the defined uppercase HTTP methods
    if (!ALLOWED_METHODS_SET.has(m["method"] as string)) return false

    // url: non-empty string — format and target security are validated downstream
    if (typeof m["url"] !== "string" || m["url"].length === 0) return false

    // headers: if present, must be a plain {string → string} record
    if (m["headers"] !== undefined && !isPlainStringRecord(m["headers"])) return false

    // body: if present, must be a string (byte-size limit enforced in executor)
    if (m["body"] !== undefined && typeof m["body"] !== "string") return false

    // timeout: if present, must be a finite number within the supported range
    if (m["timeout"] !== undefined) {
      const t = m["timeout"]
      if (
        typeof t !== "number" ||
        !Number.isFinite(t) ||
        t < REQUEST_TIMEOUT_MIN ||
        t > REQUEST_TIMEOUT_MAX
      ) return false
    }

    return true
  }

  if (m["type"] === "HTTP_CANCEL") {
    return (
      typeof m["requestId"] === "string" &&
      m["requestId"].length > 0 &&
      m["requestId"].length <= REQUEST_ID_MAX_LENGTH
    )
  }

  return false
}

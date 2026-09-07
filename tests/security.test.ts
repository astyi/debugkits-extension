// Security regression tests for src/security/validator.ts
// Covers validateSender(), validateTargetUrl(), and isPrivateOrLocalHost().
//
// IMPORTANT — validateSender() ALLOW path limitation:
//   In the Node.js test environment, __ALLOWED_ORIGINS__ is not substituted by
//   esbuild, so ALLOWED_ORIGINS is always an empty Set. As a result, the ALLOW
//   path (returning null for https://debugkits.com / https://www.debugkits.com)
//   cannot be unit-tested here without modifying runtime source (dependency
//   injection) or switching to an esbuild-compiled test bundle.
//   Only BLOCK paths are exercised below. The ALLOW path is verified by the
//   production build + verify-manifest.mjs + manual Chrome smoke test.

import { test } from "node:test"
import assert from "node:assert/strict"
import { validateSender, validateTargetUrl, isPrivateOrLocalHost } from "../src/security/validator.ts"

// Convenience wrapper: creates a minimal MessageSender-shaped object.
// Tests/ is excluded from tsconfig so there's no compile-time check here —
// types are stripped by Node's native TypeScript support at runtime.
function sender(fields: { origin?: string; url?: string }): Parameters<typeof validateSender>[0] {
  return fields as Parameters<typeof validateSender>[0]
}

// ── validateSender — BLOCK paths ─────────────────────────────────────────────

test("validateSender — BLOCK: no origin field", () => {
  assert.equal(validateSender(sender({})), "ORIGIN_FORBIDDEN")
})

test("validateSender — BLOCK: undefined origin", () => {
  assert.equal(validateSender(sender({ origin: undefined })), "ORIGIN_FORBIDDEN")
})

test("validateSender — BLOCK: empty string origin", () => {
  assert.equal(validateSender(sender({ origin: "" })), "ORIGIN_FORBIDDEN")
})

test("validateSender — BLOCK: https://evil.com not in allowlist", () => {
  assert.equal(
    validateSender(sender({ origin: "https://evil.com" })),
    "ORIGIN_FORBIDDEN"
  )
})

test("validateSender — BLOCK: subdomain-spoof debugkits.com.evil.com", () => {
  assert.equal(
    validateSender(sender({ origin: "https://debugkits.com.evil.com" })),
    "ORIGIN_FORBIDDEN"
  )
})

test("validateSender — BLOCK: http:// scheme for debugkits.com (wrong scheme)", () => {
  assert.equal(
    validateSender(sender({ origin: "http://debugkits.com" })),
    "ORIGIN_FORBIDDEN"
  )
})

// ── validateTargetUrl — ALLOW ─────────────────────────────────────────────────

test("validateTargetUrl — ALLOW: https public API", () => {
  assert.equal(validateTargetUrl("https://api.example.com/data"), null)
})

test("validateTargetUrl — ALLOW: http public API", () => {
  assert.equal(validateTargetUrl("http://api.example.com/data"), null)
})

// ── validateTargetUrl — BLOCK: invalid / unparseable ─────────────────────────

test("validateTargetUrl — BLOCK: invalid URL string", () => {
  assert.equal(validateTargetUrl("not a url"), "URL_INVALID")
})

test("validateTargetUrl — BLOCK: empty string", () => {
  assert.equal(validateTargetUrl(""), "URL_INVALID")
})

// ── validateTargetUrl — BLOCK: forbidden protocols ───────────────────────────

test("validateTargetUrl — BLOCK: ftp:// protocol", () => {
  assert.equal(validateTargetUrl("ftp://files.example.com/file.txt"), "URL_PROTOCOL_BLOCKED")
})

test("validateTargetUrl — BLOCK: file:// protocol", () => {
  assert.equal(validateTargetUrl("file:///etc/passwd"), "URL_PROTOCOL_BLOCKED")
})

test("validateTargetUrl — BLOCK: chrome-extension:// protocol", () => {
  assert.equal(validateTargetUrl("chrome-extension://abcdefgh/page.html"), "URL_PROTOCOL_BLOCKED")
})

test("validateTargetUrl — BLOCK: data: URI", () => {
  assert.equal(validateTargetUrl("data:text/html,<h1>hi</h1>"), "URL_PROTOCOL_BLOCKED")
})

// ── validateTargetUrl — BLOCK: private / local network ───────────────────────

test("validateTargetUrl — BLOCK: localhost", () => {
  assert.equal(validateTargetUrl("http://localhost/api"), "PRIVATE_NETWORK_BLOCKED")
})

test("validateTargetUrl — BLOCK: localhost with port", () => {
  assert.equal(validateTargetUrl("http://localhost:3000/api"), "PRIVATE_NETWORK_BLOCKED")
})

test("validateTargetUrl — BLOCK: 127.0.0.1 loopback", () => {
  assert.equal(validateTargetUrl("http://127.0.0.1/api"), "PRIVATE_NETWORK_BLOCKED")
})

test("validateTargetUrl — BLOCK: 127.0.0.1 with port", () => {
  assert.equal(validateTargetUrl("http://127.0.0.1:8080/api"), "PRIVATE_NETWORK_BLOCKED")
})

test("validateTargetUrl — BLOCK: 192.168.1.1 RFC-1918", () => {
  assert.equal(validateTargetUrl("https://192.168.1.1/api"), "PRIVATE_NETWORK_BLOCKED")
})

test("validateTargetUrl — BLOCK: 10.0.0.1 RFC-1918", () => {
  assert.equal(validateTargetUrl("https://10.0.0.1/api"), "PRIVATE_NETWORK_BLOCKED")
})

test("validateTargetUrl — BLOCK: 172.16.0.1 RFC-1918", () => {
  assert.equal(validateTargetUrl("https://172.16.0.1/api"), "PRIVATE_NETWORK_BLOCKED")
})

test("validateTargetUrl — BLOCK: IPv6 loopback [::1] URL-form", () => {
  assert.equal(validateTargetUrl("http://[::1]/api"), "PRIVATE_NETWORK_BLOCKED")
})

test("validateTargetUrl — BLOCK: IPv6 link-local [fe80::1] URL-form", () => {
  assert.equal(validateTargetUrl("http://[fe80::1]/api"), "PRIVATE_NETWORK_BLOCKED")
})

test("validateTargetUrl — BLOCK: IPv6 ULA [fc00::1] URL-form", () => {
  assert.equal(validateTargetUrl("http://[fc00::1]/api"), "PRIVATE_NETWORK_BLOCKED")
})

test("validateTargetUrl — BLOCK: IPv6 ULA [fd12::1] URL-form", () => {
  assert.equal(validateTargetUrl("http://[fd12::1]/api"), "PRIVATE_NETWORK_BLOCKED")
})

// ── isPrivateOrLocalHost ──────────────────────────────────────────────────────

test("isPrivateOrLocalHost — localhost", () => {
  assert.equal(isPrivateOrLocalHost("localhost"), true)
})

test("isPrivateOrLocalHost — LOCALHOST case-insensitive", () => {
  assert.equal(isPrivateOrLocalHost("LOCALHOST"), true)
})

test("isPrivateOrLocalHost — sub.localhost (.localhost TLD)", () => {
  assert.equal(isPrivateOrLocalHost("sub.localhost"), true)
})

test("isPrivateOrLocalHost — ::1 IPv6 loopback", () => {
  assert.equal(isPrivateOrLocalHost("::1"), true)
})

test("isPrivateOrLocalHost — :: IPv6 unspecified", () => {
  assert.equal(isPrivateOrLocalHost("::"), true)
})

test("isPrivateOrLocalHost — fc00::1 IPv6 ULA (fc00::/7)", () => {
  assert.equal(isPrivateOrLocalHost("fc00::1"), true)
})

test("isPrivateOrLocalHost — fd12:3456::1 IPv6 ULA (fd prefix)", () => {
  assert.equal(isPrivateOrLocalHost("fd12:3456::1"), true)
})

test("isPrivateOrLocalHost — fe80::1 IPv6 link-local (fe80::/10)", () => {
  assert.equal(isPrivateOrLocalHost("fe80::1"), true)
})

test("isPrivateOrLocalHost — 127.0.0.1 loopback", () => {
  assert.equal(isPrivateOrLocalHost("127.0.0.1"), true)
})

test("isPrivateOrLocalHost — 127.255.255.255 loopback (127/8 edge)", () => {
  assert.equal(isPrivateOrLocalHost("127.255.255.255"), true)
})

test("isPrivateOrLocalHost — 10.0.0.1 private class A", () => {
  assert.equal(isPrivateOrLocalHost("10.0.0.1"), true)
})

test("isPrivateOrLocalHost — 172.16.0.1 private class B", () => {
  assert.equal(isPrivateOrLocalHost("172.16.0.1"), true)
})

test("isPrivateOrLocalHost — 172.31.255.255 private class B upper boundary", () => {
  assert.equal(isPrivateOrLocalHost("172.31.255.255"), true)
})

test("isPrivateOrLocalHost — 172.15.0.1 NOT private (below 172.16/12)", () => {
  assert.equal(isPrivateOrLocalHost("172.15.0.1"), false)
})

test("isPrivateOrLocalHost — 172.32.0.1 NOT private (above 172.31/12)", () => {
  assert.equal(isPrivateOrLocalHost("172.32.0.1"), false)
})

test("isPrivateOrLocalHost — 192.168.0.1 private class C", () => {
  assert.equal(isPrivateOrLocalHost("192.168.0.1"), true)
})

test("isPrivateOrLocalHost — 169.254.1.1 link-local", () => {
  assert.equal(isPrivateOrLocalHost("169.254.1.1"), true)
})

test("isPrivateOrLocalHost — 0.0.0.1 unspecified range (0/8)", () => {
  assert.equal(isPrivateOrLocalHost("0.0.0.1"), true)
})

test("isPrivateOrLocalHost — 8.8.8.8 public (should be false)", () => {
  assert.equal(isPrivateOrLocalHost("8.8.8.8"), false)
})

test("isPrivateOrLocalHost — 1.1.1.1 public (should be false)", () => {
  assert.equal(isPrivateOrLocalHost("1.1.1.1"), false)
})

test("isPrivateOrLocalHost — api.example.com public domain (should be false)", () => {
  assert.equal(isPrivateOrLocalHost("api.example.com"), false)
})

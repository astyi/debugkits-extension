// Tests for src/security/validator.ts — runtime schema validation.
// Verifies that validateSchema correctly accepts well-formed messages and
// rejects every category of malformed input that the runtime validator must catch.

import { test } from "node:test"
import assert from "node:assert/strict"
import { validateSchema } from "../src/security/validator.ts"
import { REQUEST_TIMEOUT_MIN, REQUEST_TIMEOUT_MAX, REQUEST_ID_MAX_LENGTH } from "../src/types/protocol.ts"

// ── helpers ────────────────────────────────────────────────────────────────

/** A minimal valid HTTP_REQUEST that all invalid-case tests mutate. */
function validRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: "1",
    type: "HTTP_REQUEST",
    requestId: "req-abc-123",
    method: "GET",
    url: "https://api.example.com/data",
    headers: { Authorization: "Bearer token", "Content-Type": "application/json" },
    ...overrides,
  }
}

/** A minimal valid HTTP_CANCEL. */
function validCancel(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: "1",
    type: "HTTP_CANCEL",
    requestId: "req-abc-123",
    ...overrides,
  }
}

// ── Valid cases ────────────────────────────────────────────────────────────

test("valid — GET request with headers and no optional fields", () => {
  assert.equal(validateSchema(validRequest()), true)
})

test("valid — POST request with body and timeout", () => {
  assert.equal(
    validateSchema(validRequest({ method: "POST", body: '{"x":1}', timeout: 30_000 })),
    true
  )
})

test("valid — all supported HTTP methods are accepted", () => {
  for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
    assert.equal(validateSchema(validRequest({ method })), true, `method ${method} should be valid`)
  }
})

test("valid — request with no optional fields (no headers, body, timeout)", () => {
  const msg = {
    version: "1",
    type: "HTTP_REQUEST",
    requestId: "req-1",
    method: "DELETE",
    url: "https://api.example.com/item/1",
  }
  assert.equal(validateSchema(msg), true)
})

test("valid — request with empty headers object", () => {
  assert.equal(validateSchema(validRequest({ headers: {} })), true)
})

test("valid — timeout at minimum boundary", () => {
  assert.equal(validateSchema(validRequest({ timeout: REQUEST_TIMEOUT_MIN })), true)
})

test("valid — timeout at maximum boundary", () => {
  assert.equal(validateSchema(validRequest({ timeout: REQUEST_TIMEOUT_MAX })), true)
})

test("valid — requestId at maximum length", () => {
  assert.equal(
    validateSchema(validRequest({ requestId: "a".repeat(REQUEST_ID_MAX_LENGTH) })),
    true
  )
})

test("valid — HTTP_CANCEL", () => {
  assert.equal(validateSchema(validCancel()), true)
})

// ── method ─────────────────────────────────────────────────────────────────

test("invalid — method: unknown string", () => {
  assert.equal(validateSchema(validRequest({ method: "WHATEVER" })), false)
})

test("invalid — method: lowercase (protocol requires uppercase)", () => {
  assert.equal(validateSchema(validRequest({ method: "get" })), false)
})

test("invalid — method: number", () => {
  assert.equal(validateSchema(validRequest({ method: 123 })), false)
})

test("invalid — method: empty string", () => {
  assert.equal(validateSchema(validRequest({ method: "" })), false)
})

test("invalid — method: missing", () => {
  const { method: _m, ...noMethod } = validRequest() as { method: unknown } & Record<string, unknown>
  assert.equal(validateSchema(noMethod), false)
})

// ── headers ────────────────────────────────────────────────────────────────

test("invalid — headers: array", () => {
  assert.equal(validateSchema(validRequest({ headers: ["Authorization", "Bearer x"] })), false)
})

test("invalid — headers: null", () => {
  assert.equal(validateSchema(validRequest({ headers: null })), false)
})

test("invalid — headers: number value", () => {
  assert.equal(validateSchema(validRequest({ headers: { Accept: 123 } })), false)
})

test("invalid — headers: nested object value", () => {
  assert.equal(validateSchema(validRequest({ headers: { Accept: { type: "json" } } })), false)
})

test("invalid — headers: boolean value", () => {
  assert.equal(validateSchema(validRequest({ headers: { "X-Flag": true } })), false)
})

// ── timeout ────────────────────────────────────────────────────────────────

test("invalid — timeout: NaN", () => {
  assert.equal(validateSchema(validRequest({ timeout: NaN })), false)
})

test("invalid — timeout: Infinity", () => {
  assert.equal(validateSchema(validRequest({ timeout: Infinity })), false)
})

test("invalid — timeout: -Infinity", () => {
  assert.equal(validateSchema(validRequest({ timeout: -Infinity })), false)
})

test("invalid — timeout: negative", () => {
  assert.equal(validateSchema(validRequest({ timeout: -1 })), false)
})

test("invalid — timeout: zero", () => {
  assert.equal(validateSchema(validRequest({ timeout: 0 })), false)
})

test("invalid — timeout: below minimum", () => {
  assert.equal(validateSchema(validRequest({ timeout: REQUEST_TIMEOUT_MIN - 1 })), false)
})

test("invalid — timeout: above maximum", () => {
  assert.equal(validateSchema(validRequest({ timeout: REQUEST_TIMEOUT_MAX + 1 })), false)
})

test("invalid — timeout: string", () => {
  assert.equal(validateSchema(validRequest({ timeout: "30000" })), false)
})

// ── requestId ──────────────────────────────────────────────────────────────

test("invalid — requestId: empty string", () => {
  assert.equal(validateSchema(validRequest({ requestId: "" })), false)
})

test("invalid — requestId: exceeds max length", () => {
  assert.equal(
    validateSchema(validRequest({ requestId: "a".repeat(REQUEST_ID_MAX_LENGTH + 1) })),
    false
  )
})

test("invalid — requestId: number", () => {
  assert.equal(validateSchema(validRequest({ requestId: 42 })), false)
})

// ── url ────────────────────────────────────────────────────────────────────

test("invalid — url: empty string", () => {
  assert.equal(validateSchema(validRequest({ url: "" })), false)
})

test("invalid — url: number", () => {
  assert.equal(validateSchema(validRequest({ url: 123 })), false)
})

// ── body ───────────────────────────────────────────────────────────────────

test("invalid — body: plain object", () => {
  assert.equal(validateSchema(validRequest({ body: { data: "x" } })), false)
})

test("invalid — body: array", () => {
  assert.equal(validateSchema(validRequest({ body: [] })), false)
})

test("invalid — body: number", () => {
  assert.equal(validateSchema(validRequest({ body: 42 })), false)
})

// ── message type / structure ───────────────────────────────────────────────

test("invalid — unknown type", () => {
  assert.equal(validateSchema(validRequest({ type: "PING" })), false)
})

test("invalid — Extension response type used as input (HTTP_RESPONSE)", () => {
  assert.equal(validateSchema({ version: "1", type: "HTTP_RESPONSE", requestId: "r" }), false)
})

test("invalid — Extension error type used as input (HTTP_ERROR)", () => {
  assert.equal(validateSchema({ version: "1", type: "HTTP_ERROR", requestId: "r" }), false)
})

test("invalid — wrong protocol version", () => {
  assert.equal(validateSchema(validRequest({ version: "0" })), false)
})

test("invalid — missing version", () => {
  const { version: _v, ...noVersion } = validRequest() as { version: unknown } & Record<string, unknown>
  assert.equal(validateSchema(noVersion), false)
})

test("invalid — not an object (string)", () => {
  assert.equal(validateSchema("HTTP_REQUEST"), false)
})

test("invalid — not an object (null)", () => {
  assert.equal(validateSchema(null), false)
})

// ── HTTP_CANCEL edge cases ─────────────────────────────────────────────────

test("invalid — HTTP_CANCEL: empty requestId", () => {
  assert.equal(validateSchema(validCancel({ requestId: "" })), false)
})

test("invalid — HTTP_CANCEL: requestId exceeds max length", () => {
  assert.equal(
    validateSchema(validCancel({ requestId: "x".repeat(REQUEST_ID_MAX_LENGTH + 1) })),
    false
  )
})

test("invalid — HTTP_CANCEL: missing requestId", () => {
  assert.equal(validateSchema({ version: "1", type: "HTTP_CANCEL" }), false)
})

test("invalid — HTTP_CANCEL: wrong version", () => {
  assert.equal(validateSchema(validCancel({ version: "2" })), false)
})

// ── Unknown extra fields (forward-compat: should be ignored) ───────────────

test("valid — unknown extra field is silently ignored", () => {
  assert.equal(
    validateSchema(validRequest({ futureField: "someValue", anotherNew: 42 })),
    true
  )
})

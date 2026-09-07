// Tests for src/network/executor.ts — duplicate requestId handling and lifecycle cleanup.
// Run via: npm test  (scripts/test.mjs bundles this with esbuild and runs it under node:test)

import { test } from "node:test"
import assert from "node:assert/strict"
import { executeRequest, cancelRequest } from "../src/network/executor.ts"
import { RESPONSE_BODY_SIZE_LIMIT } from "../src/types/protocol.ts"
import type { BridgeHttpRequest, BridgeErrorResponse, BridgeSuccessResponse } from "../src/types/protocol.ts"

// ── helpers ────────────────────────────────────────────────────────────────

function makeReq(id: string, overrides: Partial<BridgeHttpRequest> = {}): BridgeHttpRequest {
  return {
    type: "HTTP_REQUEST",
    version: "1",
    requestId: id,
    method: "GET",
    url: "https://example.com",
    headers: {},
    ...overrides,
  }
}

function okResponse(body = "ok"): Response {
  return new Response(body, { status: 200, statusText: "OK" })
}

/**
 * Returns a controllable fetch stand-in.
 * The pending promise auto-rejects with signal.reason when the abort signal fires,
 * matching the behaviour of the real Fetch API.
 */
function pendingFetch(): {
  mock: (url: string, init?: RequestInit) => Promise<Response>
  resolve: (r?: Response) => void
  reject: (e: unknown) => void
} {
  let _resolve!: (r: Response) => void
  let _reject!: (e: unknown) => void

  const mock = (_url: string, init?: RequestInit): Promise<Response> =>
    new Promise<Response>((res, rej) => {
      _resolve = res
      _reject = rej
      init?.signal?.addEventListener(
        "abort",
        () => rej((init.signal as AbortSignal).reason),
        { once: true }
      )
    })

  return {
    mock,
    resolve: (r: Response = okResponse()) => _resolve(r),
    reject: (e: unknown) => _reject(e),
  }
}

// ── tests (sequential — node:test runs top-level tests serially) ───────────

// 1. Duplicate in-flight ID is rejected; original completes normally.
test("1 — duplicate requestId rejected while original is in flight", async () => {
  const f = pendingFetch()
  globalThis.fetch = f.mock as typeof fetch

  const pA = executeRequest(makeReq("t1"))

  // B sent while A is still awaiting its fetch — must be rejected immediately
  const resultB = await executeRequest(makeReq("t1"))
  assert.equal(resultB.type, "HTTP_ERROR")
  assert.equal((resultB as BridgeErrorResponse).code, "DUPLICATE_REQUEST_ID")

  // A is still running; resolve it and verify normal completion
  f.resolve()
  const resultA = await pA
  assert.equal(resultA.type, "HTTP_RESPONSE")
})

// 2. Completed requestId can be reused without error.
test("2 — requestId is reusable after original completes", async () => {
  const f1 = pendingFetch()
  globalThis.fetch = f1.mock as typeof fetch
  const pA = executeRequest(makeReq("t2"))
  f1.resolve()
  assert.equal((await pA).type, "HTTP_RESPONSE")

  // Same ID — should succeed now that A is done
  const f2 = pendingFetch()
  globalThis.fetch = f2.mock as typeof fetch
  const pB = executeRequest(makeReq("t2"))
  f2.resolve()
  assert.equal((await pB).type, "HTTP_RESPONSE")
})

// 3. Concurrent requests with different IDs all complete successfully.
test("3 — concurrent requests with distinct IDs all succeed", async () => {
  const fetches = [pendingFetch(), pendingFetch(), pendingFetch()]
  let call = 0
  // Route each fetch call to the matching pendingFetch instance by call order
  globalThis.fetch = ((url: string, init?: RequestInit) =>
    fetches[call++].mock(url, init)) as typeof fetch

  const pA = executeRequest(makeReq("t3a"))
  const pB = executeRequest(makeReq("t3b"))
  const pC = executeRequest(makeReq("t3c"))

  fetches[0].resolve()
  fetches[1].resolve()
  fetches[2].resolve()

  const [rA, rB, rC] = await Promise.all([pA, pB, pC])
  assert.equal(rA.type, "HTTP_RESPONSE")
  assert.equal(rB.type, "HTTP_RESPONSE")
  assert.equal(rC.type, "HTTP_RESPONSE")
})

// 4. Cancel targets the original when a duplicate has already been rejected.
test("4 — cancelRequest targets original after duplicate is rejected", async () => {
  const f = pendingFetch()
  globalThis.fetch = f.mock as typeof fetch

  const pA = executeRequest(makeReq("t4"))

  // B is rejected — A is still registered
  const resultB = await executeRequest(makeReq("t4"))
  assert.equal((resultB as BridgeErrorResponse).code, "DUPLICATE_REQUEST_ID")

  // Cancel must reach A (the only active request for this ID)
  assert.equal(cancelRequest("t4"), true)
  const resultA = await pA
  assert.equal(resultA.type, "HTTP_ERROR")
  assert.equal((resultA as BridgeErrorResponse).code, "ABORTED")
})

// 5. Timeout cleans up the requestId — the same ID can be reused after expiry.
test("5 — timeout cleans up requestId; ID reusable afterwards", { timeout: 5_000 }, async (t) => {
  t.diagnostic("waiting ~1 s for minimum timeout (1000 ms) to fire")

  const f = pendingFetch()
  globalThis.fetch = f.mock as typeof fetch

  // timeout: 1 is clamped to 1000 ms (REQUEST_TIMEOUT_MIN) by the executor
  const pA = executeRequest(makeReq("t5", { timeout: 1 }))

  await new Promise<void>((r) => setTimeout(r, 1_100))

  const resultA = await pA
  assert.equal(resultA.type, "HTTP_ERROR")
  assert.equal((resultA as BridgeErrorResponse).code, "TIMEOUT")

  // activeRequests must be clean — a new request with the same ID must not get DUPLICATE_REQUEST_ID
  const f2 = pendingFetch()
  globalThis.fetch = f2.mock as typeof fetch
  const pB = executeRequest(makeReq("t5"))
  f2.resolve()
  assert.equal((await pB).type, "HTTP_RESPONSE")
})

// 6. Network error cleans up the requestId — the same ID can be reused after.
test("6 — network error cleans up requestId; ID reusable afterwards", async () => {
  globalThis.fetch = (() =>
    Promise.reject(new TypeError("Failed to fetch"))) as typeof fetch

  const resultA = await executeRequest(makeReq("t6"))
  assert.equal(resultA.type, "HTTP_ERROR")
  assert.equal((resultA as BridgeErrorResponse).code, "NETWORK_ERROR")

  const f2 = pendingFetch()
  globalThis.fetch = f2.mock as typeof fetch
  const pB = executeRequest(makeReq("t6"))
  f2.resolve()
  assert.equal((await pB).type, "HTTP_RESPONSE")
})

// ── Streaming response body tests ──────────────────────────────────────────

/**
 * Build a Response whose body is a ReadableStream that yields each chunk in
 * order.  Gives tests full control over chunking without allocating one huge
 * contiguous buffer upfront.
 */
function chunkedResponse(chunks: Uint8Array[], status = 200): Response {
  let i = 0
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(chunks[i++])
      } else {
        controller.close()
      }
    },
  })
  return new Response(stream, { status })
}

// 7. Response body that exceeds 20 MB is rejected before being fully buffered.
//    Two chunks that together exceed RESPONSE_BODY_SIZE_LIMIT are used so the
//    limit is tripped mid-stream, not after a single contiguous read.
test("7 — streaming response over limit returns RESPONSE_TOO_LARGE", async () => {
  const half = Math.floor(RESPONSE_BODY_SIZE_LIMIT / 2)
  const chunk1 = new Uint8Array(half + 1)   // slightly over half
  const chunk2 = new Uint8Array(half + 1)   // causes cumulative total to exceed limit

  globalThis.fetch = (() =>
    Promise.resolve(chunkedResponse([chunk1, chunk2]))) as typeof fetch

  const result = await executeRequest(makeReq("t7"))
  assert.equal(result.type, "HTTP_ERROR")
  assert.equal((result as BridgeErrorResponse).code, "RESPONSE_TOO_LARGE")
})

// 8. Multi-byte UTF-8 characters split across chunk boundaries are decoded
//    correctly, and `size` reflects the true byte count (not string .length).
//
//    "中" encodes to 3 bytes in UTF-8: [0xe4, 0xb8, 0xad].
//    Splitting after the first 2 bytes and decoding each chunk independently
//    would produce garbage; accumulating then decoding once must give "中A".
test("8 — UTF-8 across chunk boundary decoded correctly; size is byte count", async () => {
  // chunk1 holds the first 2 bytes of "中" (incomplete sequence)
  // chunk2 holds the final byte of "中" plus ASCII 'A' (0x41)
  const chunk1 = new Uint8Array([0xe4, 0xb8])
  const chunk2 = new Uint8Array([0xad, 0x41])

  globalThis.fetch = (() =>
    Promise.resolve(chunkedResponse([chunk1, chunk2]))) as typeof fetch

  const result = await executeRequest(makeReq("t8"))
  assert.equal(result.type, "HTTP_RESPONSE")
  const r = result as BridgeSuccessResponse
  assert.equal(r.body, "中A")     // correct UTF-8 decoding across the boundary
  assert.equal(r.size, 4)         // 3 bytes for "中" + 1 byte for "A" — not string .length (2)
})

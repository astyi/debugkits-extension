// HTTP request executor running in the background service worker.
// Manages concurrent requests via a Map<requestId, RequestContext>.
// All paths (success, error, timeout, cancel) clean up the entry from the map.

import type {
  BridgeHttpRequest,
  BridgeSuccessResponse,
  BridgeErrorResponse,
  ExtensionErrorCode,
} from "../types/protocol.ts"
import {
  REQUEST_BODY_SIZE_LIMIT,
  RESPONSE_BODY_SIZE_LIMIT,
  REQUEST_TIMEOUT_MIN,
  REQUEST_TIMEOUT_DEFAULT,
  REQUEST_TIMEOUT_MAX,
} from "../types/protocol.ts"

interface RequestContext {
  controller: AbortController
  timeoutId: ReturnType<typeof setTimeout>
}

const activeRequests = new Map<string, RequestContext>()

/** Cancel an in-flight request. Returns false if requestId is not found. */
export function cancelRequest(requestId: string): boolean {
  const ctx = activeRequests.get(requestId)
  if (!ctx) return false
  clearTimeout(ctx.timeoutId)
  ctx.controller.abort(new DOMException("Cancelled by client", "AbortError"))
  activeRequests.delete(requestId)
  return true
}

// Identity-based cleanup: only deletes the map entry when it still points to
// the exact context this call owns. Prevents a completing request from
// accidentally evicting a later request that reused the same requestId.
function cleanup(requestId: string, ctx: RequestContext): void {
  if (activeRequests.get(requestId) === ctx) {
    clearTimeout(ctx.timeoutId)
    activeRequests.delete(requestId)
  }
}

function errorResponse(
  requestId: string,
  code: ExtensionErrorCode,
  message: string
): BridgeErrorResponse {
  return { type: "HTTP_ERROR", requestId, code, message }
}

/**
 * Read a ReadableStream chunk-by-chunk, stopping as soon as the accumulated
 * byte count exceeds the limit.  Returns the chunks on success, or null when
 * the limit is exceeded (so the caller can return RESPONSE_TOO_LARGE without
 * allocating a merged buffer for an oversized response).
 *
 * Decoding is intentionally deferred to the caller: accumulating raw bytes
 * and decoding once is correct for multi-byte UTF-8 sequences that span chunk
 * boundaries — decoding each chunk independently would corrupt them.
 */
async function readBodyStream(
  stream: ReadableStream<Uint8Array>,
  limit: number
): Promise<{ chunks: Uint8Array[]; totalBytes: number } | null> {
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  const reader = stream.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > limit) {
        return null  // exceeded — caller returns RESPONSE_TOO_LARGE
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return { chunks, totalBytes }
}

export async function executeRequest(
  req: BridgeHttpRequest
): Promise<BridgeSuccessResponse | BridgeErrorResponse> {
  const {
    requestId,
    method,
    url,
    headers,
    body,
    timeout: timeoutMs = REQUEST_TIMEOUT_DEFAULT,
  } = req

  // Validate and clamp timeout
  const effectiveTimeout = Math.min(Math.max(timeoutMs, REQUEST_TIMEOUT_MIN), REQUEST_TIMEOUT_MAX)

  // Validate request body size before sending
  if (body !== undefined) {
    const bodyBytes = new TextEncoder().encode(body).length
    if (bodyBytes > REQUEST_BODY_SIZE_LIMIT) {
      return errorResponse(
        requestId,
        "REQUEST_BODY_TOO_LARGE",
        `Request body ${(bodyBytes / 1024 / 1024).toFixed(1)} MB exceeds ${REQUEST_BODY_SIZE_LIMIT / 1024 / 1024} MB limit`
      )
    }
  }

  // Reject duplicate requestId before allocating any resources.
  // A caller that reuses an in-flight ID gets an immediate error; the original
  // request continues unaffected and its lifecycle remains intact.
  if (activeRequests.has(requestId)) {
    return errorResponse(
      requestId,
      "DUPLICATE_REQUEST_ID",
      `Request ID "${requestId}" is already in flight`
    )
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => {
    controller.abort(new DOMException("Request timed out", "TimeoutError"))
  }, effectiveTimeout)

  const ctx: RequestContext = { controller, timeoutId }
  activeRequests.set(requestId, ctx)

  const t0 = performance.now()

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: ["GET", "HEAD", "OPTIONS"].includes(method) ? undefined : body,
      signal: controller.signal,
    })

    // Record time-to-first-byte (after headers received, before body is read).
    const time = Math.round(performance.now() - t0)

    // Stream the response body chunk-by-chunk, enforcing the size limit before
    // the entire body is in memory.  Without streaming, res.text() would buffer
    // a 500 MB response completely before the limit check could run.
    let resText: string
    let totalBytes: number

    if (!res.body) {
      // No body: HEAD requests, 204/205 No Content, etc.
      resText = ""
      totalBytes = 0
    } else {
      const result = await readBodyStream(res.body, RESPONSE_BODY_SIZE_LIMIT)
      if (result === null) {
        return errorResponse(
          requestId,
          "RESPONSE_TOO_LARGE",
          `Response body exceeds ${RESPONSE_BODY_SIZE_LIMIT / 1024 / 1024} MB limit`
        )
      }
      // Merge all chunks into one contiguous buffer, then decode in a single
      // pass.  Decoding each chunk independently would corrupt multi-byte UTF-8
      // sequences (e.g. a 3-byte CJK character) that span chunk boundaries.
      const merged = new Uint8Array(result.totalBytes)
      let offset = 0
      for (const chunk of result.chunks) {
        merged.set(chunk, offset)
        offset += chunk.byteLength
      }
      resText = new TextDecoder().decode(merged)
      totalBytes = result.totalBytes
    }

    const resHeaders: Record<string, string> = {}
    res.headers.forEach((v, k) => { resHeaders[k] = v })

    return {
      type: "HTTP_RESPONSE",
      requestId,
      status: res.status,
      statusText: res.statusText,
      headers: resHeaders,
      body: resText,
      time,
      size: totalBytes,   // actual byte count, not string .length (differs for multi-byte UTF-8)
    }
  } catch (e: unknown) {
    const err = e as Error
    // DOMException name "TimeoutError" is set by our setTimeout abort above.
    // "AbortError" can come from our setTimeout or from cancelRequest().
    if (err.name === "TimeoutError") {
      return errorResponse(requestId, "TIMEOUT", `Request timed out after ${effectiveTimeout}ms`)
    }
    if (err.name === "AbortError") {
      return errorResponse(requestId, "ABORTED", "Request was cancelled")
    }
    return errorResponse(requestId, "NETWORK_ERROR", err.message ?? "Network error")
  } finally {
    cleanup(requestId, ctx)
  }
}

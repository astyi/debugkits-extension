// HTTP request executor running in the background service worker.
// Manages concurrent requests via a Map<requestId, RequestContext>.
// All paths (success, error, timeout, cancel) clean up the entry from the map.

import type {
  BridgeHttpRequest,
  BridgeSuccessResponse,
  BridgeErrorResponse,
  ExtensionErrorCode,
} from "../types/protocol"
import {
  REQUEST_BODY_SIZE_LIMIT,
  RESPONSE_BODY_SIZE_LIMIT,
  REQUEST_TIMEOUT_DEFAULT,
  REQUEST_TIMEOUT_MAX,
} from "../types/protocol"

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

function cleanup(requestId: string): void {
  const ctx = activeRequests.get(requestId)
  if (ctx) {
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
  const effectiveTimeout = Math.min(Math.max(timeoutMs, 1_000), REQUEST_TIMEOUT_MAX)

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

  const controller = new AbortController()
  const timeoutId = setTimeout(() => {
    controller.abort(new DOMException("Request timed out", "TimeoutError"))
  }, effectiveTimeout)

  activeRequests.set(requestId, { controller, timeoutId })

  const t0 = performance.now()

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: ["GET", "HEAD", "OPTIONS"].includes(method) ? undefined : body,
      signal: controller.signal,
    })

    const time = Math.round(performance.now() - t0)
    const resText = await res.text()

    // Validate response body size
    const resBytes = new TextEncoder().encode(resText)
    if (resBytes.length > RESPONSE_BODY_SIZE_LIMIT) {
      return errorResponse(
        requestId,
        "RESPONSE_TOO_LARGE",
        `Response body ${(resBytes.length / 1024 / 1024).toFixed(1)} MB exceeds ${RESPONSE_BODY_SIZE_LIMIT / 1024 / 1024} MB limit`
      )
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
      size: resBytes.length,
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
    cleanup(requestId)
  }
}

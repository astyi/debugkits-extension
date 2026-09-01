// Message handler — bridges chrome.runtime.onMessageExternal to the request executor.
// Returns true from the listener to keep the message channel open for async responses.

import type { WebToExtensionMessage, ExtensionToWebMessage } from "../types/protocol"
import { validateSender, validateTargetUrl, validateSchema } from "../security/validator"
import { executeRequest, cancelRequest } from "../network/executor"

function extractRequestId(message: unknown): string {
  if (message && typeof message === "object") {
    const id = (message as Record<string, unknown>)["requestId"]
    if (typeof id === "string") return id
  }
  return ""
}

/**
 * Handle a message from an external web page.
 * Must be passed directly to chrome.runtime.onMessageExternal.addListener.
 * Returns true when the response will be sent asynchronously.
 */
export function handleExternalMessage(
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: ExtensionToWebMessage) => void
): boolean {
  // ── Layer 1: validate sender origin ──────────────────────────────────────
  const senderError = validateSender(sender)
  if (senderError) {
    sendResponse({
      type: "HTTP_ERROR",
      requestId: extractRequestId(message),
      code: senderError,
      message: "Request origin is not allowed",
    })
    return false
  }

  // ── Layer 2: validate message schema ─────────────────────────────────────
  if (!validateSchema(message)) {
    sendResponse({
      type: "HTTP_ERROR",
      requestId: extractRequestId(message),
      code: "SCHEMA_INVALID",
      message: "Message did not pass schema validation",
    })
    return false
  }

  const msg = message as WebToExtensionMessage

  // ── HTTP_CANCEL ───────────────────────────────────────────────────────────
  if (msg.type === "HTTP_CANCEL") {
    const found = cancelRequest(msg.requestId)
    sendResponse({
      type: "HTTP_ERROR",
      requestId: msg.requestId,
      code: found ? "ABORTED" : "REQUEST_NOT_FOUND",
      message: found ? "Request cancelled" : "Request ID not found — may have already completed",
    })
    return false
  }

  // ── HTTP_REQUEST ──────────────────────────────────────────────────────────

  // Validate target URL before executing
  const urlError = validateTargetUrl(msg.url)
  if (urlError) {
    sendResponse({
      type: "HTTP_ERROR",
      requestId: msg.requestId,
      code: urlError,
      message: `Target URL rejected (${urlError}): ${msg.url}`,
    })
    return false
  }

  // Execute asynchronously — return true to keep the message channel open
  executeRequest(msg)
    .then(sendResponse)
    .catch((e: unknown) => {
      sendResponse({
        type: "HTTP_ERROR",
        requestId: msg.requestId,
        code: "INTERNAL_ERROR",
        message: (e as Error)?.message ?? "Unexpected internal error",
      })
    })

  return true
}

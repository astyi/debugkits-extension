// Entry point for the Manifest V3 background service worker.
// Registers the external message listener that receives requests from debugkits.com.

import { handleExternalMessage } from "../messaging/handler"
import type { ExtensionToWebMessage } from "../types/protocol"

chrome.runtime.onMessageExternal.addListener(
  (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: ExtensionToWebMessage) => void
  ): boolean => {
    return handleExternalMessage(message, sender, sendResponse)
  }
)

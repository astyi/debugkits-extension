# Privacy Policy — DebugKits API Bridge

**Extension:** DebugKits API Bridge  
**Version:** 0.1.0

---

## 1. Data Collection

DebugKits API Bridge does not collect, store, or transmit API request or response data.

The extension does not send any telemetry, usage statistics, or diagnostic data to any server.

---

## 2. Request Routing

All HTTP requests initiated through the extension travel directly from your browser to the target API:

```
Your Browser
    └── Chrome Extension (service worker)
            └── Target API
```

Requests are **not** routed through DebugKits servers:

```
# This does NOT happen:
Your Browser → DebugKits Server → Target API
```

The extension's background service worker calls `fetch()` directly from within Chrome to the URL you specify. DebugKits.com has no visibility into the contents of these requests.

---

## 3. Sensitive Information

The extension does **not** upload the following to any DebugKits server:

- Authorization headers or API keys
- Request bodies
- Response bodies
- Any other request or response data

This is verifiable from the extension source code: the background service worker contains exactly one `fetch()` call, which sends your request directly to the target API you specify. There are no secondary network calls to DebugKits infrastructure.

---

## 4. Local Storage

The extension writes exactly one value to the page's `localStorage` on debugkits.com:

| Key | Value | Purpose |
|-----|-------|---------|
| `__dk_ext_id__` | The extension's Chrome runtime ID | Allows the DebugKits web app to discover and communicate with the installed extension |

The extension does **not** persist:

- API requests or request bodies
- API responses or response bodies
- Authentication credentials or API keys
- Request history

All request execution is ephemeral: request state exists only in memory for the duration of a single request and is discarded immediately on completion, cancellation, or timeout.

---

## 5. Analytics and Telemetry

The extension does not include analytics, crash reporting, or telemetry of any kind.

This is verifiable from the source code: there are no calls to `fetch()`, `XMLHttpRequest`, `WebSocket`, or `navigator.sendBeacon` other than the single proxied request to the target API you specify.

---

## 6. Permissions

### `host_permissions: ["http://*/*", "https://*/*"]`

This permission is required for the extension's background service worker to make cross-origin HTTP/HTTPS requests to any API endpoint you choose to test. Without it, Chrome's Same-Origin Policy would block the extension from reaching third-party APIs on your behalf.

**This permission does not mean the extension reads or monitors your web browsing.** The extension's background service worker only sends a request when you explicitly trigger one through the DebugKits web app. It does not passively observe, intercept, or log network traffic from any website you visit.

### Content Script Scope

The content script (which writes the extension ID to `localStorage`) runs **only** on `https://debugkits.com/*` and `https://www.debugkits.com/*`. It does not run on any other website.

### Note on DNS Rebinding

The extension blocks requests to localhost and private network IP ranges (RFC 1918, IPv6 link-local, loopback). However, this check operates on the URL hostname string only. A public-looking domain that DNS-resolves to a private IP at request time would not be caught at the extension layer. This is a known limitation documented in the source code. Full mitigation requires server-side DNS validation or browser-level Private Network Access enforcement.

---

## 7. Reporting Security Issues

If you discover a security vulnerability in this extension, please report it through the **GitHub repository's security channels**.

Do not open a public GitHub issue for security vulnerabilities. Use GitHub's private vulnerability reporting feature if available in the repository settings, or contact the maintainer through GitHub.

---

## 8. Open Source

The extension is open source. You can verify all claims in this document by reading the source code directly:

- `src/background/service-worker.ts` — entry point and message listener
- `src/network/executor.ts` — request execution (contains the single `fetch()` call)
- `src/security/validator.ts` — origin and schema validation
- `src/content/injector.ts` — content script (writes only `__dk_ext_id__`)

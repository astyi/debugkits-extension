# DebugKits API Bridge

A Chrome Extension that enables the [DebugKits API Tester](https://debugkits.com/api-tools/api-tester/) to send HTTP requests without browser CORS restrictions.

## Why does this extension need host permissions?

The extension requests `http://*/*` and `https://*/*` host permissions so it can execute HTTP requests to any URL the user enters in the API Tester.

**It does not:**
- Read or modify your normal browsing activity
- Intercept requests made by other tabs or extensions
- Access any page content

**It only:**
- Responds to explicit HTTP request messages sent by debugkits.com
- Executes fetch requests to the exact URL the user typed
- Returns the raw HTTP response back to the API Tester UI

This is identical to how desktop API clients (Postman, Insomnia) work — they bypass CORS because they run outside the browser context. The extension brings that capability to the web app.

## Architecture

```
debugkits.com (web)
  | chrome.runtime.sendMessage(extensionId, { type: "HTTP_REQUEST", ... })
  v
Background Service Worker
  +-- Security: validates sender origin (must be debugkits.com)
  +-- Security: validates target URL (must be http:// or https://)
  +-- Network: fetch(targetUrl, { method, headers, body })
  +-- Response: returns { status, headers, body, time, size }
```

### Repository layout

```
debugkits-extension/
+-- protocol/              @debugkits/extension-protocol npm package (Protocol SSOT)
|   +-- index.ts           canonical types shared with the web app
|   +-- package.json
+-- src/
|   +-- background/        service worker entry point
|   +-- content/           content script (writes extension ID to localStorage)
|   +-- messaging/         message routing
|   +-- network/           HTTP executor with AbortController management
|   +-- security/          origin and URL validators
|   +-- popup/             extension popup UI
|   +-- types/             re-exports from protocol/
+-- assets/                extension icons
+-- scripts/build.mjs      esbuild build script
+-- manifest.json          production manifest
+-- manifest.dev.json      development manifest (adds localhost:3000)
+-- docs/                  additional documentation
```

## Security

- **Manifest**: `externally_connectable.matches` is restricted to `https://debugkits.com/*`
- **Code**: sender origin is validated again in `src/security/validator.ts`
- **Protocol whitelist**: only `http:` and `https:` are allowed as target protocols
- **Size limits**: request body <= 10 MB, response body <= 20 MB

## Development

### Prerequisites

- Node.js 20+
- Chrome 120+

### Build

```bash
npm install

npm run build        # production build -> dist/
npm run build:dev    # development build (adds localhost:3000 support)
npm run watch        # dev + watch mode
```

### Load in Chrome

1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `dist/` directory

For local development, use `npm run build:dev` which enables `http://localhost:3000/*`.

## Protocol package

`protocol/` is published as `@debugkits/extension-protocol`. The DebugKits web app
consumes it via `file:../debugkits-extension/protocol` in local development, or the
published npm version in CI/production.

When changing the protocol, bump the version in `protocol/package.json` and update
`debugkits/package.json` accordingly.

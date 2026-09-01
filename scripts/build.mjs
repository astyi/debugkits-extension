// Build script for DebugKits API Bridge Chrome Extension.
// Uses esbuild to bundle TypeScript source into extension-compatible JS.
//
// Usage:
//   node scripts/build.mjs           # production build
//   node scripts/build.mjs --dev     # development build (includes localhost:3000)
//   node scripts/build.mjs --watch   # dev + watch mode

import { build, context } from "esbuild"
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, "..")

const isDev = process.argv.includes("--dev")
const isWatch = process.argv.includes("--watch")

const ALLOWED_ORIGINS = isDev
  ? [
      "https://debugkits.com",
      "https://www.debugkits.com",
      "http://localhost:3000",
    ]
  : [
      "https://debugkits.com",
      "https://www.debugkits.com",
    ]

const sharedOptions = {
  bundle: true,
  target: "chrome120",
  minify: !isDev,
  sourcemap: isDev ? "inline" : false,
  define: {
    __ALLOWED_ORIGINS__: JSON.stringify(ALLOWED_ORIGINS),
  },
}

// Ensure output directories exist
;["dist/background", "dist/content", "dist/popup"].forEach((d) => {
  mkdirSync(resolve(root, d), { recursive: true })
})

async function buildAll() {
  // Background service worker — ESM (manifest specifies type: "module")
  await build({
    ...sharedOptions,
    entryPoints: [resolve(root, "src/background/service-worker.ts")],
    outfile: resolve(root, "dist/background/service-worker.js"),
    format: "esm",
  })

  // Content script — IIFE (content scripts cannot use ES module syntax)
  await build({
    ...sharedOptions,
    entryPoints: [resolve(root, "src/content/injector.ts")],
    outfile: resolve(root, "dist/content/injector.js"),
    format: "iife",
  })

  // Popup script — IIFE (loaded by popup.html as a regular script)
  await build({
    ...sharedOptions,
    entryPoints: [resolve(root, "src/popup/popup.ts")],
    outfile: resolve(root, "dist/popup/popup.js"),
    format: "iife",
  })

  // Copy static assets
  const manifestSrc = isDev ? "manifest.dev.json" : "manifest.json"
  writeFileSync(
    resolve(root, "dist/manifest.json"),
    readFileSync(resolve(root, manifestSrc))
  )

  cpSync(resolve(root, "src/popup/popup.html"), resolve(root, "dist/popup/popup.html"))
  cpSync(resolve(root, "src/popup/popup.css"), resolve(root, "dist/popup/popup.css"))

  // Copy icons if they exist
  const iconsDir = resolve(root, "assets/icons")
  if (existsSync(iconsDir)) {
    cpSync(iconsDir, resolve(root, "dist/icons"), { recursive: true })
  }

  console.log(`[build] ${isDev ? "dev" : "production"} build complete -> dist/`)
}

if (isWatch) {
  // Watch mode: rebuild on source changes
  const ctx = await context({
    ...sharedOptions,
    entryPoints: [
      resolve(root, "src/background/service-worker.ts"),
      resolve(root, "src/content/injector.ts"),
      resolve(root, "src/popup/popup.ts"),
    ],
    outdir: resolve(root, "dist"),
    format: "esm",
  })
  await ctx.watch()
  console.log("[build] watching for changes...")
} else {
  buildAll().catch((err) => {
    console.error("[build] failed:", err)
    process.exit(1)
  })
}

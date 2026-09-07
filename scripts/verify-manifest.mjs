// Production manifest safety check.
// Run after `npm run build` to verify dist/manifest.json is production-safe.
// Exits with code 1 if any check fails — used by CI to gate releases.
import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, "..")

function readJson(rel) {
  try {
    return JSON.parse(readFileSync(resolve(root, rel), "utf8"))
  } catch {
    console.error(`[verify-manifest] ERROR: cannot read ${rel}`)
    process.exit(1)
  }
}

const manifest = readJson("dist/manifest.json")

let failed = false
function fail(msg) {
  console.error("[verify-manifest] FAIL:", msg)
  failed = true
}

// manifest_version must be 3 (MV3)
if (manifest.manifest_version !== 3) {
  fail(`manifest_version is ${JSON.stringify(manifest.manifest_version)}, expected 3`)
}

// Chrome extension version must exist and use only dot-separated integers.
// Pre-release suffixes (e.g. "-alpha") are NOT valid Chrome extension versions
// and would cause Chrome to refuse to load the extension.  package.json may
// carry a semver pre-release suffix independently; we don't cross-check here.
if (!manifest.version) {
  fail("manifest.json version field is missing")
} else if (!/^\d+(\.\d+){0,3}$/.test(manifest.version)) {
  fail(
    `manifest.json version "${manifest.version}" is not a valid Chrome extension version ` +
    "(must be 1–4 dot-separated integers, no pre-release suffix)"
  )
}

// externally_connectable must exist and have exactly the two production origins
const REQUIRED_ORIGINS = new Set([
  "https://debugkits.com/*",
  "https://www.debugkits.com/*",
])
const matches = manifest.externally_connectable?.matches ?? []

for (const pattern of matches) {
  if (/localhost|127\.0\.0\.1/.test(pattern)) {
    fail(`externally_connectable contains forbidden pattern (localhost): ${pattern}`)
  }
  if (!REQUIRED_ORIGINS.has(pattern)) {
    fail(`externally_connectable contains unexpected pattern: ${pattern}`)
  }
}

for (const required of REQUIRED_ORIGINS) {
  if (!matches.includes(required)) {
    fail(`externally_connectable is missing required pattern: ${required}`)
  }
}

if (matches.length !== REQUIRED_ORIGINS.size) {
  fail(`externally_connectable has ${matches.length} entries, expected ${REQUIRED_ORIGINS.size}`)
}

if (failed) {
  process.exit(1)
}

console.log(
  `[verify-manifest] OK — MV${manifest.manifest_version}, version ${manifest.version},`,
  `externally_connectable: [${matches.join(", ")}]`
)

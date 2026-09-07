// Run tests directly with Node's built-in TypeScript support (Node 22+).
// Usage: npm test
import { spawnSync } from "node:child_process"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, "..")

const proc = spawnSync(
  process.execPath,
  [
    "--test",
    resolve(root, "tests/executor.test.ts"),
    resolve(root, "tests/validator.test.ts"),
    resolve(root, "tests/security.test.ts"),
  ],
  { stdio: "inherit" }
)

process.exit(proc.status ?? 1)

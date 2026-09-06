import { access, readFile } from "node:fs/promises"
import { constants } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { defaultConfigDir } from "./install-helpers.mjs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const required = [
  "package.json",
  "index.tsx",
  "tui.tsx",
  "src/components.tsx",
  "src/charts.ts",
  "src/data.ts",
  "src/decision-support.ts",
  "src/diagnostic.ts",
  "src/format.ts",
  "src/quota-export.ts",
  "src/tracker.ts",
  "src/types.ts",
  "themes/berg-terminal.json",
  "scripts/install.mjs",
  "scripts/benchmark.mjs",
]

const runtimeImports = ["solid-js", "@opentui/solid", "@opentui/core", "@opencode-ai/plugin/tui"]

let failed = false
console.log("OpenCode Berg Terminal - read-only installation diagnostic")
console.log(`Project: ${root}`)

for (const relative of required) {
  try {
    await access(join(root, relative), constants.R_OK)
    console.log(`[OK] ${relative}`)
  } catch {
    failed = true
    console.error(`[MISSING] ${relative}`)
  }
}

for (const specifier of runtimeImports) {
  try {
    import.meta.resolve(specifier)
    console.log(`[OK] Runtime import ${specifier}`)
  } catch {
    failed = true
    console.error(`[MISSING] Runtime import ${specifier}; run npm install for source-checkout usage`)
  }
}

try {
  const theme = JSON.parse(await readFile(join(root, "themes/berg-terminal.json"), "utf8"))
  if (theme?.theme?.background?.dark !== "void" || theme?.defs?.void !== "#000000") {
    failed = true
    console.error("[INVALID] Theme does not expose the expected black dark canvas")
  } else {
    console.log("[OK] Theme JSON and dark canvas")
  }
} catch (error) {
  failed = true
  console.error(`[INVALID] Theme JSON: ${error instanceof Error ? error.message : String(error)}`)
}

const identityChecks = [
  ["package.json", /opencode-bloomberg|bloomberg-terminal/],
  ["examples/tui.json", /bloomberg-terminal/],
  ["src/components.tsx", /BloombergCockpit|bloomberg\./],
]
for (const [relative, residue] of identityChecks) {
  const source = await readFile(join(root, relative), "utf8")
  if (residue.test(source)) {
    failed = true
    console.error(`[RESIDUE] Legacy public identity in ${relative}`)
  } else {
    console.log(`[OK] Berg identity in ${relative}`)
  }
}
console.log("[OK] Physical folder name is not part of public identity checks")

const normalizedEntry = join(root, "tui.tsx").replaceAll("\\", "/")
const configDir = defaultConfigDir()
const tuiPath = process.env.OPENCODE_TUI_CONFIG ? resolve(process.env.OPENCODE_TUI_CONFIG) : join(configDir, "tui.json")
console.log(`\nMerge these values into ${tuiPath}:`)
console.log(JSON.stringify({
  theme: "berg-terminal",
  plugin: [normalizedEntry],
}, null, 2))
console.log("\nTheme source:")
console.log(join(root, "themes", "berg-terminal.json"))
console.log(`Target: ${join(configDir, "themes", "berg-terminal.json")}`)
console.log("Legacy themes/bloomberg-terminal.json is preserved and is a manual deletion candidate.")
console.log("This diagnostic did not write or modify any file.")

if (failed) process.exitCode = 1

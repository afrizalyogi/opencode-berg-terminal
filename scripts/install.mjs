#!/usr/bin/env node

import { copyFile, lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { defaultConfigDir, mergeTuiConfig, parseArgs } from "./install-helpers.mjs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const pluginSource = join(root, "tui.tsx")
const themeSource = join(root, "themes", "berg-terminal.json")

async function inspect(path) {
  try {
    const stat = await lstat(path)
    if (stat.isSymbolicLink()) throw new Error(`Refusing symbolic link: ${path}`)
    if (!stat.isFile()) throw new Error(`Refusing non-file path: ${path}`)
    return true
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return false
    throw error
  }
}

async function atomicWrite(path, content, stamp) {
  const exists = await inspect(path)
  if (exists) {
    const backup = `${path}.backup-${stamp}`
    await copyFile(path, backup)
    console.log(`Backup: ${backup}`)
  }
  const temporary = `${path}.tmp-${process.pid}-${stamp}`
  await writeFile(temporary, content, { encoding: "utf8", flag: "wx" })
  await rename(temporary, path)
  console.log(`Wrote: ${path}`)
}

const options = parseArgs(process.argv.slice(2))
const configDir = resolve(options.configDir ?? defaultConfigDir())
const tuiPath = options.configDir || !process.env.OPENCODE_TUI_CONFIG
  ? join(configDir, "tui.json")
  : resolve(process.env.OPENCODE_TUI_CONFIG)
const themeDir = join(configDir, "themes")
const themePath = join(themeDir, "berg-terminal.json")
const normalizedPlugin = options.npm ? "opencode-berg-terminal" : pluginSource.replaceAll("\\", "/")

console.log(`Mode: ${options.apply ? "apply" : "dry-run"}`)
console.log(`Config directory: ${configDir}`)
console.log(`TUI config: ${tuiPath}`)
console.log(`Plugin: ${normalizedPlugin}`)
console.log(`Theme source: ${themeSource}`)
console.log(`Theme target: ${themePath}`)

const tuiExists = await inspect(tuiPath)
let current = { $schema: "https://opencode.ai/tui.json" }
if (tuiExists) {
  const source = await readFile(tuiPath, "utf8")
  try {
    current = JSON.parse(source)
  } catch (error) {
    throw new Error(`Cannot parse ${tuiPath} as strict JSON. JSONC is unsupported: ${error instanceof Error ? error.message : String(error)}`)
  }
}
const merged = mergeTuiConfig(current, normalizedPlugin, { noTheme: !options.theme, keepCurrentTheme: options.keepCurrentTheme, replaceLegacy: options.replaceLegacy })
for (const warning of merged.warnings) console.warn(`Warning: ${warning}`)
if (current.theme === "bloomberg-terminal") console.warn("Warning: the legacy bloomberg-terminal theme file is not removed.")

let writeTheme = options.theme && !options.keepCurrentTheme
if (writeTheme && await inspect(themePath)) {
  const [existing, wanted] = await Promise.all([readFile(themePath, "utf8"), readFile(themeSource, "utf8")])
  if (existing !== wanted) throw new Error(`Refusing differing theme file: ${themePath}. Use --keep-current-theme to leave it unchanged.`)
  writeTheme = false
  console.log(`Theme already current: ${themePath}`)
}

console.log("Planned changes:")
console.log(JSON.stringify({
  pluginToAdd: normalizedPlugin,
  theme: options.theme && !options.keepCurrentTheme ? "berg-terminal" : "unchanged",
  preservedTopLevelKeys: Object.keys(current).filter((key) => key !== "plugin" && key !== "theme").length,
}, null, 2))
if (options.verbose) {
  console.log("Full merged tui.json (--verbose):")
  console.log(JSON.stringify(merged.config, null, 2))
}
if (!options.apply) {
  console.log("Dry-run complete. Re-run with --apply to write the listed targets.")
} else {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  await mkdir(configDir, { recursive: true })
  await atomicWrite(tuiPath, `${JSON.stringify(merged.config, null, 2)}\n`, stamp)
  if (writeTheme) {
    await mkdir(themeDir, { recursive: true })
    await atomicWrite(themePath, await readFile(themeSource, "utf8"), stamp)
  }
  console.log("Installation complete. Restart OpenCode to load the configuration.")
}

import { homedir } from "node:os"
import { resolve } from "node:path"

export function defaultConfigDir(env = process.env, home = homedir()) {
  if (env.OPENCODE_CONFIG_DIR) return resolve(env.OPENCODE_CONFIG_DIR)
  return resolve(env.XDG_CONFIG_HOME || resolve(home, ".config"), "opencode")
}

export function parseArgs(argv) {
  const options = { apply: false, theme: true, keepCurrentTheme: false, replaceLegacy: false, npm: false, verbose: false, configDir: undefined }
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]
    if (argument === "--apply") options.apply = true
    else if (argument === "--no-theme") options.theme = false
    else if (argument === "--keep-current-theme") options.keepCurrentTheme = true
    else if (argument === "--replace-legacy") options.replaceLegacy = true
    else if (argument === "--npm") options.npm = true
    else if (argument === "--verbose") options.verbose = true
    else if (argument === "--config-dir") {
      const value = argv[++index]
      if (!value) throw new Error("--config-dir requires a path")
      options.configDir = resolve(value)
    } else throw new Error(`Unknown option: ${argument}`)
  }
  return options
}

export function mergeTuiConfig(config, pluginPath, options = {}) {
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("tui.json must contain a JSON object")
  if (config.plugin !== undefined && !Array.isArray(config.plugin)) throw new Error("tui.json plugin must be an array")
  let plugins = [...(config.plugin ?? [])]
  const warnings = []
  const isLegacy = (entry) => typeof entry === "string" && (
    /(?:^|[\\/])bloomberg-terminal[\\/]tui\.(?:js|tsx?)$/i.test(entry) ||
    /(?:^|[\\/])opencode-bloomberg(?:[\\/].*)?[\\/]tui\.(?:js|tsx?)$/i.test(entry)
  )
  const legacy = plugins.filter(isLegacy)
  if (legacy.length > 0 && !options.replaceLegacy) {
    throw new Error(`Legacy plugin entry detected: ${legacy.join(", ")}. Re-run with --replace-legacy after reviewing the dry-run.`)
  }
  if (legacy.length > 0) {
    plugins = plugins.filter((entry) => !isLegacy(entry))
    warnings.push(`Replacing ${legacy.length} legacy plugin entry. The existing tui.json will be backed up in apply mode.`)
  }
  if (!plugins.some((entry) => entry === pluginPath)) plugins.push(pluginPath)
  const next = { ...config, plugin: plugins }
  if (!options.noTheme && !options.keepCurrentTheme) next.theme = "berg-terminal"
  return { config: next, warnings }
}

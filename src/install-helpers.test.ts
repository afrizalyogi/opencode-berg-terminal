import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { resolve } from "node:path"
import { defaultConfigDir, mergeTuiConfig, parseArgs } from "../scripts/install-helpers.mjs"

describe("installer helpers", () => {
  test("defaults to dry-run and resolves an explicit config path", () => {
    const parsed = parseArgs(["--config-dir", "example", "--no-theme"])
    assert.equal(parsed.apply, false)
    assert.equal(parsed.theme, false)
    assert.ok(parsed.configDir?.endsWith("example"))
  })

  test("uses XDG_CONFIG_HOME when present", () => {
    assert.equal(defaultConfigDir({ XDG_CONFIG_HOME: "/tmp/config" }, "/home/example"), resolve("/tmp/config", "opencode"))
  })

  test("prefers the OpenCode-specific config directory", () => {
    assert.equal(defaultConfigDir({ OPENCODE_CONFIG_DIR: "/tmp/opencode", XDG_CONFIG_HOME: "/tmp/config" }, "/home/example"), resolve("/tmp/opencode"))
  })

  test("supports npm-package and concise verbose installer modes", () => {
    const parsed = parseArgs(["--npm", "--verbose"])
    assert.equal(parsed.npm, true)
    assert.equal(parsed.verbose, true)
  })

  test("preserves keys and plugins while adding Berg Terminal", () => {
    const result = mergeTuiConfig({ theme: "old", plugin: ["existing"], keybinds: { help: "f3" } }, "/project/tui.tsx")
    assert.deepEqual(result.config, { theme: "berg-terminal", plugin: ["existing", "/project/tui.tsx"], keybinds: { help: "f3" } })
  })

  test("keeps the selected theme when requested", () => {
    const result = mergeTuiConfig({ theme: "custom" }, "/project/tui.tsx", { keepCurrentTheme: true })
    assert.equal(result.config.theme, "custom")
  })

  test("refuses legacy plugin entries unless replacement is explicit", () => {
    assert.throws(
      () => mergeTuiConfig({ plugin: ["./plugin/bloomberg-terminal/tui.tsx"] }, "/project/tui.tsx"),
      /--replace-legacy/,
    )
  })

  test("replaces legacy plugin entries only when requested", () => {
    const result = mergeTuiConfig(
      { plugin: ["existing", "./plugin/bloomberg-terminal/tui.tsx"] },
      "/project/tui.tsx",
      { replaceLegacy: true },
    )
    assert.deepEqual(result.config.plugin, ["existing", "/project/tui.tsx"])
    assert.equal(result.warnings.length, 1)
  })
})

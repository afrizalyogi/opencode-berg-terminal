import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { resolve } from "node:path"
import { maskEmail, opencodeConfigDir, parseAntigravityAccounts, parseOpenAIUsage } from "./quota-export.ts"

describe("standalone quota parser", () => {
  test("distinguishes OpenAI 5 hour and weekly windows", () => {
    const result = parseOpenAIUsage({
      plan_type: "plus",
      rate_limit: {
        primary_window: { limit_window_seconds: 18_000, used_percent: 91 },
        secondary_window: { limit_window_seconds: 604_800, used_percent: 28 },
      },
    })
    assert.deepEqual(result.map((row) => [row.name, row.value]), [
      ["OpenAI (Plus) 5 hour", "9 % left"],
      ["OpenAI (Plus) Weekly", "72 % left"],
    ])
  })

  test("ignores malformed documents", () => {
    assert.deepEqual(parseOpenAIUsage(null), [])
  })

  test("shows quota for every enabled Antigravity account and marks active families", () => {
    const result = parseAntigravityAccounts({
      activeIndexByFamily: { claude: 0, gemini: 1 },
      accounts: [
        { email: "alpha@example.com", enabled: true, cachedQuotaUpdatedAt: 1234, cachedQuota: { claude: { remainingFraction: 0.25 }, "gemini-pro": { remainingFraction: 0.5 } } },
        { email: "beta@example.com", enabled: true, cachedQuota: { claude: { remainingFraction: 0.75 }, "gemini-pro": { remainingFraction: 1 } } },
        { email: "disabled@example.com", enabled: false, cachedQuota: { claude: { remainingFraction: 1 } } },
      ],
    })

    assert.equal(result.length, 4)
    assert.deepEqual(result.map((row) => [row.account, row.provider, row.name, row.value]), [
      ["alp***ha@example.com", "Anthropic", "Claude [active]", "25 % left"],
      ["alp***ha@example.com", "Google", "Gemini Pro", "50 % left"],
      ["bet***a@example.com", "Anthropic", "Claude", "75 % left"],
      ["bet***a@example.com", "Google", "Gemini Pro [active]", "100 % left"],
    ])
    assert.deepEqual(result.map((row) => row.percent), [25, 50, 75, 100])
    assert.equal(result[0]?.updatedAt, 1234)
  })

  test("masks email correctly for various lengths", () => {
    assert.equal(maskEmail("richiewillis729@gmail.com"), "ric***729@gmail.com")
    assert.equal(maskEmail("admin@example.com"), "adm***in@example.com")
    assert.equal(maskEmail("a@example.com"), "a***@example.com")
    assert.equal(maskEmail("ab@example.com"), "ab***@example.com")
    assert.equal(maskEmail("abc@example.com"), "abc***@example.com")
    assert.equal(maskEmail("abcd@example.com"), "abc***d@example.com")
    assert.equal(maskEmail("not-an-email"), undefined)
  })

  test("resolves the Antigravity config directory across platforms", () => {
    assert.equal(opencodeConfigDir({ OPENCODE_CONFIG_DIR: "C:/custom" } as NodeJS.ProcessEnv, "C:/Users/example"), resolve("C:/custom"))
    assert.equal(opencodeConfigDir({ XDG_CONFIG_HOME: "/tmp/config" } as NodeJS.ProcessEnv, "/home/example"), resolve("/tmp/config", "opencode"))
    assert.equal(opencodeConfigDir({} as NodeJS.ProcessEnv, "/home/example"), resolve("/home/example", ".config", "opencode"))
  })
})

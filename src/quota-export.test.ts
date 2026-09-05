import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { maskAccount, parseAntigravityAccounts, parseOpenAIUsage } from "./quota-export.ts"

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
      ["OpenAI (Plus) 5 hour", "9% left"],
      ["OpenAI (Plus) Weekly", "72% left"],
    ])
  })

  test("ignores malformed documents", () => {
    assert.deepEqual(parseOpenAIUsage(null), [])
  })

  test("shows quota for every enabled Antigravity account and marks active families", () => {
    const result = parseAntigravityAccounts({
      activeIndexByFamily: { claude: 0, gemini: 1 },
      accounts: [
        { email: "alpha@example.com", enabled: true, cachedQuota: { claude: { remainingFraction: 0.25 }, "gemini-pro": { remainingFraction: 0.5 } } },
        { email: "beta@example.com", enabled: true, cachedQuota: { claude: { remainingFraction: 0.75 }, "gemini-pro": { remainingFraction: 1 } } },
        { email: "disabled@example.com", enabled: false, cachedQuota: { claude: { remainingFraction: 1 } } },
      ],
    })

    assert.equal(result.length, 4)
    assert.deepEqual(result.map((row) => [row.provider, row.name, row.value]), [
      ["Anthropic", "Claude · a***@example.com [active]", "25% left"],
      ["Anthropic", "Claude · b***@example.com", "75% left"],
      ["Google", "Gemini Pro · a***@example.com", "50% left"],
      ["Google", "Gemini Pro · b***@example.com [active]", "100% left"],
    ])
  })

  test("masks account emails and falls back to an index label", () => {
    assert.equal(maskAccount("person@example.com", 0), "p***@example.com")
    assert.equal(maskAccount(undefined, 2), "Account 3")
  })
})

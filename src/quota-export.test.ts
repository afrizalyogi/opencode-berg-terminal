import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { parseOpenAIUsage } from "./quota-export.ts"

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
})

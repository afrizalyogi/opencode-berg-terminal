import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { bar, sparkline, statusDistribution } from "./charts.ts"

describe("ASCII charts", () => {
  test("renders deterministic sparklines and handles empty values", () => {
    assert.equal(sparkline([0, 5, 10], 3), ".+@")
    assert.equal(sparkline([], 4), "")
    assert.equal(sparkline([0], 3), "...")
  })

  test("clamps bars to their width", () => {
    assert.equal(bar(5, 10, 6), "###...")
    assert.equal(bar(20, 10, 4), "####")
  })

  test("allocates every status cell", () => {
    const chart = statusDistribution({ running: 1, done: 2, error: 1 }, 8)
    assert.equal(chart, "WWOOOOEE")
    assert.equal(statusDistribution({ running: 0, done: 0, error: 0 }, 3), "...")
  })

  test("supports a unicode character set", () => {
    assert.equal(bar(1, 2, 2, "unicode"), "█░")
    assert.equal(sparkline([0, 1], 2, "unicode"), "▁█")
  })
})

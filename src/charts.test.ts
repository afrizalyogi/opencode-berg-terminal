import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { bar } from "./charts.ts"

describe("ASCII charts", () => {
  test("clamps bars to their width", () => {
    assert.equal(bar(5, 10, 6), "###...")
    assert.equal(bar(20, 10, 4), "####")
  })

  test("supports a unicode character set", () => {
    assert.equal(bar(1, 2, 2, "unicode"), "█░")
  })
})

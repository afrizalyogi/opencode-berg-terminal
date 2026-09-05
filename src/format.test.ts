import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { columns, duration, layoutFor, metric, money, padLeft, padRight, safeNumber, sanitizeLine, statusLabel, threeColumnWidths, truncate, widePaneWidths } from "./format.ts"

describe("Berg Terminal formatting", () => {
  test("normalizes unsafe numeric values", () => {
    assert.equal(safeNumber(-1), 0)
    assert.equal(safeNumber(Number.POSITIVE_INFINITY), 0)
    assert.equal(safeNumber("12"), 0)
    assert.equal(safeNumber(12), 12)
  })

  test("sanitizes controls and keeps one row", () => {
    assert.equal(sanitizeLine(" A\nB\tC "), "A B C")
  })

  test("truncates using ASCII markers and terminal cell width", () => {
    assert.equal(truncate("ABCDEFGHIJ", 7), "ABCD...")
    assert.equal(truncate("界界界", 5), "界...")
    assert.equal(truncate("ABC", 2), "..")
  })

  test("aligns fixed-width terminal columns", () => {
    assert.equal(padRight("ABC", 5), "ABC  ")
    assert.equal(padLeft("ABC", 5), "  ABC")
    assert.equal(columns("LEFT", "RIGHT", 12), "LEFT   RIGHT")
  })

  test("selects responsive cockpit layouts", () => {
    assert.equal(layoutFor(39, 40), "minimal")
    assert.equal(layoutFor(79, 20), "narrow")
    assert.equal(layoutFor(80, 20), "medium")
    assert.equal(layoutFor(119, 20), "medium")
    assert.equal(layoutFor(120, 20), "wide")
  })

  test("formats metrics, money, and elapsed time", () => {
    assert.equal(metric(1_250), "1.3K")
    assert.equal(money(undefined), "Unavailable")
    assert.equal(money(0), "$0.0000")
    assert.equal(duration(0, 65_000, 100_000), "01:05")
    assert.equal(duration(0, 4_000, 100_000), "4 S")
  })

  test("uses compact status labels and gives data columns more room", () => {
    assert.equal(statusLabel("error"), "ERR")
    assert.equal(statusLabel("running"), "WORK")
    const [first, second, status] = threeColumnWidths(31, 7)
    assert.ok(first > status)
    assert.ok(second > status)
    assert.equal(first + second + status + 2, 31)
    const narrow = threeColumnWidths(9, 2)
    assert.ok(narrow[0] > narrow[2])
    assert.ok(narrow[1] > narrow[2])
  })

  test("allocates wider first and second command-center panes", () => {
    const widths = widePaneWidths(120)
    assert.ok(widths[0] > widths[2])
    assert.ok(widths[1] > widths[2])
    assert.equal(widths[0] + widths[1] + widths[2] + 2, 120)
  })
})

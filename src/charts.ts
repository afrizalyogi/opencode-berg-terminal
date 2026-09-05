export type ChartCharset = "ascii" | "unicode"

const SPARK = {
  ascii: ".:-=+*#@",
  unicode: "▁▂▃▄▅▆▇█",
} as const

function finite(values: readonly number[]): number[] {
  return values.map((value) => Number.isFinite(value) && value > 0 ? value : 0)
}

export function sparkline(values: readonly number[], width = values.length, charset: ChartCharset = "ascii"): string {
  const safeWidth = Math.max(0, Math.floor(width))
  if (safeWidth === 0 || values.length === 0) return ""
  const source = finite(values).slice(-safeWidth)
  const max = Math.max(...source)
  const glyphs = SPARK[charset]
  const chart = source.map((value) => glyphs[max === 0 ? 0 : Math.round((value / max) * (glyphs.length - 1))]).join("")
  return chart.padStart(safeWidth, glyphs[0])
}

export function bar(value: number, max: number, width: number, charset: ChartCharset = "ascii"): string {
  const safeWidth = Math.max(0, Math.floor(width))
  const ratio = max > 0 && Number.isFinite(value) ? Math.max(0, Math.min(1, value / max)) : 0
  const filled = Math.round(ratio * safeWidth)
  const fill = charset === "unicode" ? "█" : "#"
  const empty = charset === "unicode" ? "░" : "."
  return fill.repeat(filled) + empty.repeat(safeWidth - filled)
}

export function statusDistribution(
  counts: { running: number; done: number; error: number },
  width: number,
  charset: ChartCharset = "ascii",
): string {
  const safeWidth = Math.max(0, Math.floor(width))
  const values = [counts.running, counts.done, counts.error].map((value) => Number.isFinite(value) && value > 0 ? value : 0)
  const total = values.reduce((sum, value) => sum + value, 0)
  if (total === 0) return (charset === "unicode" ? "░" : ".").repeat(safeWidth)
  const units = values.map((value) => Math.floor((value / total) * safeWidth))
  for (let remainder = safeWidth - units.reduce((sum, value) => sum + value, 0); remainder > 0; remainder--) {
    let index = 0
    for (let candidate = 1; candidate < values.length; candidate++) {
      const candidateRemainder = (values[candidate] / total) * safeWidth - units[candidate]
      const currentRemainder = (values[index] / total) * safeWidth - units[index]
      if (candidateRemainder > currentRemainder) index = candidate
    }
    units[index]++
  }
  const glyphs = charset === "unicode" ? ["▓", "█", "▒"] : ["W", "O", "E"]
  return units.map((count, index) => glyphs[index].repeat(count)).join("")
}

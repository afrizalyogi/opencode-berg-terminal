export type ChartCharset = "ascii" | "unicode"

export function bar(value: number, max: number, width: number, charset: ChartCharset = "ascii"): string {
  const safeWidth = Math.max(0, Math.floor(width))
  const ratio = max > 0 && Number.isFinite(value) ? Math.max(0, Math.min(1, value / max)) : 0
  const filled = Math.round(ratio * safeWidth)
  const fill = charset === "unicode" ? "█" : "#"
  const empty = charset === "unicode" ? "░" : "."
  return fill.repeat(filled) + empty.repeat(safeWidth - filled)
}

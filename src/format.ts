import type { CockpitLayout } from "./types"

export function safeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.min(value, Number.MAX_SAFE_INTEGER)
    : 0
}

export function sanitizeLine(value: unknown): string {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim()
}

function cellSize(value: string): number {
  let width = 0
  for (const char of value) {
    const point = char.codePointAt(0) ?? 0
    if (/\p{Mark}/u.test(char)) continue
    width += point >= 0x1100 && (
      point <= 0x115f || point === 0x2329 || point === 0x232a ||
      (point >= 0x2e80 && point <= 0xa4cf) ||
      (point >= 0xac00 && point <= 0xd7a3) ||
      (point >= 0xf900 && point <= 0xfaff) ||
      (point >= 0xfe10 && point <= 0xfe6f) ||
      (point >= 0xff00 && point <= 0xff60) ||
      (point >= 0x1f300 && point <= 0x1faff)
    ) ? 2 : 1
  }
  return width
}

export function truncate(value: unknown, width: number): string {
  const text = sanitizeLine(value)
  const limit = Math.max(0, Math.floor(width))
  if (cellSize(text) <= limit) return text
  if (limit <= 3) return ".".repeat(limit)
  let result = ""
  for (const char of text) {
    if (cellSize(result + char) > limit - 3) break
    result += char
  }
  return `${result}...`
}

export function padRight(value: unknown, width: number): string {
  const text = truncate(value, width)
  return `${text}${" ".repeat(Math.max(0, width - cellSize(text)))}`
}

export function padLeft(value: unknown, width: number): string {
  const text = truncate(value, width)
  return `${" ".repeat(Math.max(0, width - cellSize(text)))}${text}`
}

export function columns(left: unknown, right: unknown, width: number): string {
  const safeRight = truncate(right, width)
  const leftWidth = Math.max(0, width - cellSize(safeRight))
  const safeLeft = truncate(left, leftWidth)
  return `${safeLeft}${" ".repeat(Math.max(0, width - cellSize(safeLeft) - cellSize(safeRight)))}${safeRight}`
}

export function metric(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return Math.round(value).toString()
}

export function money(value: number | undefined): string {
  if (value === undefined) return "Unavailable"
  if (value >= 1) return `$${value.toFixed(2)}`
  if (value >= 0.01) return `$${value.toFixed(3)}`
  return `$${value.toFixed(4)}`
}

export function duration(startedAt: number, endedAt: number | undefined, now: number): string {
  const seconds = Math.max(0, Math.floor(((endedAt ?? now) - startedAt) / 1000))
  if (seconds < 60) return `${seconds} S`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes.toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`
  return `${Math.floor(minutes / 60)}:${(minutes % 60).toString().padStart(2, "0")}`
}

export function statusLabel(status: "running" | "done" | "error"): string {
  if (status === "running") return "WORK"
  if (status === "error") return "ERR"
  return "OK"
}

export function threeColumnWidths(width: number, middleMinimum: number): [number, number, number] {
  const available = Math.max(0, Math.floor(width))
  const status = Math.min(7, Math.max(1, Math.floor((available - 2) / 4)))
  const remaining = Math.max(0, available - status - 2)
  const first = Math.max(0, Math.ceil(remaining * 0.42))
  const second = Math.max(0, remaining - first)
  if (second >= middleMinimum || first === 0) return [first, second, status]
  const transfer = Math.min(first, middleMinimum - second)
  return [first - transfer, second + transfer, status]
}

export function widePaneWidths(width: number): [number, number, number] {
  const available = Math.max(0, Math.floor(width) - 2)
  const first = Math.floor(available * 0.36)
  const second = Math.floor(available * 0.36)
  return [first, second, Math.max(0, available - first - second)]
}

export function layoutFor(width: number, height: number): CockpitLayout {
  if (width < 40 || height < 12) return "minimal"
  if (width < 80) return "narrow"
  if (width < 120) return "medium"
  return "wide"
}

export function shortModel(value: string | undefined): string {
  if (!value) return "Default"
  const slash = value.lastIndexOf("/")
  return slash >= 0 ? value.slice(slash + 1) : value
}

import { appendFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

export const diagnosticPath = join(tmpdir(), "opencode", "berg-terminal-realtime.ndjson")
export const diagnosticInstance = `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

function safeValue(value: unknown): unknown {
  if (value === undefined || value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value
  if (Array.isArray(value)) return value.map(safeValue)
  if (typeof value !== "object") return String(value)
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, safeValue(item)]))
}

export function diagnostic(kind: string, data: Record<string, unknown> = {}): void {
  if (process.env.BERG_TERMINAL_DIAGNOSTIC !== "1") return
  const safeData = safeValue(data) as Record<string, unknown>
  const line = JSON.stringify({ at: new Date().toISOString(), instance: diagnosticInstance, kind, ...safeData })
  void appendFile(diagnosticPath, `${line}\n`, "utf8").catch(() => {})
}

import { join } from "node:path"
import { tmpdir } from "node:os"

export const diagnosticInstance = `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
export const diagnosticPath = join(tmpdir(), `berg-terminal-${diagnosticInstance}.ndjson`)
export const diagnosticsEnabled = process.env.BERG_TERMINAL_DIAGNOSTIC === "1"

const sensitiveKey = /(?:authorization|api[-_]?key|access|refresh|secret|password|token|cookie|error)/i
const sensitiveValue = /(?:bearer\s+[A-Za-z0-9._~+\/-]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|sk-[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,}|xox[baprs]-[A-Za-z0-9-]{12,})/gi

function safeString(value: string): string {
  return value.replace(sensitiveValue, "[REDACTED]").slice(0, 2_000)
}

function safeValue(value: unknown, key = ""): unknown {
  if (sensitiveKey.test(key)) return "[REDACTED]"
  if (typeof value === "string") return safeString(value)
  if (value === undefined || value === null || typeof value === "number" || typeof value === "boolean") return value
  if (Array.isArray(value)) return value.map((item) => safeValue(item))
  if (typeof value !== "object") return String(value)
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, item]) => [childKey, safeValue(item, childKey)]))
}

let pendingWrite = Promise.resolve()

export function diagnostic(kind: string, data: Record<string, unknown> | (() => Record<string, unknown>) = {}): void {
  if (!diagnosticsEnabled) return
  const safeData = safeValue(typeof data === "function" ? data() : data) as Record<string, unknown>
  const line = JSON.stringify({ at: new Date().toISOString(), instance: diagnosticInstance, kind, ...safeData })
  pendingWrite = pendingWrite
    .then(async () => {
      const { appendFile } = await import("node:fs/promises")
      await appendFile(diagnosticPath, `${line}\n`, { encoding: "utf8", mode: 0o600 })
    })
    .catch(() => {})
}

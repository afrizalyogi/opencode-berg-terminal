import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

export type QuotaRow = {
  provider: string
  account?: string
  name: string
  value: string
  percent?: number
  resetAt?: number
  updatedAt?: number
}

export type QuotaSnapshot = {
  exportedAt: number
  rows: QuotaRow[]
  providerCount: number
}

type PlainObject = Record<string, any>

function object(value: unknown): PlainObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as PlainObject : undefined
}

function jwtAccountID(token: string): string | undefined {
  try {
    const raw = token.split(".")[1]
    if (!raw) return undefined
    const payload = JSON.parse(Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"))
    return payload?.["https://api.openai.com/auth"]?.chatgpt_account_id
  } catch {
    return undefined
  }
}

export function parseOpenAIUsage(value: unknown): QuotaRow[] {
  const root = object(value)
  if (!root) return []
  const plan = String(root.plan_type ?? "").toLowerCase()
  const planLabel = plan.includes("pro") ? "OpenAI (Pro)" : plan.includes("plus") ? "OpenAI (Plus)" : "OpenAI"
  const rows: QuotaRow[] = []
  const windows = [root.rate_limit?.primary_window, root.rate_limit?.secondary_window]
  for (const window of windows) {
    if (!window || typeof window.used_percent !== "number") continue
    const seconds = window.limit_window_seconds
    const label = seconds === 18_000 ? "5 hour" : seconds === 604_800 ? "Weekly" : seconds === 2_628_000 ? "Monthly" : undefined
    if (!label) continue
    const remaining = Math.round(Math.max(0, Math.min(100, 100 - window.used_percent)))
    rows.push({
      provider: "OpenAI",
      name: `${planLabel} ${label}`,
      value: `${remaining} % left`,
      percent: remaining,
      resetAt: typeof window.reset_at === "number" ? window.reset_at : undefined,
    })
  }
  return rows
}

async function fetchOpenAI(auth: PlainObject): Promise<QuotaRow[]> {
  try {
    const entry = auth.openai ?? auth.codex ?? auth.chatgpt
    if (entry?.type !== "oauth" || typeof entry.access !== "string") return []
    if (typeof entry.expires === "number" && entry.expires < Date.now()) return []
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5_000)
    try {
      const accountID = jwtAccountID(entry.access) ?? entry.accountId
      const response = await fetch("https://chatgpt.com/backend-api/wham/usage", {
        headers: {
          Authorization: `Bearer ${entry.access}`,
          ...(accountID ? { "ChatGPT-Account-Id": accountID } : {}),
        },
        signal: controller.signal,
      })
      if (!response.ok) return []
      return parseOpenAIUsage(await response.json())
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return []
  }
}

async function fetchOpenRouter(auth: PlainObject): Promise<QuotaRow[]> {
  try {
    const entry = auth.openrouter
    if (entry?.type !== "api" || typeof entry.key !== "string") return []
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5_000)
    try {
      const response = await fetch("https://openrouter.ai/api/v1/key", {
        headers: { Authorization: `Bearer ${entry.key}` },
        signal: controller.signal,
      })
      if (!response.ok) return []
      const body = await response.json()
      const data = body?.data
      if (!data) return []
      const rows: QuotaRow[] = []
      if (typeof data.limit === "number" && typeof data.usage === "number") {
        const pct = Math.round(Math.max(0, Math.min(100, (1 - data.usage / data.limit) * 100)))
        rows.push({ provider: "OpenRouter", name: "Credit limit", value: `${pct} % left`, percent: pct })
      }
      if (typeof data.balance === "number") {
        rows.push({ provider: "OpenRouter", name: "Balance", value: `$${data.balance.toFixed(3)}` })
      }
      return rows
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return []
  }
}

function modelFamily(key: string): string {
  if (key.includes("claude")) return "claude"
  if (key.includes("gemini-flash")) return "gemini-flash"
  if (key.includes("gemini-pro")) return "gemini-pro"
  if (key.includes("gemini")) return "gemini"
  return "gemini"
}

function modelDisplayName(key: string): string {
  if (key.includes("claude")) return "Claude"
  if (key.includes("gemini-flash")) return "Gemini Flash"
  if (key.includes("gemini-pro")) return "Gemini Pro"
  if (key.includes("gemini")) return "Gemini"
  return key
}

function modelProvider(key: string): string {
  if (key.includes("claude")) return "Anthropic"
  return "Google"
}

export function maskAccount(value: unknown, index: number): string {
  if (typeof value !== "string" || !value.includes("@")) return `Account ${index + 1}`
  const [local, domain] = value.split("@")
  if (!local || !domain) return `Account ${index + 1}`
  return `${local.slice(0, 1)}${"*".repeat(Math.min(3, Math.max(1, local.length - 1)))}@${domain}`
}

export function parseAntigravityAccounts(value: unknown): QuotaRow[] {
  const data = object(value)
  if (!data) return []
  const activeIndexByFamily: Record<string, number> = object(data.activeIndexByFamily) ?? {}
  const accounts: any[] = Array.isArray(data.accounts) ? data.accounts : []
  const rows: QuotaRow[] = []

  accounts.forEach((account, accountIndex) => {
    if (!account?.enabled || !object(account.cachedQuota)) return
    const accountName = maskAccount(account.email, accountIndex)
    const updatedAt = typeof account.cachedQuotaUpdatedAt === "number" ? account.cachedQuotaUpdatedAt : undefined
    for (const [modelKey, raw] of Object.entries(account.cachedQuota)) {
      const quota = object(raw)
      if (!quota || typeof quota.remainingFraction !== "number") continue
      const family = modelFamily(modelKey)
      const baseFamily = family.split("-")[0]
      const activeIndex = activeIndexByFamily[baseFamily] ?? activeIndexByFamily[family]
      const active = activeIndex === accountIndex ? " [active]" : ""
      const resetAt = typeof quota.resetTime === "string" ? Date.parse(quota.resetTime) / 1000 : undefined
      const percent = Math.round(Math.max(0, Math.min(1, quota.remainingFraction)) * 100)
      rows.push({
        provider: modelProvider(modelKey),
        account: accountName,
        name: `${modelDisplayName(modelKey)}${active}`,
        value: `${percent} % left`,
        percent,
        resetAt: Number.isFinite(resetAt) ? resetAt : undefined,
        updatedAt,
      })
    }
  })

  return rows.sort((left, right) => (left.account ?? left.provider).localeCompare(right.account ?? right.provider) || left.provider.localeCompare(right.provider) || left.name.localeCompare(right.name))
}

async function readAntigravity(): Promise<QuotaRow[]> {
  try {
    const data = JSON.parse(await readFile(join(homedir(), ".config", "opencode", "antigravity-accounts.json"), "utf8"))
    return parseAntigravityAccounts(data)
  } catch {
    return []
  }
}

let cached: QuotaSnapshot | undefined
let cachedAt = 0
let inflight: Promise<QuotaSnapshot> | undefined

export async function fetchQuotaSnapshot(force = false): Promise<QuotaSnapshot> {
  if (!force && cached && Date.now() - cachedAt < 60_000) return cached
  if (inflight) return inflight
  inflight = (async () => {
    let auth: PlainObject = {}
    try {
      auth = JSON.parse(await readFile(join(homedir(), ".local", "share", "opencode", "auth.json"), "utf8"))
    } catch {
      // Missing auth file is fine
    }
    const [openai, openrouter, google] = await Promise.all([fetchOpenAI(auth), fetchOpenRouter(auth), readAntigravity()])
    const rows = [...openai, ...openrouter, ...google]
    cached = { exportedAt: Math.floor(Date.now() / 1000), rows, providerCount: Number(openai.length > 0) + Number(openrouter.length > 0) + Number(google.length > 0) }
    cachedAt = Date.now()
    return cached
  })().finally(() => { inflight = undefined })
  return inflight
}

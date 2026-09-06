import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join, resolve } from "node:path"

export type QuotaRow = {
  provider: string
  service?: string
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

export type QuotaFetchOptions = {
  force?: boolean
  live?: boolean
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

function jwtEmail(token: string): string | undefined {
  try {
    const raw = token.split(".")[1]
    if (!raw) return undefined
    const payload = JSON.parse(Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"))
    return typeof payload?.email === "string" ? payload.email : undefined
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
      const account = maskEmail(jwtEmail(entry.access) ?? entry.email)
      return parseOpenAIUsage(await response.json()).map((row) => ({ ...row, account }))
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

export function maskEmail(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.includes("@")) return undefined
  const [local, domain] = value.split("@")
  if (!local || !domain) return undefined
  const head = local.slice(0, Math.min(3, local.length))
  const tail = local.length > 3 ? local.slice(-Math.min(3, local.length - 3)) : ""
  return `${head}***${tail}@${domain}`
}

export function opencodeConfigDir(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  if (env.OPENCODE_CONFIG_DIR) return resolve(env.OPENCODE_CONFIG_DIR)
  if (env.XDG_CONFIG_HOME) return resolve(env.XDG_CONFIG_HOME, "opencode")
  return resolve(home, ".config", "opencode")
}

export function opencodeDataDir(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  if (env.OPENCODE_DATA_DIR) return resolve(env.OPENCODE_DATA_DIR)
  if (env.XDG_DATA_HOME) return resolve(env.XDG_DATA_HOME, "opencode")
  return resolve(home, ".local", "share", "opencode")
}

export function parseAntigravityAccounts(value: unknown): QuotaRow[] {
  const data = object(value)
  if (!data) return []
  const activeIndexByFamily: Record<string, number> = object(data.activeIndexByFamily) ?? {}
  const accounts: any[] = Array.isArray(data.accounts) ? data.accounts : []
  const rows: QuotaRow[] = []

  accounts.forEach((account, accountIndex) => {
    if (!account?.enabled || !object(account.cachedQuota)) return
    const accountName = maskEmail(account.email) ?? `Account ${accountIndex + 1}`
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
        service: "Antigravity",
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
    const data = JSON.parse(await readFile(join(opencodeConfigDir(), "antigravity-accounts.json"), "utf8"))
    return parseAntigravityAccounts(data)
  } catch {
    return []
  }
}

const cache = new Map<"local" | "live", { snapshot: QuotaSnapshot; at: number }>()
const inflight = new Map<"local" | "live", Promise<QuotaSnapshot>>()

export async function fetchQuotaSnapshot(options: QuotaFetchOptions = {}): Promise<QuotaSnapshot> {
  const key = options.live ? "live" : "local"
  const cached = cache.get(key)
  if (!options.force && cached && Date.now() - cached.at < 60_000) return cached.snapshot
  const active = inflight.get(key)
  if (active) return active
  const request = (async () => {
    const googlePromise = readAntigravity()
    if (!options.live) {
      const rows = await googlePromise
      return { exportedAt: Math.floor(Date.now() / 1000), rows, providerCount: Number(rows.length > 0) }
    }
    let auth: PlainObject = {}
    try {
      auth = JSON.parse(await readFile(join(opencodeDataDir(), "auth.json"), "utf8"))
    } catch {
      // Missing auth file is fine
    }
    const [openai, openrouter, google] = await Promise.all([fetchOpenAI(auth), fetchOpenRouter(auth), googlePromise])
    const rows = [...openai, ...openrouter, ...google]
    return { exportedAt: Math.floor(Date.now() / 1000), rows, providerCount: Number(openai.length > 0) + Number(openrouter.length > 0) + Number(google.length > 0) }
  })()
    .then((snapshot) => {
      cache.set(key, { snapshot, at: Date.now() })
      return snapshot
    })
    .finally(() => { inflight.delete(key) })
  inflight.set(key, request)
  return request
}

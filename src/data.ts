import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { AgentRow, SessionTelemetry } from "./types.ts"
import { safeNumber, shortModel } from "./format.ts"
import type { ExecutionTracker } from "./tracker.ts"

export function sessionTelemetry(api: TuiPluginApi, sessionID: string, tick?: number): SessionTelemetry {
  if (tick !== undefined) tick // establish dependency
  const result: SessionTelemetry = {
    input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0,
    cost: 0, hasEstimatedCost: false, responses: 0,
  }

  for (const message of api.state.session.messages(sessionID)) {
    if (message.role !== "assistant") continue
    const input = safeNumber(message.tokens.input)
    const output = safeNumber(message.tokens.output)
    const reasoning = safeNumber(message.tokens.reasoning)
    const cacheRead = safeNumber(message.tokens.cache?.read)
    const cacheWrite = safeNumber(message.tokens.cache?.write)
    const estimatedCost = typeof message.cost === "number" && Number.isFinite(message.cost) && message.cost > 0
    const cost = safeNumber(message.cost)
    if (input + output + reasoning + cacheRead + cacheWrite > 0 || estimatedCost) {
      result.responses++
    }
    result.input = safeNumber(result.input + input)
    result.output = safeNumber(result.output + output)
    result.reasoning = safeNumber(result.reasoning + reasoning)
    result.cacheRead = safeNumber(result.cacheRead + cacheRead)
    result.cacheWrite = safeNumber(result.cacheWrite + cacheWrite)
    result.cost = safeNumber(result.cost + cost)
    result.hasEstimatedCost ||= estimatedCost
  }
  return result
}

function fallbackCount(config: Record<string, unknown>): number {
  const direct = config.fallback_models
  if (Array.isArray(direct)) return direct.length
  const options = config.options
  if (typeof options === "object" && options !== null && "fallback_models" in options) {
    const nested = options.fallback_models
    return Array.isArray(nested) ? nested.length : 0
  }
  return 0
}

export function configuredAgents(api: TuiPluginApi, sessionID?: string, tracker?: ExecutionTracker): AgentRow[] {
  const running = new Set<string>()
  const runtime = new Map<string, { displayName: string; model: string }>()
  if (tracker) {
    for (const row of tracker.rows(sessionID)) {
      if (!row.agent) continue
      const key = row.agent.toLowerCase()
      runtime.set(key, { displayName: row.agent, model: row.model })
      if (row.status === "running") running.add(key)
    }
  } else if (sessionID) {
    for (const message of api.state.session.messages(sessionID)) {
      if (message.role !== "assistant") continue
      for (const part of api.state.part(message.id)) {
        if (part.type !== "tool" || part.tool !== "task" || part.state.status !== "running") continue
        const name = part.state.input.subagent_type
        if (typeof name === "string") running.add(name.toLowerCase())
      }
    }
  }

  const configured = Object.entries(api.state.config.agent ?? {})
    .flatMap(([name, config]): AgentRow[] => {
      if (!config || config.disable || config.hidden) return []
      const raw = config as Record<string, unknown>
      return [{
        name,
        mode: config.mode ?? "unknown",
        model: shortModel(config.model),
        variant: config.variant,
        fallbackCount: fallbackCount(raw),
        running: running.has(name.toLowerCase()),
      }]
    })

  const configuredNames = new Set(configured.map((agent) => agent.name.toLowerCase()))
  const discovered = [...runtime.entries()].flatMap(([key, agent]): AgentRow[] => configuredNames.has(key) ? [] : [{
    name: agent.displayName,
    mode: "subagent",
    model: agent.model,
    fallbackCount: 0,
    running: running.has(key),
  }])

  return [...configured, ...discovered]
    .sort((a, b) => {
      const priority = (mode: AgentRow["mode"]) => mode === "primary" ? 0 : mode === "all" ? 1 : 2
      return priority(a.mode) - priority(b.mode) || a.name.localeCompare(b.name)
    })
}

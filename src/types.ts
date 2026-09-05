export type ExecutionStatus = "running" | "done" | "error"

export interface AgentRow {
  name: string
  mode: "primary" | "subagent" | "all" | "unknown"
  model: string
  variant?: string
  fallbackCount: number
  running: boolean
}

export interface ExecutionEntry {
  id: string
  sessionID?: string
  parentID: string
  messageID?: string
  partID?: string
  title: string
  summary?: string
  agent?: string
  startedAt: number
  endedAt?: number
  terminalOverride?: "done" | "error"
}

export interface ExecutionRow extends ExecutionEntry {
  status: ExecutionStatus
  model: string
  variant?: string
  input: number
  output: number
  cost?: number
}

export interface SessionTelemetry {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  cost: number
  hasEstimatedCost: boolean
  responses: number
  lastInput: number
  lastOutput: number
  lastCost?: number
  inputSamples: number[]
  outputSamples: number[]
  costSamples: number[]
}

export type CockpitLayout = "wide" | "medium" | "narrow" | "minimal"
export type ChartMode = "tokens" | "costs" | "work-status"
export type ChartCharset = "ascii" | "unicode"

export type RecommendationKind = "permission" | "question" | "retry" | "error" | "connection" | "running" | "healthy" | "no-session"

export interface DecisionContext {
  hasSession: boolean
  permissions: number
  questions: number
  retrying: boolean
  errors: number
  mcpConnected: number
  mcpTotal: number
  running: number
}

export interface Recommendation {
  kind: RecommendationKind
  title: string
  detail: string
  action: string
}

export function recommendNext(context: DecisionContext): Recommendation {
  if (!context.hasSession) return { kind: "no-session", title: "Start a session", detail: "No active session is available.", action: "Return to Chat and enter a task." }
  if (context.permissions > 0) return { kind: "permission", title: "Review permission", detail: `${context.permissions} permission request${context.permissions === 1 ? "" : "s"} waiting.`, action: "Return to Chat and approve or deny the request." }
  if (context.questions > 0) return { kind: "question", title: "Answer question", detail: `${context.questions} question${context.questions === 1 ? "" : "s"} waiting.`, action: "Return to Chat and provide the missing decision." }
  if (context.retrying) return { kind: "retry", title: "Check retry", detail: "The active session is retrying.", action: "Review the latest error before waiting or changing the request." }
  if (context.errors > 0) return { kind: "error", title: "Inspect failed work", detail: `${context.errors} delegated execution${context.errors === 1 ? "" : "s"} failed.`, action: "Select the failed execution and open its session." }
  if (context.mcpTotal > 0 && context.mcpConnected === 0) return { kind: "connection", title: "Check connections", detail: "No Model Context Protocol server is connected.", action: "Review server status before requesting connected tools." }
  if (context.running > 0) return { kind: "running", title: "Monitor delegated work", detail: `${context.running} execution${context.running === 1 ? " is" : "s are"} working.`, action: "Wait for completion or open an execution for detail." }
  return { kind: "healthy", title: "Ready for the next task", detail: "No action requires attention.", action: "Use the prompt to continue the session." }
}

import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { createSignal } from "solid-js"
import { sanitizeLine, shortModel } from "./format.ts"
import type { ExecutionEntry, ExecutionRow, ExecutionStatus } from "./types.ts"

type PendingInput = { description?: unknown; prompt?: unknown; subagent_type?: unknown }

export interface ExecutionTracker {
  rows(parentID?: string): ExecutionRow[]
  counts(parentID?: string): { running: number; done: number; error: number; total: number }
  hydrate(parentID: string): Promise<void>
  reconcile(parentID: string): Promise<void>
  dispose(): void
  hasRunning(parentID?: string): boolean
}

function targetSessionID(part: { state: Record<string, unknown> }): string | undefined {
  const metadata = part.state.metadata
  if (typeof metadata === "object" && metadata !== null && "sessionId" in metadata) {
    const value = metadata.sessionId
    if (typeof value === "string" && value.startsWith("ses_")) return value
  }
  const output = part.state.output
  if (typeof output === "string") return output.match(/ses_[A-Za-z0-9_-]+/)?.[0]
  return undefined
}

export function createExecutionTracker(api: TuiPluginApi): ExecutionTracker {
  const [entries, setEntries] = createSignal<Map<string, ExecutionEntry>>(new Map())
  const [tick, setTick] = createSignal(0)
  const disposers: Array<() => void> = []
  const hydrated = new Set<string>()
  const hydration = new Map<string, Promise<void>>()
  const hydrateRetryAt = new Map<string, number>()
  const reconciledAt = new Map<string, number>()
  const nextCalls = new Map<string, { parentID: string; title: string; agent?: string; startedAt: number }>()

  const updateTick = () => setTick(t => t + 1)

  const update = (id: string, patch: Partial<ExecutionEntry> & Pick<ExecutionEntry, "parentID" | "title">) => {
    let changed = false
    setEntries((current) => {
      const next = new Map(current)
      const previous = next.get(id)
      const { startedAt, ...rest } = patch
      const value: ExecutionEntry = {
        id,
        ...previous,
        ...rest,
        startedAt: previous?.startedAt ?? startedAt ?? Date.now(),
      }
      if (previous && Object.keys(value).every((key) => previous[key as keyof ExecutionEntry] === value[key as keyof ExecutionEntry])) return current
      next.set(id, value)
      changed = true
      return next
    })
    if (!changed) return
    updateTick()
    api.renderer.requestRender()
  }

  const registerSession = (session: { id: string; parentID?: string; title: string; agent?: string; time: { created: number } }) => {
    if (!session.parentID) return
    setEntries((current) => {
      const next = new Map(current)
      const candidates = [...next.values()].filter((entry) =>
        !entry.sessionID && entry.parentID === session.parentID &&
        (!entry.agent || !session.agent || entry.agent.toLowerCase() === session.agent.toLowerCase()),
      )
      const pending = candidates.length === 1 ? candidates[0] : undefined
      const previous = next.get(session.id)
      next.set(session.id, {
        id: session.id,
        sessionID: session.id,
        parentID: session.parentID!,
        messageID: pending?.messageID ?? previous?.messageID,
        partID: pending?.partID ?? previous?.partID,
        title: pending?.title || sanitizeLine(session.title) || "Delegated session",
        summary: pending?.summary ?? previous?.summary,
        agent: pending?.agent ?? session.agent ?? previous?.agent,
        startedAt: pending?.startedAt ?? previous?.startedAt ?? session.time.created,
        terminalOverride: previous?.terminalOverride,
        endedAt: previous?.endedAt,
      })
      if (pending) next.delete(pending.id)
      return next
    })
    updateTick()
    api.renderer.requestRender()
  }

  const ingestPart = (part: any, eventTime = Date.now()) => {
    if (part?.type === "subtask") {
      update(`pending:${part.id}`, {
        parentID: part.sessionID,
        messageID: part.messageID,
        partID: part.id,
        title: sanitizeLine(part.description || part.command || part.agent) || "SUBTASK",
        summary: sanitizeLine(part.prompt),
        agent: part.agent,
        startedAt: eventTime,
      })
      return
    }
    if (part?.type !== "tool" || (part.tool !== "task" && part.tool !== "delegate")) return
    const input = (part.state?.input ?? {}) as PendingInput
    const sessionID = targetSessionID(part as { state: Record<string, unknown> })
    const id = sessionID ?? `pending:${part.id}`
    const status = part.state?.status
    update(id, {
      sessionID,
      parentID: part.sessionID,
      messageID: part.messageID,
      partID: part.id,
      title: sanitizeLine(input.description ?? part.state?.title ?? input.subagent_type) || "DELEGATED TASK",
      summary: sanitizeLine(input.prompt),
      agent: typeof input.subagent_type === "string" ? input.subagent_type : undefined,
      startedAt: typeof part.state?.time === "object" && part.state.time && typeof part.state.time.start === "number"
        ? part.state.time.start
        : eventTime,
      terminalOverride: status === "error" ? "error" : status === "completed" ? "done" : undefined,
      endedAt: status === "error" || status === "completed" ? eventTime : undefined,
    })
  }

  disposers.push(api.event.on("session.created", (event) => {
    const info = event.properties.info
    registerSession(info)
    // Immediately reconcile parent session to fetch any siblings we might have missed
    if (info.parentID) {
      const parentID = info.parentID
      setTimeout(() => { if (!api.lifecycle.signal.aborted) void reconcile(parentID) }, 200)
    }
  }))
  disposers.push(api.event.on("session.updated", (event) => registerSession(event.properties.info)))
  disposers.push(api.event.on("session.status", (event) => {
    const previous = entries().get(event.properties.sessionID)
    if (!previous) return
    if (event.properties.status.type === "busy" || event.properties.status.type === "retry") {
      update(previous.id, { ...previous, terminalOverride: undefined, endedAt: undefined })
    } else if (previous.terminalOverride !== "error") {
      update(previous.id, { ...previous, terminalOverride: "done", endedAt: Date.now() })
    }
  }))
  disposers.push(api.event.on("session.idle", (event) => {
    const previous = entries().get(event.properties.sessionID)
    if (previous && previous.terminalOverride !== "error") update(previous.id, { ...previous, terminalOverride: "done", endedAt: Date.now() })
  }))
  disposers.push(api.event.on("session.error", (event) => {
    const id = event.properties.sessionID
    if (!id) return
    const previous = entries().get(id)
    if (previous) update(previous.id, { ...previous, terminalOverride: "error", endedAt: Date.now() })
  }))
  disposers.push(api.event.on("session.deleted", (event) => {
    setEntries((current) => {
      const next = new Map(current)
      next.delete(event.properties.info.id)
      return next
    })
    updateTick()
  }))
  disposers.push(api.event.on("message.part.updated", (event) => {
    ingestPart(event.properties.part, event.properties.time)
  }))
  const onEvent = api.event.on as unknown as (name: string, handler: (event: any) => void) => () => void
  disposers.push(onEvent("session.next.tool.called", (event) => {
    const props = event.properties
    if (props?.tool !== "task" && props?.tool !== "delegate") return
    const input = (props.input ?? {}) as PendingInput
    const title = sanitizeLine(input.description ?? input.subagent_type) || "DELEGATED TASK"
    const agent = typeof input.subagent_type === "string" ? input.subagent_type : undefined
    const startedAt = typeof props.timestamp === "number" ? props.timestamp : Date.now()
    nextCalls.set(props.callID, { parentID: props.sessionID, title, agent, startedAt })
    update(`next:${props.callID}`, { parentID: props.sessionID, title, agent, startedAt })
  }))
  disposers.push(onEvent("session.next.tool.success", (event) => {
    const call = nextCalls.get(event.properties?.callID)
    if (!call) return
    update(`next:${event.properties.callID}`, { ...call, terminalOverride: "done", endedAt: event.properties.timestamp ?? Date.now() })
    nextCalls.delete(event.properties.callID)
    void reconcile(call.parentID)
  }))
  disposers.push(onEvent("session.next.tool.failed", (event) => {
    const call = nextCalls.get(event.properties?.callID)
    if (!call) return
    update(`next:${event.properties.callID}`, { ...call, terminalOverride: "error", endedAt: event.properties.timestamp ?? Date.now() })
    nextCalls.delete(event.properties.callID)
  }))
  disposers.push(api.event.on("message.updated", (event) => {
    updateTick()
    const message = event.properties.info
    if (message.role !== "assistant" || !message.time.completed) return
    setEntries((current) => {
      let changed = false
      const next = new Map(current)
      for (const [id, entry] of next) {
        if (entry.sessionID || entry.messageID !== message.id || entry.terminalOverride) continue
        next.set(id, { ...entry, terminalOverride: message.error ? "error" : "done", endedAt: message.time.completed })
        changed = true
      }
      return changed ? next : current
    })
  }))
  disposers.push(api.event.on("message.part.removed", (event) => {
    setEntries((current) => {
      const next = new Map(current)
      for (const [id, entry] of next) if (!entry.sessionID && entry.partID === event.properties.partID) next.delete(id)
      return next.size === current.size ? current : next
    })
    updateTick()
  }))
  disposers.push(api.event.on("message.removed", (event) => {
    setEntries((current) => {
      const next = new Map(current)
      for (const [id, entry] of next) if (!entry.sessionID && entry.messageID === event.properties.messageID) next.delete(id)
      return next.size === current.size ? current : next
    })
    updateTick()
  }))

  function statusFor(entry: ExecutionEntry): ExecutionStatus {
    if (entry.terminalOverride) return entry.terminalOverride
    if (entry.endedAt) return "done"
    return "running"
  }

  function project(entry: ExecutionEntry): ExecutionRow {
    const session = entry.sessionID ? api.state.session.get(entry.sessionID) : undefined
    return {
      ...entry,
      title: entry.title || session?.title || "Delegated session",
      agent: entry.agent ?? session?.agent,
      status: statusFor(entry),
      model: shortModel(session?.model?.id),
      variant: session?.model?.variant,
      input: 0,
      output: 0,
      cost: undefined,
    }
  }

  async function hydrate(parentID: string): Promise<void> {
    if (hydrated.has(parentID) || api.lifecycle.signal.aborted) return
    if ((hydrateRetryAt.get(parentID) ?? 0) > Date.now()) return
    const existing = hydration.get(parentID)
    if (existing) return existing
    const request = (async () => {
      try {
        const response = await api.client.session.children({ sessionID: parentID, directory: api.state.path.directory })
        if (api.lifecycle.signal.aborted) return
        for (const session of response.data ?? []) registerSession(session)
        hydrated.add(parentID)
        hydrateRetryAt.delete(parentID)
      } catch {
        hydrated.delete(parentID)
        hydrateRetryAt.set(parentID, Date.now() + 30_000)
      } finally {
        hydration.delete(parentID)
      }
    })()
    hydration.set(parentID, request)
    return request
  }

  async function reconcile(parentID: string): Promise<void> {
    if (!parentID || api.lifecycle.signal.aborted) return
    // Scan local state for any tool parts we might have missed
    for (const message of api.state.session.messages(parentID)) {
      for (const part of api.state.part(message.id)) ingestPart(part)
    }
    // Throttle server calls to max once per 2 seconds, but do not block on in-flight
    const now = Date.now()
    if ((reconciledAt.get(parentID) ?? 0) + 2_000 > now) return
    if (hydration.has(parentID)) return
    reconciledAt.set(parentID, now)
    const request = (async () => {
      try {
        const response = await api.client.session.children({ sessionID: parentID, directory: api.state.path.directory })
        if (api.lifecycle.signal.aborted) return
        for (const session of response.data ?? []) registerSession(session)
        // Always force a tick+render after fetching children so the UI reflects current state
        updateTick()
        api.renderer.requestRender()
      } catch {
        // local state reconciliation via ingestPart above is still available
      } finally {
        hydration.delete(parentID)
      }
    })()
    hydration.set(parentID, request)
    return request
  }

  return {
    rows(parentID) {
      tick()
      return [...entries().values()]
        .filter((entry) => !parentID || entry.parentID === parentID)
        .map(project)
        .sort((a, b) => (a.status === "running" ? 0 : 1) - (b.status === "running" ? 0 : 1) || b.startedAt - a.startedAt)
    },
    counts(parentID) {
      tick()
      const counts = { running: 0, done: 0, error: 0, total: 0 }
      for (const entry of entries().values()) {
        if (parentID && entry.parentID !== parentID) continue
        counts[statusFor(entry)]++
        counts.total++
      }
      return counts
    },
    hydrate,
    reconcile,
    dispose() { for (const dispose of disposers) dispose() },
    hasRunning(parentID) { return [...entries().values()].some((entry) => (!parentID || entry.parentID === parentID) && statusFor(entry) === "running") },
  }
}

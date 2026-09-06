import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { sanitizeLine, shortModel } from "./format.ts"
import type { ExecutionEntry, ExecutionRow, ExecutionStatus } from "./types.ts"
import { diagnostic } from "./diagnostic.ts"

type PendingInput = { description?: unknown; prompt?: unknown; subagent_type?: unknown }

export interface ExecutionTracker {
  rows(parentID?: string): ExecutionRow[]
  counts(parentID?: string): { running: number; done: number; error: number; total: number }
  hydrate(parentID: string): Promise<void>
  reconcile(parentID: string): Promise<void>
  dispose(): void
  hasRunning(parentID?: string): boolean
}

export interface ExecutionTrackerReactivity {
  read(): void
  invalidate(): void
  requestRender?(): void
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

function terminalTime(part: any, fallback: number): number {
  const time = part?.state?.time
  if (typeof time === "object" && time !== null) {
    for (const key of ["end", "ended", "completed", "updated"]) {
      const value = time[key]
      if (typeof value === "number" && Number.isFinite(value) && value > 0) return value
    }
  }
  return fallback
}

export function createExecutionTracker(api: TuiPluginApi, reactivity?: ExecutionTrackerReactivity): ExecutionTracker {
  let entries = new Map<string, ExecutionEntry>()
  const disposers: Array<() => void> = []
  const hydrated = new Set<string>()
  const hydration = new Map<string, Promise<void>>()
  const hydrateRetryAt = new Map<string, number>()
  const reconciledAt = new Map<string, number>()
  const scheduledReconcile = new Map<string, ReturnType<typeof setTimeout>>()
  const sessionByPartID = new Map<string, string>()
  const sessionByNextCallID = new Map<string, string>()
  const nextCalls = new Map<string, { parentID: string; title: string; agent?: string; startedAt: number }>()

  const updateTick = () => reactivity?.invalidate()
  const requestRender = () => {
    if (reactivity?.requestRender) reactivity.requestRender()
    else api.renderer.requestRender()
  }

  const sameEntry = (left: ExecutionEntry | undefined, right: ExecutionEntry): boolean => Boolean(left) &&
    left!.id === right.id &&
    left!.sessionID === right.sessionID &&
    left!.parentID === right.parentID &&
    left!.messageID === right.messageID &&
    left!.partID === right.partID &&
    left!.title === right.title &&
    left!.summary === right.summary &&
    left!.agent === right.agent &&
    left!.startedAt === right.startedAt &&
    left!.correlationAt === right.correlationAt &&
    left!.endedAt === right.endedAt &&
    left!.terminalOverride === right.terminalOverride

  const publish = () => {
    updateTick()
    requestRender()
  }

  const snapshot = (parentID?: string) => [...entries.values()]
    .filter((entry) => !parentID || entry.parentID === parentID)
    .map((entry) => ({ id: entry.id, parentID: entry.parentID, sessionID: entry.sessionID, status: statusFor(entry), agent: entry.agent }))

  const update = (id: string, patch: Partial<ExecutionEntry> & Pick<ExecutionEntry, "parentID" | "title">) => {
    const previous = entries.get(id)
    const { startedAt, ...rest } = patch
    const value: ExecutionEntry = {
      id,
      ...previous,
      ...rest,
      startedAt: previous?.startedAt ?? startedAt ?? Date.now(),
    }
    if (sameEntry(previous, value)) return false
    entries.set(id, value)
    publish()
    diagnostic("tracker.update", () => ({ id, parentID: patch.parentID, rows: snapshot(patch.parentID) }))
    return true
  }

  type ChildSession = { id: string; parentID?: string; title: string; agent?: string; time: { created: number } }

  const registerSessions = (sessions: ChildSession[]): boolean => {
    let changed = false
    const registered: Array<{ id: string; parentID: string; agent?: string }> = []
    for (const session of sessions) {
      if (!session.parentID) {
        diagnostic("tracker.session.ignored", { id: session.id, reason: "missing-parent" })
        continue
      }
      const previous = entries.get(session.id)
      let pending: ExecutionEntry | undefined
      let aliases: ExecutionEntry[] = []
      if (!previous) {
        const candidates: ExecutionEntry[] = []
        for (const entry of entries.values()) {
          if (entry.sessionID || entry.parentID !== session.parentID || (entry.agent && session.agent && entry.agent.toLowerCase() !== session.agent.toLowerCase())) continue
          candidates.push(entry)
        }
        const sessionTitle = sanitizeLine(session.title).replace(/\s+\(@[^)]+\)$/, "").toLowerCase()
        const exact = candidates.filter((entry) => entry.title.toLowerCase() === sessionTitle)
        if (exact.length > 0) {
          const correlationTime = (entry: ExecutionEntry) => entry.correlationAt ?? entry.startedAt
          pending = exact.reduce((closest, entry) => Math.abs(correlationTime(entry) - session.time.created) < Math.abs(correlationTime(closest) - session.time.created) ? entry : closest)
          aliases = [pending]
          const kind = (entry: ExecutionEntry) => entry.id.startsWith("next:") ? "next" : entry.id.startsWith("pending:") ? "pending" : "other"
          const pendingKind = kind(pending)
          const sameKind = exact.filter((entry) => kind(entry) === pendingKind).sort((left, right) => correlationTime(left) - correlationTime(right))
          const counterparts = exact.filter((entry) => kind(entry) !== pendingKind && kind(entry) !== "other").sort((left, right) => correlationTime(left) - correlationTime(right))
          const counterpart = counterparts[sameKind.indexOf(pending)]
          if (counterpart) aliases.push(counterpart)
        } else if (candidates.length === 1) {
          pending = candidates[0]
          aliases = [pending]
        }
      }
      const value: ExecutionEntry = {
        id: session.id,
        sessionID: session.id,
        parentID: session.parentID,
        messageID: pending?.messageID ?? previous?.messageID,
        partID: pending?.partID ?? previous?.partID,
        title: pending?.title || previous?.title || sanitizeLine(session.title) || "Delegated session",
        summary: pending?.summary ?? previous?.summary,
        agent: pending?.agent ?? session.agent ?? previous?.agent,
        startedAt: pending?.startedAt ?? previous?.startedAt ?? session.time.created,
        correlationAt: pending?.correlationAt ?? previous?.correlationAt ?? session.time.created,
        terminalOverride: previous?.terminalOverride,
        endedAt: previous?.endedAt,
      }
      if (sameEntry(previous, value) && !pending) continue
      entries.set(session.id, value)
      if (pending) {
        for (const alias of aliases) {
          entries.delete(alias.id)
          if (alias.partID) sessionByPartID.set(alias.partID, session.id)
          if (alias.id.startsWith("next:")) sessionByNextCallID.set(alias.id.slice(5), session.id)
        }
      }
      changed = true
      registered.push({ id: session.id, parentID: session.parentID, agent: session.agent })
    }
    if (!changed) return false
    publish()
    diagnostic("tracker.sessions.registered", () => ({ sessions: registered }))
    return true
  }

  const registerSession = (session: ChildSession) => registerSessions([session])

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
    const callID = typeof part.callID === "string" ? part.callID : undefined
    const sessionID = targetSessionID(part as { state: Record<string, unknown> }) ?? sessionByPartID.get(part.id) ?? (callID ? sessionByNextCallID.get(callID) : undefined)
    if (sessionID) {
      sessionByPartID.set(part.id, sessionID)
      if (callID) sessionByNextCallID.set(callID, sessionID)
    }
    const title = sanitizeLine(input.description ?? part.state?.title ?? input.subagent_type) || "DELEGATED TASK"
    const agent = typeof input.subagent_type === "string" ? input.subagent_type : undefined
    const pendingID = callID ? `next:${callID}` : `pending:${part.id}`
    const pending = sessionID ? entries.get(pendingID) : undefined
    let removedAlias = Boolean(pending)
    if (pending) entries.delete(pendingID)
    if (sessionID && !callID) {
      const linkedNext = [...entries.values()].filter((entry) => entry.id.startsWith("next:") && !entry.sessionID && entry.parentID === part.sessionID && entry.title === title && (!entry.agent || !agent || entry.agent.toLowerCase() === agent.toLowerCase()))
      if (linkedNext.length === 1) {
        const alias = linkedNext[0]
        entries.delete(alias.id)
        sessionByNextCallID.set(alias.id.slice(5), sessionID)
        removedAlias = true
      }
    }
    const id = sessionID ?? pendingID
    const status = part.state?.status
    const previous = entries.get(id)
    const terminal = status === "error" || status === "completed"
    const changed = update(id, {
      sessionID,
      parentID: part.sessionID,
      messageID: part.messageID,
      partID: part.id,
      title,
      summary: sanitizeLine(input.prompt),
      agent,
      startedAt: typeof part.state?.time === "object" && part.state.time && typeof part.state.time.start === "number"
        ? part.state.time.start
        : pending?.startedAt ?? eventTime,
      correlationAt: typeof part.state?.time === "object" && part.state.time && typeof part.state.time.start === "number"
        ? part.state.time.start
        : eventTime,
      terminalOverride: status === "error" ? "error" : status === "completed" ? "done" : undefined,
      endedAt: terminal ? previous?.endedAt ?? pending?.endedAt ?? terminalTime(part, eventTime) : undefined,
    })
    if (removedAlias && !changed) publish()
  }

  disposers.push(api.event.on("session.created", (event) => {
    const info = event.properties.info
    diagnostic("event.session.created", { id: info.id, parentID: info.parentID, agent: info.agent })
    registerSession(info)
    if (info.parentID && !scheduledReconcile.has(info.parentID)) {
      const parentID = info.parentID
      const timer = setTimeout(() => {
        scheduledReconcile.delete(parentID)
        if (!api.lifecycle.signal.aborted) void reconcile(parentID)
      }, 250)
      scheduledReconcile.set(parentID, timer)
    }
  }))
  disposers.push(api.event.on("session.updated", (event) => {
    const info = event.properties.info
    diagnostic("event.session.updated", { id: info.id, parentID: info.parentID, agent: info.agent })
    registerSession(info)
  }))
  disposers.push(api.event.on("session.status", (event) => {
    diagnostic("event.session.status", { id: event.properties.sessionID, status: event.properties.status.type, known: entries.has(event.properties.sessionID) })
    const previous = entries.get(event.properties.sessionID)
    if (!previous) return
    if (event.properties.status.type === "busy" || event.properties.status.type === "retry") {
      update(previous.id, { ...previous, terminalOverride: undefined, endedAt: undefined })
    } else if (previous.terminalOverride !== "error") {
      update(previous.id, { ...previous, terminalOverride: "done", endedAt: previous.endedAt ?? Date.now() })
    }
  }))
  disposers.push(api.event.on("session.idle", (event) => {
    diagnostic("event.session.idle", { id: event.properties.sessionID, known: entries.has(event.properties.sessionID) })
    const previous = entries.get(event.properties.sessionID)
    if (previous && previous.terminalOverride !== "error") update(previous.id, { ...previous, terminalOverride: "done", endedAt: previous.endedAt ?? Date.now() })
  }))
  disposers.push(api.event.on("session.error", (event) => {
    const id = event.properties.sessionID
    diagnostic("event.session.error", { id, known: id ? entries.has(id) : false })
    if (!id) return
    const previous = entries.get(id)
    if (previous) update(previous.id, { ...previous, terminalOverride: "error", endedAt: previous.endedAt ?? Date.now() })
  }))
  disposers.push(api.event.on("session.deleted", (event) => {
    if (!entries.has(event.properties.info.id)) return
    entries.delete(event.properties.info.id)
    for (const [partID, sessionID] of sessionByPartID) if (sessionID === event.properties.info.id) sessionByPartID.delete(partID)
    for (const [callID, sessionID] of sessionByNextCallID) if (sessionID === event.properties.info.id) sessionByNextCallID.delete(callID)
    publish()
  }))
  disposers.push(api.event.on("message.part.updated", (event) => {
    const part = event.properties.part as any
    if (part?.type === "subtask" || (part?.type === "tool" && (part?.tool === "task" || part?.tool === "delegate"))) {
      diagnostic("event.message.part.updated", { partID: part.id, parentID: part.sessionID, messageID: part.messageID, type: part.type, tool: part.tool, status: part.state?.status, targetSessionID: part.type === "tool" && part.state ? targetSessionID(part) : undefined })
    }
    ingestPart(part, event.properties.time)
  }))
  const onEvent = api.event.on as unknown as (name: string, handler: (event: any) => void) => () => void
  disposers.push(onEvent("session.next.tool.called", (event) => {
    const props = event.properties
    if (props?.tool !== "task" && props?.tool !== "delegate") return
    diagnostic("event.session.next.tool.called", { callID: props.callID, parentID: props.sessionID, tool: props.tool })
    const input = (props.input ?? {}) as PendingInput
    const title = sanitizeLine(input.description ?? input.subagent_type) || "DELEGATED TASK"
    const agent = typeof input.subagent_type === "string" ? input.subagent_type : undefined
    const startedAt = typeof props.timestamp === "number" ? props.timestamp : Date.now()
    nextCalls.set(props.callID, { parentID: props.sessionID, title, agent, startedAt })
    update(`next:${props.callID}`, { parentID: props.sessionID, title, agent, startedAt, correlationAt: startedAt })
  }))
  disposers.push(onEvent("session.next.tool.success", (event) => {
    const callID = event.properties?.callID
    const call = nextCalls.get(callID)
    if (!call) return
    const sessionID = sessionByNextCallID.get(callID)
    const id = sessionID ?? `next:${callID}`
    update(id, { ...call, sessionID, title: entries.get(id)?.title ?? call.title, terminalOverride: "done", endedAt: event.properties.timestamp ?? Date.now() })
    nextCalls.delete(callID)
    sessionByNextCallID.delete(callID)
    void reconcile(call.parentID)
  }))
  disposers.push(onEvent("session.next.tool.failed", (event) => {
    const callID = event.properties?.callID
    const call = nextCalls.get(callID)
    if (!call) return
    const sessionID = sessionByNextCallID.get(callID)
    const id = sessionID ?? `next:${callID}`
    update(id, { ...call, sessionID, title: entries.get(id)?.title ?? call.title, terminalOverride: "error", endedAt: event.properties.timestamp ?? Date.now() })
    nextCalls.delete(callID)
    sessionByNextCallID.delete(callID)
  }))
  disposers.push(api.event.on("message.updated", (event) => {
    const message = event.properties.info
    if (message.role !== "assistant" || !message.time.completed) return
    let changed = false
    for (const [id, entry] of entries) {
      if (entry.sessionID || entry.messageID !== message.id || entry.terminalOverride) continue
      entries.set(id, { ...entry, terminalOverride: message.error ? "error" : "done", endedAt: message.time.completed })
      changed = true
    }
    if (!changed) return
    publish()
  }))
  disposers.push(api.event.on("message.part.removed", (event) => {
    sessionByPartID.delete(event.properties.partID)
    let changed = false
    for (const [id, entry] of entries) {
      if (entry.sessionID || entry.partID !== event.properties.partID) continue
      entries.delete(id)
      changed = true
    }
    if (!changed) return
    publish()
  }))
  disposers.push(api.event.on("message.removed", (event) => {
    let changed = false
    for (const [id, entry] of entries) {
      if (entry.sessionID || entry.messageID !== event.properties.messageID) continue
      entries.delete(id)
      changed = true
    }
    if (!changed) return
    publish()
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
        registerSessions(response.data ?? [])
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
    const now = Date.now()
    if ((reconciledAt.get(parentID) ?? 0) + 15_000 > now) return
    if (hydration.has(parentID)) return
    reconciledAt.set(parentID, now)
    // Event handlers are the realtime path; this scan is a low-frequency safety net.
    for (const message of api.state.session.messages(parentID)) {
      for (const part of api.state.part(message.id)) ingestPart(part)
    }
    // Keep server reconciliation infrequent and coalesce in-flight requests.
    const request = (async () => {
      try {
        const response = await api.client.session.children({ sessionID: parentID, directory: api.state.path.directory })
        if (api.lifecycle.signal.aborted) return
        diagnostic("tracker.reconcile.response", () => ({ parentID, childIDs: (response.data ?? []).map((session) => session.id) }))
        registerSessions(response.data ?? [])
      } catch (error) {
        diagnostic("tracker.reconcile.error", { parentID, error: error instanceof Error ? error.message : String(error) })
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
      reactivity?.read()
      return [...entries.values()]
        .filter((entry) => !parentID || entry.parentID === parentID)
        .map(project)
        .sort((a, b) => (a.status === "running" ? 0 : 1) - (b.status === "running" ? 0 : 1) || b.startedAt - a.startedAt)
    },
    counts(parentID) {
      reactivity?.read()
      const counts = { running: 0, done: 0, error: 0, total: 0 }
      for (const entry of entries.values()) {
        if (parentID && entry.parentID !== parentID) continue
        counts[statusFor(entry)]++
        counts.total++
      }
      return counts
    },
    hydrate,
    reconcile,
    dispose() {
      for (const timer of scheduledReconcile.values()) clearTimeout(timer)
      scheduledReconcile.clear()
      for (const dispose of disposers) dispose()
    },
    hasRunning(parentID) { return [...entries.values()].some((entry) => (!parentID || entry.parentID === parentID) && statusFor(entry) === "running") },
  }
}

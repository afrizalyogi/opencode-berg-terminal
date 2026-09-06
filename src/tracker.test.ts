import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { createRoot } from "solid-js"
import { createExecutionTracker } from "./tracker.ts"

describe("execution tracker", () => {
  test("keeps rows and title counts reactive to execution events", () => {
    createRoot((dispose) => {
      const listeners = new Map<string, Array<(event: any) => void>>()
      const statuses = new Map<string, { type: string }>()
      const api = {
        event: {
          on(name: string, listener: (event: any) => void) {
            const group = listeners.get(name) ?? []
            group.push(listener)
            listeners.set(name, group)
            return () => listeners.set(name, group.filter((item) => item !== listener))
          },
        },
        renderer: { requestRender() {} },
        lifecycle: { signal: new AbortController().signal },
        state: {
          path: { directory: "C:/workspace" },
          session: {
            get() { return undefined },
            status(id: string) { return statuses.get(id) },
            messages() { return [] },
          },
          part() { return [] },
        },
        client: { session: { async children() { return { data: [] } } } },
      } as any

      let revision = 0
      let invalidations = 0
      const tracker = createExecutionTracker(api, {
        read: () => { revision },
        invalidate: () => { revision += 1; invalidations += 1 },
      })
      const emit = (name: string, properties: unknown) => {
        for (const listener of listeners.get(name) ?? []) listener({ properties })
      }

      assert.deepEqual(tracker.counts("parent"), { running: 0, done: 0, error: 0, total: 0 })
      emit("session.created", { info: { id: "ses_child", parentID: "parent", title: "Child", agent: "test", time: { created: 1 } } })
      statuses.set("ses_child", { type: "busy" })
      emit("session.status", { sessionID: "ses_child", status: { type: "busy" } })

      assert.equal(tracker.rows("parent").length, 1)
      assert.deepEqual(tracker.counts("parent"), { running: 1, done: 0, error: 0, total: 1 })
      assert.ok(invalidations > 0)

      emit("session.error", { sessionID: "ses_child" })
      assert.deepEqual(tracker.counts("parent"), { running: 0, done: 0, error: 1, total: 1 })

      tracker.dispose()
      dispose()
    })
  })

  test("keeps the tool title and terminal time stable during reconciliation", () => {
    createRoot((dispose) => {
      const listeners = new Map<string, Array<(event: any) => void>>()
      const api = {
        event: { on(name: string, listener: (event: any) => void) { const group = listeners.get(name) ?? []; group.push(listener); listeners.set(name, group); return () => {} } },
        renderer: { requestRender() {} },
        lifecycle: { signal: new AbortController().signal },
        state: { path: { directory: "C:/workspace" }, session: { get() { return undefined }, messages() { return [] } }, part() { return [] } },
        client: { session: { async children() { return { data: [] } } } },
      } as any
      let revision = 0
      const tracker = createExecutionTracker(api, { read: () => { revision }, invalidate: () => { revision += 1 } })
      const emit = (name: string, properties: unknown) => { for (const listener of listeners.get(name) ?? []) listener({ properties }) }
      const part = {
        id: "prt_task", sessionID: "parent", messageID: "message", type: "tool", tool: "task",
        state: { status: "completed", input: { description: "Say hi", subagent_type: "explore" }, metadata: { sessionId: "ses_child" }, time: { start: 1_000, end: 5_000 } },
      }

      emit("message.part.updated", { part, time: 6_000 })
      emit("session.updated", { info: { id: "ses_child", parentID: "parent", title: "Say hi (@explore)", agent: "explore", time: { created: 1_000 } } })
      emit("message.part.updated", { part, time: 30_000 })

      const row = tracker.rows("parent")[0]
      assert.equal(row?.title, "Say hi")
      assert.equal(row?.endedAt, 5_000)
      assert.equal(row?.status, "done")
      tracker.dispose()
      dispose()
    })
  })

  test("does not invalidate or render unchanged task updates", () => {
    createRoot((dispose) => {
      const listeners = new Map<string, Array<(event: any) => void>>()
      let renders = 0
      let invalidations = 0
      const api = {
        event: { on(name: string, listener: (event: any) => void) { const group = listeners.get(name) ?? []; group.push(listener); listeners.set(name, group); return () => {} } },
        renderer: { requestRender() { renders++ } },
        lifecycle: { signal: new AbortController().signal },
        state: { path: { directory: "C:/workspace" }, session: { get() {}, messages() { return [] } }, part() { return [] } },
        client: { session: { async children() { return { data: [] } } } },
      } as any
      const tracker = createExecutionTracker(api, { read() {}, invalidate() { invalidations++ } })
      const part = {
        id: "part", sessionID: "parent", messageID: "message", type: "tool", tool: "task",
        state: { status: "running", input: { description: "Task", subagent_type: "worker" }, time: { start: 1 } },
      }
      const emit = () => { for (const listener of listeners.get("message.part.updated") ?? []) listener({ properties: { part, time: 1 } }) }

      emit()
      renders = 0
      invalidations = 0
      emit()

      assert.equal(renders, 0)
      assert.equal(invalidations, 0)
      tracker.dispose()
      dispose()
    })
  })

  test("does not consume a newer pending task when an existing child updates", () => {
    createRoot((dispose) => {
      const listeners = new Map<string, Array<(event: any) => void>>()
      const api = {
        event: { on(name: string, listener: (event: any) => void) { const group = listeners.get(name) ?? []; group.push(listener); listeners.set(name, group); return () => {} } },
        renderer: { requestRender() {} }, lifecycle: { signal: new AbortController().signal },
        state: { path: { directory: "C:/workspace" }, session: { get() {}, messages() { return [] } }, part() { return [] } },
        client: { session: { async children() { return { data: [] } } } },
      } as any
      const tracker = createExecutionTracker(api)
      const emit = (name: string, properties: unknown) => { for (const listener of listeners.get(name) ?? []) listener({ properties }) }

      emit("session.created", { info: { id: "ses_old", parentID: "parent", title: "Old task", agent: "worker", time: { created: 1 } } })
      emit("message.part.updated", { part: { id: "new-part", sessionID: "parent", messageID: "new-message", type: "tool", tool: "task", state: { status: "running", input: { description: "New task", subagent_type: "worker" }, time: { start: 2 } } }, time: 2 })
      emit("session.updated", { info: { id: "ses_old", parentID: "parent", title: "Old task updated", agent: "worker", time: { created: 1 } } })

      assert.deepEqual(tracker.rows("parent").map((row) => row.title).sort(), ["New task", "Old task"])
      tracker.dispose()
      dispose()
    })
  })

  test("keeps a part linked after its pending row becomes a child session", () => {
    createRoot((dispose) => {
      const listeners = new Map<string, Array<(event: any) => void>>()
      const api = {
        event: { on(name: string, listener: (event: any) => void) { const group = listeners.get(name) ?? []; group.push(listener); listeners.set(name, group); return () => {} } },
        renderer: { requestRender() {} }, lifecycle: { signal: new AbortController().signal },
        state: { path: { directory: "C:/workspace" }, session: { get() {}, messages() { return [] } }, part() { return [] } },
        client: { session: { async children() { return { data: [] } } } },
      } as any
      const tracker = createExecutionTracker(api)
      const emit = (name: string, properties: unknown) => { for (const listener of listeners.get(name) ?? []) listener({ properties }) }
      const part = { id: "part", callID: "call", sessionID: "parent", messageID: "message", type: "tool", tool: "task", state: { status: "running", input: { description: "Task", subagent_type: "worker" }, time: { start: 1 } } }

      emit("message.part.updated", { part, time: 1 })
      emit("session.created", { info: { id: "ses_child", parentID: "parent", title: "Task", agent: "worker", time: { created: 1 } } })
      emit("message.part.updated", { part, time: 2 })

      const rows = tracker.rows("parent")
      assert.equal(rows.length, 1)
      assert.equal(rows[0]?.sessionID, "ses_child")
      tracker.dispose()
      dispose()
    })
  })

  test("migrates a pending part when target session metadata arrives", () => {
    createRoot((dispose) => {
      const listeners = new Map<string, Array<(event: any) => void>>()
      const api = {
        event: { on(name: string, listener: (event: any) => void) { const group = listeners.get(name) ?? []; group.push(listener); listeners.set(name, group); return () => {} } },
        renderer: { requestRender() {} }, lifecycle: { signal: new AbortController().signal },

        state: { path: { directory: "C:/workspace" }, session: { get() {}, messages() { return [] } }, part() { return [] } },
        client: { session: { async children() { return { data: [] } } } },
      } as any
      const tracker = createExecutionTracker(api)
      const emit = (part: any) => { for (const listener of listeners.get("message.part.updated") ?? []) listener({ properties: { part, time: 2 } }) }
      const part = { id: "part", sessionID: "parent", messageID: "message", type: "tool", tool: "task", state: { status: "running", input: { description: "Task", subagent_type: "worker" }, time: { start: 1 } } }

      emit(part)
      emit({ ...part, state: { ...part.state, status: "completed", metadata: { sessionId: "ses_child" }, time: { start: 1, end: 2 } } })

      const rows = tracker.rows("parent")
      assert.equal(rows.length, 1)
      assert.equal(rows[0]?.sessionID, "ses_child")
      assert.equal(rows[0]?.status, "done")
      tracker.dispose()
      dispose()
    })
  })

  test("keeps next-tool completion on its correlated child session", () => {
    createRoot((dispose) => {
      const listeners = new Map<string, Array<(event: any) => void>>()
      const api = {
        event: { on(name: string, listener: (event: any) => void) { const group = listeners.get(name) ?? []; group.push(listener); listeners.set(name, group); return () => {} } },
        renderer: { requestRender() {} }, lifecycle: { signal: new AbortController().signal },
        state: { path: { directory: "C:/workspace" }, session: { get() {}, messages() { return [] } }, part() { return [] } },
        client: { session: { async children() { return { data: [] } } } },
      } as any
      const tracker = createExecutionTracker(api)
      const emit = (name: string, properties: unknown) => { for (const listener of listeners.get(name) ?? []) listener({ properties }) }

      emit("session.next.tool.called", { callID: "call", sessionID: "parent", tool: "task", input: { description: "Task", subagent_type: "worker" }, timestamp: 1 })
      emit("session.created", { info: { id: "ses_child", parentID: "parent", title: "Task", agent: "worker", time: { created: 1 } } })
      emit("session.next.tool.success", { callID: "call", timestamp: 2 })

      const rows = tracker.rows("parent")
      assert.equal(rows.length, 1)
      assert.equal(rows[0]?.sessionID, "ses_child")
      assert.equal(rows[0]?.status, "done")
      tracker.dispose()
      dispose()
    })
  })

  test("merges next-tool and part aliases into one child execution", () => {
    createRoot((dispose) => {
      const listeners = new Map<string, Array<(event: any) => void>>()
      const api = {
        event: { on(name: string, listener: (event: any) => void) { const group = listeners.get(name) ?? []; group.push(listener); listeners.set(name, group); return () => {} } },
        renderer: { requestRender() {} }, lifecycle: { signal: new AbortController().signal },
        state: { path: { directory: "C:/workspace" }, session: { get() {}, messages() { return [] } }, part() { return [] } },
        client: { session: { async children() { return { data: [] } } } },
      } as any
      const tracker = createExecutionTracker(api)
      const emit = (name: string, properties: unknown) => { for (const listener of listeners.get(name) ?? []) listener({ properties }) }
      const part = { id: "part", sessionID: "parent", messageID: "message", type: "tool", tool: "task", state: { status: "running", input: { description: "Task", subagent_type: "worker" }, time: { start: 1 } } }

      emit("session.next.tool.called", { callID: "call", sessionID: "parent", tool: "task", input: { description: "Task", subagent_type: "worker" }, timestamp: 1 })
      emit("message.part.updated", { part, time: 1 })
      emit("session.created", { info: { id: "ses_child", parentID: "parent", title: "Task (@worker)", agent: "worker", time: { created: 1 } } })
      emit("session.next.tool.success", { callID: "call", timestamp: 2 })

      const rows = tracker.rows("parent")
      assert.equal(rows.length, 1)
      assert.equal(rows[0]?.sessionID, "ses_child")
      assert.equal(rows[0]?.status, "done")
      tracker.dispose()
      dispose()
    })
  })

  test("merges delayed next-tool and part aliases", () => {
    createRoot((dispose) => {
      const listeners = new Map<string, Array<(event: any) => void>>()
      const api = {
        event: { on(name: string, listener: (event: any) => void) { const group = listeners.get(name) ?? []; group.push(listener); listeners.set(name, group); return () => {} } },
        renderer: { requestRender() {} }, lifecycle: { signal: new AbortController().signal },
        state: { path: { directory: "C:/workspace" }, session: { get() {}, messages() { return [] } }, part() { return [] } },
        client: { session: { async children() { return { data: [] } } } },
      } as any
      const tracker = createExecutionTracker(api)
      const emit = (name: string, properties: unknown) => { for (const listener of listeners.get(name) ?? []) listener({ properties }) }
      const part = { id: "part", callID: "call", sessionID: "parent", messageID: "message", type: "tool", tool: "task", state: { status: "running", input: { description: "Task", subagent_type: "worker" }, time: { start: 5_000 } } }

      emit("session.next.tool.called", { callID: "call", sessionID: "parent", tool: "task", input: { description: "Task", subagent_type: "worker" }, timestamp: 1 })
      emit("message.part.updated", { part, time: 5_000 })
      emit("session.created", { info: { id: "ses_child", parentID: "parent", title: "Task (@worker)", agent: "worker", time: { created: 5_000 } } })
      emit("session.next.tool.success", { callID: "call", timestamp: 6_000 })

      const rows = tracker.rows("parent")
      assert.equal(rows.length, 1)
      assert.equal(rows[0]?.sessionID, "ses_child")
      assert.equal(rows[0]?.status, "done")
      tracker.dispose()
      dispose()
    })
  })

  test("keeps concurrent same-title aliases paired by execution order", () => {
    createRoot((dispose) => {
      const listeners = new Map<string, Array<(event: any) => void>>()
      const api = {
        event: { on(name: string, listener: (event: any) => void) { const group = listeners.get(name) ?? []; group.push(listener); listeners.set(name, group); return () => {} } },
        renderer: { requestRender() {} }, lifecycle: { signal: new AbortController().signal },
        state: { path: { directory: "C:/workspace" }, session: { get() {}, messages() { return [] } }, part() { return [] } },
        client: { session: { async children() { return { data: [] } } } },
      } as any
      const tracker = createExecutionTracker(api)
      const emit = (name: string, properties: unknown) => { for (const listener of listeners.get(name) ?? []) listener({ properties }) }
      const part = (id: string, callID: string, startedAt: number) => ({ id, callID, sessionID: "parent", messageID: `message-${id}`, type: "tool", tool: "task", state: { status: "running", input: { description: "Task", subagent_type: "worker" }, time: { start: startedAt } } })

      emit("session.next.tool.called", { callID: "call-a", sessionID: "parent", tool: "task", input: { description: "Task", subagent_type: "worker" }, timestamp: 1 })
      emit("session.next.tool.called", { callID: "call-b", sessionID: "parent", tool: "task", input: { description: "Task", subagent_type: "worker" }, timestamp: 2 })
      emit("message.part.updated", { part: part("part-a", "call-a", 6_000), time: 6_000 })
      emit("message.part.updated", { part: part("part-b", "call-b", 5_000), time: 5_000 })
      emit("session.created", { info: { id: "ses_child_a", parentID: "parent", title: "Task (@worker)", agent: "worker", time: { created: 6_000 } } })
      emit("session.created", { info: { id: "ses_child_b", parentID: "parent", title: "Task (@worker)", agent: "worker", time: { created: 5_000 } } })
      emit("session.next.tool.failed", { callID: "call-a", timestamp: 7_000 })
      emit("session.next.tool.success", { callID: "call-b", timestamp: 8_000 })

      const rows = tracker.rows("parent")
      assert.equal(rows.length, 2)
      assert.equal(rows.find((row) => row.sessionID === "ses_child_a")?.status, "error")
      assert.equal(rows.find((row) => row.sessionID === "ses_child_b")?.status, "done")
      tracker.dispose()
      dispose()
    })
  })
})

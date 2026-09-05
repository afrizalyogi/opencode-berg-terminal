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
})

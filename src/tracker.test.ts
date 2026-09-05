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

      const tracker = createExecutionTracker(api)
      const emit = (name: string, properties: unknown) => {
        for (const listener of listeners.get(name) ?? []) listener({ properties })
      }

      assert.deepEqual(tracker.counts("parent"), { running: 0, done: 0, error: 0, total: 0 })
      emit("session.created", { info: { id: "ses_child", parentID: "parent", title: "Child", agent: "test", time: { created: 1 } } })
      statuses.set("ses_child", { type: "busy" })
      emit("session.status", { sessionID: "ses_child", status: { type: "busy" } })

      assert.equal(tracker.rows("parent").length, 1)
      assert.deepEqual(tracker.counts("parent"), { running: 1, done: 0, error: 0, total: 1 })

      emit("session.error", { sessionID: "ses_child" })
      assert.deepEqual(tracker.counts("parent"), { running: 0, done: 0, error: 1, total: 1 })

      tracker.dispose()
      dispose()
    })
  })
})

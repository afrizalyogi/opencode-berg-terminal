import assert from "node:assert/strict"
import { test } from "node:test"
import { configuredAgents } from "./data.ts"

test("shows runtime subagents and updates their running state", () => {
  let status: "running" | "done" = "running"
  const tracker = {
    rows: () => [{ id: "ses_child", parentID: "parent", title: "Task", agent: "explore", startedAt: 1, status, model: "Default", input: 0, output: 0 }],
  } as any
  const api = { state: { config: { agent: { build: { mode: "primary" } } } } } as any

  assert.equal(configuredAgents(api, "parent", tracker).find((agent) => agent.name === "explore")?.running, true)
  status = "done"
  assert.equal(configuredAgents(api, "parent", tracker).find((agent) => agent.name === "explore")?.running, false)
})

import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { recommendNext, type DecisionContext, type RecommendationKind } from "./decision-support.ts"

const healthy: DecisionContext = { hasSession: true, permissions: 0, questions: 0, retrying: false, errors: 0, mcpConnected: 1, mcpTotal: 1, running: 0 }

describe("decision support", () => {
  test("uses a stable priority order", () => {
    const cases: Array<[Partial<DecisionContext>, RecommendationKind]> = [
      [{ hasSession: false }, "no-session"],
      [{ permissions: 2, questions: 2, errors: 2 }, "permission"],
      [{ questions: 1, errors: 1 }, "question"],
      [{ retrying: true, errors: 1 }, "retry"],
      [{ errors: 1 }, "error"],
      [{ mcpConnected: 0, mcpTotal: 2 }, "connection"],
      [{ running: 1 }, "running"],
      [{}, "healthy"],
    ]
    for (const [patch, kind] of cases) assert.equal(recommendNext({ ...healthy, ...patch }).kind, kind)
  })

  test("returns actionable deterministic copy", () => {
    assert.deepEqual(recommendNext(healthy), {
      kind: "healthy",
      title: "Ready for the next task",
      detail: "No action requires attention.",
      action: "Use the prompt to continue the session.",
    })
  })
})

#!/usr/bin/env node

import { performance } from "node:perf_hooks"
import { createExecutionTracker } from "../src/tracker.ts"

const sizes = [100, 1_000, 5_000]
const rounds = 7

function median(values) {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)]
}

function benchmark(size) {
  const measurements = []
  for (let round = 0; round < rounds; round++) {
    const listeners = new Map()
    let renders = 0
    let invalidations = 0
    const api = {
      event: {
        on(name, listener) {
          const group = listeners.get(name) ?? []
          group.push(listener)
          listeners.set(name, group)
          return () => listeners.set(name, group.filter((item) => item !== listener))
        },
      },
      renderer: { requestRender() { renders++ } },
      lifecycle: { signal: new AbortController().signal },
      state: {
        path: { directory: "benchmark" },
        session: { get() {}, messages() { return [] } },
        part() { return [] },
      },
      client: { session: { async children() { return { data: [] } } } },
    }
    const tracker = createExecutionTracker(api, {
      read() {},
      invalidate() { invalidations++ },
    })
    const emit = (part) => {
      for (const listener of listeners.get("message.part.updated") ?? []) {
        listener({ properties: { part, time: 1 } })
      }
    }
    const parts = Array.from({ length: size }, (_, index) => ({
      id: `part-${index}`,
      sessionID: "parent",
      messageID: `message-${index}`,
      type: "tool",
      tool: "task",
      state: {
        status: "running",
        input: { description: `task ${index}`, subagent_type: "worker" },
        time: { start: 1 },
      },
    }))

    let started = performance.now()
    for (const part of parts) emit(part)
    const insertMs = performance.now() - started

    renders = 0
    invalidations = 0
    started = performance.now()
    for (const part of parts) emit(part)
    const unchangedReplayMs = performance.now() - started
    measurements.push({ insertMs, unchangedReplayMs, renders, invalidations })
    tracker.dispose()
  }

  return {
    entries: size,
    insertMs: Number(median(measurements.map((item) => item.insertMs)).toFixed(2)),
    unchangedReplayMs: Number(median(measurements.map((item) => item.unchangedReplayMs)).toFixed(2)),
    replayRenders: Math.max(...measurements.map((item) => item.renders)),
    replayInvalidations: Math.max(...measurements.map((item) => item.invalidations)),
  }
}

const results = sizes.map(benchmark)
const report = {
  runtime: process.version,
  platform: `${process.platform}/${process.arch}`,
  rounds,
  safetyReconciliationsPerMinute: 4,
  results,
}

if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2))
else {
  console.log(`Berg tracker benchmark (${report.runtime}, ${report.platform}, median of ${rounds})`)
  console.table(results)
  console.log("Safety reconciliation: 4 passes/minute; realtime updates remain event-driven.")
}

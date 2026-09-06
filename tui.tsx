/** @jsxImportSource @opentui/solid */

import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createSignal, createMemo, createRoot } from "solid-js"
import { AgentMatrix, BergCommandCenter, CommandEntry, TerminalTabs, ExecutionBlotter, OpenBergLogo, QuotaPanel, SectionTitle, Telemetry, activeSessionID } from "./src/components"
import { columns } from "./src/format"
import { createExecutionTracker } from "./src/tracker"
import type { ChartCharset, ChartMode } from "./src/types"
import { diagnostic, diagnosticInstance } from "./src/diagnostic"

function param(params: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = params?.[key]
  return typeof value === "string" ? value : undefined
}

function sessionForNavigation(api: TuiPluginApi): string | undefined {
  const direct = activeSessionID(api)
  if (direct) return direct
  const route = api.route.current
  return param("params" in route ? route.params : undefined, "sessionID")
    ?? api.kv.get<string | undefined>("berg.last-session")
    ?? api.kv.get<string | undefined>("bloomberg.last-session")
}

const chartModes: ChartMode[] = ["tokens", "costs", "work-status"]

const tui: TuiPlugin = async (api) => {
  createRoot((disposeRoot) => {
    diagnostic("tui.initialized", { instance: diagnosticInstance })
    let renderQueued = false
    const requestRender = () => {
      if (renderQueued) return
      renderQueued = true
      queueMicrotask(() => {
        renderQueued = false
        if (!api.lifecycle.signal.aborted) api.renderer.requestRender()
      })
    }
    const [trackerRevision, setTrackerRevision] = createSignal(0)
    const tracker = createExecutionTracker(api, {
      read: () => { trackerRevision() },
      invalidate: () => setTrackerRevision((revision) => revision + 1),
      requestRender,
    })
    const [messageRevision, setMessageRevision] = createSignal(0)
    const [selectedIndex, setSelectedIndex] = createSignal(0)
    const storedMode = api.kv.get<ChartMode>("berg.chart-mode", "tokens")
    const storedCharset = api.kv.get<ChartCharset>("berg.chart-charset", "ascii")
    const [chartMode, setChartMode] = createSignal<ChartMode>(chartModes.includes(storedMode) ? storedMode : "tokens")
    const [chartCharset, setChartCharset] = createSignal<ChartCharset>(storedCharset === "unicode" ? "unicode" : "ascii")
    
    // Keep visible running durations live without rendering idle/home views.
    const [now, setNow] = createSignal(Date.now())
    const clockTimer = setInterval(() => {
      const route = api.route.current.name
      if (route !== "session" && route !== "berg-command-center") return
      if (!tracker.hasRunning(sessionForNavigation(api))) return
      setNow(Date.now())
      requestRender()
    }, 1_000)

    const selectedRows = () => tracker.rows(sessionForNavigation(api))
    const moveSelection = (delta: number) => {
      const count = selectedRows().length
      if (count === 0) return
      setSelectedIndex((current) => ((Math.min(current, count - 1) + delta + count) % count))
      requestRender()
    }
    const openSelection = () => {
      const rows = selectedRows()
      const row = rows[Math.min(selectedIndex(), Math.max(0, rows.length - 1))]
      if (row?.sessionID) api.route.navigate("session", { sessionID: row.sessionID })
    }
    const rememberSession = (sessionID: string | undefined) => {
      if (sessionID) api.kv.set("berg.last-session", sessionID)
    }
    const nextChart = () => {
      const next = chartModes[(chartModes.indexOf(chartMode()) + 1) % chartModes.length]
      setChartMode(next)
      api.kv.set("berg.chart-mode", next)
      requestRender()
    }
    const toggleCharset = () => {
      const next = chartCharset() === "ascii" ? "unicode" : "ascii"
      setChartCharset(next)
      api.kv.set("berg.chart-charset", next)
      requestRender()
    }

    const offRoutes = api.route.register([{
      name: "berg-command-center",
      render: ({ params }) => <BergCommandCenter api={api} tracker={tracker} now={now} sessionID={param(params, "sessionID")} selectedIndex={selectedIndex()} onSelect={setSelectedIndex} chartMode={chartMode()} chartCharset={chartCharset()} messageRevision={messageRevision()} />,
    }])

    const offKeys = api.keymap.registerLayer({
      priority: 80,
      commands: [
        {
          name: "berg.open",
          title: "Berg: Open command center",
          desc: "Open the Berg command center for the active session",
          category: "Berg Terminal",
          run() {
            const sessionID = sessionForNavigation(api)
            rememberSession(sessionID)
            api.route.navigate("berg-command-center", { sessionID })
          },
        },
        {
          name: "berg.session",
          title: "Berg: Return to session",
          desc: "Return from the command center to the last active session",
          category: "Berg Terminal",
          run() {
            const sessionID = sessionForNavigation(api)
            if (sessionID) api.route.navigate("session", { sessionID })
            else api.route.navigate("home")
          },
        },
        {
          name: "berg.next-execution",
          title: "Berg: Select next execution",
          category: "Berg Terminal",
          enabled: () => api.route.current.name === "berg-command-center",
          run() { moveSelection(1) },
        },
        {
          name: "berg.previous-execution",
          title: "Berg: Select previous execution",
          category: "Berg Terminal",
          enabled: () => api.route.current.name === "berg-command-center",
          run() { moveSelection(-1) },
        },
        {
          name: "berg.open-execution",
          title: "Berg: Open selected execution",
          category: "Berg Terminal",
          enabled: () => api.route.current.name === "berg-command-center",
          run() { openSelection() },
        },
        {
          name: "berg.next-chart",
          title: "Berg: Show next activity chart",
          category: "Berg Terminal",
          enabled: () => api.route.current.name === "berg-command-center",
          run: nextChart,
        },
        {
          name: "berg.toggle-chart-charset",
          title: "Berg: Toggle chart character set",
          category: "Berg Terminal",
          enabled: () => api.route.current.name === "berg-command-center",
          run: toggleCharset,
        },
      ],
      bindings: [
        { key: "f2", cmd: "berg.open" },
        { key: "f1", cmd: "berg.session" },
        { key: "alt+j", cmd: "berg.next-execution" },
        { key: "alt+k", cmd: "berg.previous-execution" },
        { key: "alt+enter", cmd: "berg.open-execution" },
        { key: "alt+c", cmd: "berg.next-chart" },
        { key: "alt+u", cmd: "berg.toggle-chart-charset" },
      ],
    })

    api.slots.register({
      order: 40,
      slots: {
        home_logo() {
          return (
            <box flexDirection="column">
              <OpenBergLogo api={api} />
            </box>
          )
        },
        home_bottom() {
          return null
        },
        home_footer() {
          return null
        },
        home_prompt(_ctx, props) {
          return <api.ui.Prompt workspaceID={props.workspace_id} ref={props.ref} showPlaceholder placeholders={{ normal: ["Describe a task or enter /command"], shell: ["Enter a shell command"] }} />
        },
        session_prompt(_ctx, props) {
          return <CommandEntry api={api} prompt={{ sessionID: props.session_id, visible: props.visible, disabled: props.disabled, onSubmit: props.on_submit, ref: props.ref,
            right: <api.ui.Slot name="session_prompt_right" session_id={props.session_id} /> }} />
        },
        sidebar_title(_ctx, props) {
          return (
            <box flexDirection="column" width="100%">
              <SectionTitle api={api} title="Session" right={() => api.state.session.status(props.session_id)?.type === "busy" ? "Working" : api.state.session.status(props.session_id)?.type === "retry" ? "Retrying" : "OK"} native />
              <text fg={api.theme.current.text}>{props.title}</text>
              <text fg={api.theme.current.textMuted}>{props.session_id}</text>
            </box>
          )
        },
        sidebar_content(_ctx, props) {
          return (
            <box flexDirection="column" width="100%" border={["right"]} borderColor={api.theme.current.borderSubtle}>
              <AgentMatrix api={api} tracker={tracker} sessionID={props.session_id} limit={20} nativeSidebar />
              <ExecutionBlotter api={api} tracker={tracker} now={now} sessionID={props.session_id} limit={20} nativeSidebar />
              <QuotaPanel api={api} />
            </box>
          )
        },
        sidebar_footer(_ctx, props) {
          return null
        },
        home_prompt_right() {
          return <text fg={api.theme.current.primary}>OK</text>
        },
        session_prompt_right(_ctx, props) {
          const status = () => api.state.session.status(props.session_id)?.type ?? "idle"
          const color = () => status() === "retry" ? api.theme.current.error : status() === "busy" ? api.theme.current.warning : api.theme.current.success
          return <text fg={color()}>{() => status() === "busy" ? "WORK" : status() === "retry" ? "ERR" : "OK"}</text>
        },
        app_bottom() {
          return null
        },
      },
    })

    const renderEvents = ["message.updated", "session.status", "session.idle", "session.error"] as const
    const requestActiveRender = (kind: string) => {
      diagnostic("tui.render.requested", { event: kind })
      if (kind === "message.updated") setMessageRevision((revision) => revision + 1)
      requestRender()
    }
    const offEvents = renderEvents.map((name) => api.event.on(name, () => requestActiveRender(name)))
    const offSessionUpdated = api.event.on("session.updated", (event) => {
      if (!event.properties.info.parentID) rememberSession(event.properties.info.id)
    })

    api.lifecycle.onDispose(() => {
      clearInterval(clockTimer)
      disposeRoot()
      offRoutes()
      offKeys()
      tracker.dispose()
      offEvents.forEach((dispose) => dispose())
      offSessionUpdated()
    })
  })
}

export default { id: "berg-terminal", tui } satisfies TuiPluginModule

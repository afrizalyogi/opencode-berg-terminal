/** @jsxImportSource @opentui/solid */

import type { TuiPluginApi, TuiPromptProps } from "@opencode-ai/plugin/tui"
import { useTerminalDimensions } from "@opentui/solid"
import type { KeyEvent, MouseEvent } from "@opentui/core"
import { createEffect, createMemo, createSignal, onCleanup, onMount, For, Show } from "solid-js"
import { bar } from "./charts"
import { configuredAgents, sessionTelemetry } from "./data"
import { recommendNext } from "./decision-support"
import { columns, duration, layoutFor, metric, money, padLeft, padRight, statusLabel, threeColumnWidths, truncate, widePaneWidths } from "./format"
import { fetchQuotaSnapshot, type QuotaSnapshot } from "./quota-export"
import type { ExecutionTracker } from "./tracker"
import type { ChartCharset, ChartMode, ExecutionStatus, ExecutionRow, AgentRow } from "./types"
import { diagnostic } from "./diagnostic"

type Props = {
  api: TuiPluginApi
  tracker: ExecutionTracker
  now?: () => number
  sessionID?: string
  selectedIndex?: number
  onSelect?: (index: number) => void
  chartMode?: ChartMode
  chartCharset?: ChartCharset
  nativeSidebar?: boolean
}

function AgentRowRenderer(props: { api: TuiPluginApi; getAgent: () => AgentRow | undefined; index: number; width: number }) {
  const agent = () => props.getAgent()
  const state = () => agent()?.running ? "WORK" : "OK"
  const details = () => (agent()?.fallbackCount ?? 0) > 0 ? `${agent()?.model}+${agent()?.fallbackCount}` : agent()?.model
  const available = () => Math.max(0, Math.floor(props.width))
  const nameWidth = () => Math.floor(available() * 0.4) - 1

  return (
    <Show when={agent()}>
      <box backgroundColor={props.index % 2 === 0 ? props.api.theme.current.backgroundPanel : props.api.theme.current.backgroundElement} width="100%" flexDirection="row" justifyContent="space-between">
        <box width="40%" flexDirection="row" justifyContent="flex-start">
          <text fg={agent()!.running ? props.api.theme.current.warning : props.api.theme.current.text}>
            {() => truncate(agent()!.name, nameWidth())}
          </text>
        </box>
        <box width="40%" flexDirection="row" justifyContent="flex-start">
          <text fg={props.api.theme.current.textMuted}>
            {() => truncate(details(), nameWidth())}
          </text>
        </box>
        <box width="20%" flexDirection="row" justifyContent="flex-end">
          <text fg={agent()!.running ? props.api.theme.current.warning : props.api.theme.current.success}>
            {state}
          </text>
        </box>
      </box>
    </Show>
  )
}

function ExecutionRowRenderer(props: {
  api: TuiPluginApi
  getRow: () => ExecutionRow | undefined
  index: number
  actualIndex: number
  width: number
  safeSelected: number
  now: number
  onSelect?: (index: number) => void
}) {
  const row = () => props.getRow()
  return (
    <Show when={row()}>
      <box
        width="100%"
        flexDirection="row"
        justifyContent="space-between"
        backgroundColor={props.safeSelected === props.actualIndex ? props.api.theme.current.backgroundElement : (props.index % 2 === 0 ? props.api.theme.current.backgroundPanel : props.api.theme.current.backgroundElement)}
        onMouseDown={() => {
          props.onSelect?.(props.actualIndex)
          if (row()!.sessionID) props.api.route.navigate("session", { sessionID: row()!.sessionID })
        }}
      >
        <text fg={props.api.theme.current.text}>{() => truncate(row()!.title, props.width - 15)}</text>
        <box flexDirection="row">
          <text fg={props.api.theme.current.textMuted}>{() => `${duration(row()!.startedAt, row()!.endedAt, props.now)}  `}</text>
          <text fg={statusColor(props.api, row()!.status)}>{() => statusLabel(row()!.status)}</text>
        </box>
      </box>
    </Show>
  )
}

function currentSessionID(api: TuiPluginApi): string | undefined {
  const route = api.route.current
  if (route.name !== "session" || !route.params) return undefined
  const value = route.params.sessionID
  return typeof value === "string" ? value : undefined
}

function statusColor(api: TuiPluginApi, status: ExecutionStatus) {
  if (status === "error") return api.theme.current.error
  if (status === "done") return api.theme.current.success
  return api.theme.current.warning
}

export function SectionTitle(props: { api: TuiPluginApi; title: string; right?: string | (() => string); width?: number; native?: boolean; collapsed?: boolean; onToggle?: () => void }) {
  const width = () => props.width ?? 32
  const titleText = () => props.onToggle ? `${props.collapsed ? "+" : "v"} ${props.title}` : props.title
  const rightContent = () => typeof props.right === "function" ? props.right() : (props.right ?? "")
  const onMouseDown = (event: MouseEvent) => {
    if (!props.onToggle || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    props.onToggle()
  }
  const onKeyDown = (event: KeyEvent) => {
    if (!props.onToggle || event.eventType !== "press" || (event.name !== "return" && event.name !== "enter" && event.name !== "space")) return
    event.preventDefault()
    event.stopPropagation()
    props.onToggle()
  }

  if (props.native) return (
    <box width="100%" flexDirection="row" justifyContent="space-between" marginTop={1} backgroundColor={props.api.theme.current.primary} paddingLeft={1} paddingRight={1} focusable={Boolean(props.onToggle)} onMouseDown={onMouseDown} onKeyDown={onKeyDown}>
      <text selectable={false} fg={props.api.theme.current.background} attributes={1}>{titleText()}</text>
      <text selectable={false} fg={props.api.theme.current.background}>{rightContent()}</text>
    </box>
  )
  return (
    <box width="100%" flexDirection="row" justifyContent="space-between" backgroundColor={props.api.theme.current.primary} paddingLeft={1} paddingRight={1} focusable={Boolean(props.onToggle)} onMouseDown={onMouseDown} onKeyDown={onKeyDown}>
      <text selectable={false} fg={props.api.theme.current.background} attributes={1}>{titleText()}</text>
      <text selectable={false} fg={props.api.theme.current.background}>{rightContent()}</text>
    </box>
  )
}

export function OpenBergLogo(props: { api: TuiPluginApi }) {
  return (
    <box flexDirection="column" alignItems="center" width="100%">
      <ascii_font text="OPENBERG" font="tiny" color={[props.api.theme.current.primary, props.api.theme.current.info]} backgroundColor={props.api.theme.current.background} selectable={false} />
      <text fg={props.api.theme.current.textMuted}>OpenCode command terminal</text>
    </box>
  )
}

export function TerminalTabs(props: { api: TuiPluginApi }) {
  return <box flexDirection="row" width="100%" gap={1} border={["bottom"]} borderColor={props.api.theme.current.primary}>
    {([ ["F1  Chat", "berg.session", false], ["F2  Command center", "berg.open", true] ] as const).map(([label, command, monitor]) =>
      <box paddingLeft={1} paddingRight={1}
        backgroundColor={(props.api.route.current.name === "berg-command-center") === monitor ? props.api.theme.current.primary : props.api.theme.current.background}
        onMouseDown={() => { props.api.keymap.dispatchCommand(command) }}>
        <text fg={(props.api.route.current.name === "berg-command-center") === monitor ? props.api.theme.current.background : props.api.theme.current.textMuted}>{label}</text>
      </box>)}
  </box>
}

export function CommandEntry(props: { api: TuiPluginApi; prompt: TuiPromptProps }) {
  const Prompt = props.api.ui.Prompt

  return (
    <box width="100%" flexDirection="column" backgroundColor={props.api.theme.current.backgroundPanel} paddingLeft={1} border={["top", "bottom"]} borderColor={props.api.theme.current.borderSubtle}>
      <Prompt {...props.prompt} showPlaceholder placeholders={{ normal: ["Describe a task or enter /command"], shell: ["Enter a shell command"] }} />
    </box>
  )
}

export function AgentMatrix(props: Props & { width?: number; limit?: number }) {
  const rows = () => {
    props.tracker.counts(props.sessionID) // establish reactive dependency on tracker
    return configuredAgents(props.api, props.sessionID, props.tracker)
  }
  const width = () => props.width ?? 31
  const [collapsed, setCollapsed] = createSignal(false)
  createEffect(() => {
    const executions = props.tracker.rows(props.sessionID)
    diagnostic("ui.agents.subscription", { parentID: props.sessionID, rows: executions.map((row) => ({ id: row.id, status: row.status, agent: row.agent })) })
  })
  return (
    <box flexDirection="column" width="100%">
      <SectionTitle api={props.api} title="Agents" right={() => `${rows().length}`} width={width()} native={props.nativeSidebar} collapsed={collapsed()} onToggle={() => setCollapsed(!collapsed())} />
      {!collapsed() && (
        <>
          {!props.nativeSidebar && (() => {
            return <box width="100%" flexDirection="row" justifyContent="space-between">
              <box width="40%" flexDirection="row" justifyContent="flex-start"><text fg={props.api.theme.current.textMuted}>Agent</text></box>
              <box width="40%" flexDirection="row" justifyContent="flex-start"><text fg={props.api.theme.current.textMuted}>Model</text></box>
              <box width="20%" flexDirection="row" justifyContent="flex-end"><text fg={props.api.theme.current.textMuted}>Status</text></box>
            </box>
          })()}
          <For each={rows().slice(0, props.limit ?? 20).map(r => r.name)}>
            {(name, index) => <AgentRowRenderer api={props.api} getAgent={() => rows().find(r => r.name === name)} index={index()} width={width()} />}
          </For>
          {rows().length === 0 && <text fg={props.api.theme.current.textMuted}>No configured agents</text>}
        </>
      )}
      <box height={1} />
    </box>
  )
}

export function ExecutionBlotter(props: Props & { width?: number; limit?: number }) {
  const width = () => props.width ?? 31
  const rows = () => props.tracker.rows(props.sessionID)
  const counts = () => props.tracker.counts(props.sessionID)
  const limit = () => props.limit ?? 7
  const safeSelected = () => Math.min(Math.max(0, props.selectedIndex ?? 0), Math.max(0, rows().length - 1))
  const windowStart = () => Math.min(
    Math.max(0, safeSelected() - limit() + 1),
    Math.max(0, rows().length - limit()),
  )
  const visibleRows = () => rows().slice(windowStart(), windowStart() + limit())
  const [collapsed, setCollapsed] = createSignal(false)

  createEffect(() => {
    const executions = props.tracker.rows(props.sessionID)
    diagnostic("ui.executions.subscription", { parentID: props.sessionID, rows: executions.map((row) => ({ id: row.id, status: row.status, agent: row.agent })) })
  })
  
  createEffect(() => {
    if (props.sessionID) void props.tracker.hydrate(props.sessionID)
  })

  onMount(() => {
    if (props.sessionID) void props.tracker.reconcile(props.sessionID)
    const timer = setInterval(() => {
      if (props.sessionID) void props.tracker.reconcile(props.sessionID)
    }, 1_000)
    onCleanup(() => clearInterval(timer))
  })
  
  return (
    <box flexDirection="column" width="100%">
      <SectionTitle api={props.api} title="Executions" right={() => props.nativeSidebar ? `${counts().running}/${counts().total}` : `${counts().running} work, ${counts().error} err`} width={width()} native={props.nativeSidebar} collapsed={collapsed()} onToggle={() => setCollapsed(!collapsed())}/>
      {!collapsed() && (
        <>
          <For each={visibleRows().map(r => r.id)}>
            {(id, index) => (
              <ExecutionRowRenderer
                api={props.api}
                getRow={() => visibleRows().find(r => r.id === id)}
                index={index()}
                actualIndex={windowStart() + index()}
                width={width()}
                safeSelected={safeSelected()}
                now={props.now?.() ?? Date.now()}
                onSelect={props.onSelect}
              />
            )}
          </For>
          {rows().length === 0 && <text fg={props.api.theme.current.textMuted}>No executions</text>}
        </>
      )}
      <box height={1} />
    </box>
  )
}

export function Telemetry(props: Props & { width?: number; compact?: boolean }) {
  const width = () => props.width ?? 31
  const [tick, setTick] = createSignal(0)
  onMount(() => {
    const off = props.api.event.on("message.updated", () => setTick(t => t + 1))
    onCleanup(() => off())
  })
  const data = () => props.sessionID ? sessionTelemetry(props.api, props.sessionID, tick()) : undefined
  return (
    <box flexDirection="column" width="100%">
      <SectionTitle api={props.api} title="Usage" width={width()} native={props.nativeSidebar} />
      {!data() && <text fg={props.api.theme.current.textMuted}>No active session</text>}
      {data() && props.compact && (
        <box flexDirection="column" width="100%">
          <text>Input {metric(data()!.input)} &nbsp; Output {metric(data()!.output)} &nbsp; Cost {money(data()!.hasEstimatedCost ? data()!.cost : undefined)}</text>
        </box>
      )}
      {data() && !props.compact && (
        <>
          <text>{columns("Input", metric(data()!.input), width())}</text>
          <text>{columns("Output", metric(data()!.output), width())}</text>
          <text>{columns("Cache read", metric(data()!.cacheRead), width())}</text>
          <text>{columns("Reasoning", metric(data()!.reasoning), width())}</text>
          <text>{columns("Responses", data()!.responses, width())}</text>
          <text fg={props.api.theme.current.accent}>{columns("OpenCode cost", money(data()!.hasEstimatedCost ? data()!.cost : undefined), width())}</text>
        </>
      )}
    </box>
  )
}

export function QuotaPanel(props: { api: TuiPluginApi; width?: number }) {
  const width = () => props.width ?? 31
  const [collapsed, setCollapsed] = createSignal(false)
  const [snapshot, setSnapshot] = createSignal<QuotaSnapshot>()
  const [collapsedAccounts, setCollapsedAccounts] = createSignal<Set<string>>(new Set())
  const [refreshing, setRefreshing] = createSignal(false)
  const refresh = async (notify = false) => {
    if (refreshing()) return
    setRefreshing(true)
    try {
      const next = await fetchQuotaSnapshot(true)
      setSnapshot(next)
      if (notify) {
        const stale = next.rows.some((row) => row.provider === "Google" || row.provider === "Anthropic"
          ? row.updatedAt !== undefined && Date.now() - row.updatedAt > 15 * 60_000
          : false)
        props.api.ui.toast(stale
          ? { variant: "warning", title: "Antigravity cache is stale", message: "Run opencode auth login → Google → Check quotas, then refresh again.", duration: 6000 }
          : { variant: "success", title: "Quota refreshed", message: "Live providers fetched and Antigravity cache reread.", duration: 3000 })
      }
    } finally {
      setRefreshing(false)
      props.api.renderer.requestRender()
    }
  }
  onMount(() => {
    let disposed = false
    const reload = async () => {
      const next = await fetchQuotaSnapshot(true)
      if (!disposed) setSnapshot(next)
    }
    void reload()
    const timer = setInterval(() => void reload(), 60_000)
    onCleanup(() => {
      disposed = true
      clearInterval(timer)
    })
  })
  const rows = () => snapshot()?.rows ?? []
  const groups = () => {
    const grouped = new Map<string, Map<string, QuotaSnapshot["rows"]>>()
    for (const row of rows()) {
      const service = row.service ?? row.provider
      const account = row.account ?? "Default"
      const serviceGroup = grouped.get(service) ?? new Map<string, QuotaSnapshot["rows"]>()
      serviceGroup.set(account, [...(serviceGroup.get(account) ?? []), row])
      grouped.set(service, serviceGroup)
    }
    return [...grouped.entries()].map(([service, accounts]) => ({
      service,
      accounts: [...accounts.entries()].map(([account, items]) => ({ account, items })),
    }))
  }
  const itemLabel = (row: QuotaSnapshot["rows"][number]) => {
    const prefix = `${row.provider} `
    const name = row.name.startsWith(prefix) ? row.name.slice(prefix.length) : row.name
    return name
  }
  const toggleAccount = (account: string) => setCollapsedAccounts((current) => {
    const next = new Set(current)
    if (next.has(account)) next.delete(account)
    else next.add(account)
    return next
  })
  const cacheAge = (items: QuotaSnapshot["rows"]) => {
    const updatedAt = Math.max(...items.map((item) => item.updatedAt ?? 0))
    if (updatedAt <= 0) return ""
    const minutes = Math.max(0, Math.floor((Date.now() - updatedAt) / 60_000))
    return minutes < 1 ? "cached now" : `cached ${minutes} min ago`
  }
  const toggleAccountKey = (event: KeyEvent, account: string) => {
    if (event.eventType !== "press" || (event.name !== "return" && event.name !== "enter" && event.name !== "space")) return
    event.preventDefault()
    event.stopPropagation()
    toggleAccount(account)
  }
  return <box flexDirection="column" width="100%">
    <SectionTitle api={props.api} title="Quota" right={() => snapshot() ? `${snapshot()!.providerCount}` : "..."} width={width()} native collapsed={collapsed()} onToggle={() => setCollapsed(!collapsed())} />
    {!collapsed() && (
      <>
        <box width="100%" paddingLeft={1} paddingRight={1} focusable onMouseDown={() => void refresh(true)} onKeyDown={(event) => {
          if (event.eventType !== "press" || (event.name !== "return" && event.name !== "enter" && event.name !== "space")) return
          event.preventDefault()
          event.stopPropagation()
          void refresh(true)
        }}>
          <text fg={refreshing() ? props.api.theme.current.textMuted : props.api.theme.current.accent}>{() => refreshing() ? "Refreshing..." : "[ Refresh quota ]"}</text>
        </box>
        <For each={groups()}>
          {(group, groupIndex) => (
            <box width="100%" flexDirection="column" marginTop={groupIndex() === 0 ? 0 : 1} paddingLeft={1} paddingRight={1}>
              <box width="100%" flexDirection="column" focusable onMouseDown={() => toggleAccount(group.service)} onKeyDown={(event) => toggleAccountKey(event, group.service)}>
                <text fg={props.api.theme.current.accent} attributes={1} wrapMode="word">{() => `${collapsedAccounts().has(group.service) ? "+" : "v"} ${group.service}`}</text>
                <Show when={cacheAge(group.accounts.flatMap(a => a.items))}>{(age) => <text fg={props.api.theme.current.textMuted} wrapMode="word">{age()}</text>}</Show>
              </box>
              <Show when={!collapsedAccounts().has(group.service)}>
                <For each={group.accounts}>
                  {(accountGroup, accountIndex) => (
                    <box width="100%" flexDirection="column" marginTop={accountGroup.account === "Default" ? 0 : 1}>
                      <Show when={accountGroup.account !== "Default"}>
                        <text fg={props.api.theme.current.text} wrapMode="word" attributes={1}>{accountGroup.account}</text>
                      </Show>
                      <For each={accountGroup.items}>
                        {(row, rowIndex) => (
                          <box width="100%" flexDirection="column" marginTop={rowIndex() === 0 && accountGroup.account !== "Default" ? 0 : 1}>
                            <box width="100%" flexDirection="row" justifyContent="space-between">
                              <text fg={props.api.theme.current.text} wrapMode="word">{itemLabel(row)}</text>
                              <text fg={props.api.theme.current.textMuted}>{row.value}</text>
                            </box>
                            <Show when={row.percent !== undefined}>
                              <text fg={props.api.theme.current.textMuted}>{() => bar(row.percent!, 100, Math.max(1, width() - 2), "unicode")}</text>
                            </Show>
                          </box>
                        )}
                      </For>
                    </box>
                  )}
                </For>
              </Show>
            </box>
          )}
        </For>
        {!snapshot() && <text fg={props.api.theme.current.textMuted}>Loading quota...</text>}
        {snapshot() && rows().length === 0 && <text fg={props.api.theme.current.textMuted}>No quota data yet</text>}
      </>
    )}
    <box height={1} />
  </box>
}

function ConnectionsPanel(props: Props & { width: number }) {
  const lsp = () => props.api.state.lsp()
  const mcp = () => props.api.state.mcp()
  const mcpHealthy = () => mcp().filter((item) => item.status === "connected").length
  const attention = () => props.sessionID
    ? props.api.state.session.permission(props.sessionID).length + props.api.state.session.question(props.sessionID).length
    : 0
  const [collapsed, setCollapsed] = createSignal(false)
  return (
    <box flexDirection="column" width="100%">
      <SectionTitle api={props.api} title="Connections" width={props.width} collapsed={collapsed()} onToggle={() => setCollapsed(!collapsed())} />
      {!collapsed() && (
        <>
           <text>{columns(props.width >= 50 ? "Model Context Protocol" : "MCP servers", `${mcpHealthy()}/${mcp().length} connected`, props.width)}</text>
           <text>{columns(props.width >= 50 ? "Language Server Protocol" : "Language servers", lsp().length > 0 ? `${lsp().length} active` : "None", props.width)}</text>
          {mcp().slice(0, 4).map((item) => <text fg={item.status === "connected" ? props.api.theme.current.success : props.api.theme.current.warning}>{columns(item.name, item.status, props.width)}</text>)}
          {lsp().slice(0, 3).map((item) => <text fg={props.api.theme.current.textMuted}>{columns(item.id, item.status, props.width)}</text>)}
          <text fg={attention() > 0 ? props.api.theme.current.warning : props.api.theme.current.success}>
            {columns("Needs attention", attention(), props.width)}
          </text>
          <text>{columns("Branch", props.api.state.vcs?.branch ?? "Unavailable", props.width)}</text>
        </>
      )}
      <box height={1} />
    </box>
  )
}

function NextAction(props: Props & { width: number }) {
  const recommendation = () => {
    const status = props.sessionID ? props.api.state.session.status(props.sessionID)?.type : undefined
    const mcp = props.api.state.mcp()
    const counts = props.tracker.counts(props.sessionID)
    return recommendNext({
      hasSession: Boolean(props.sessionID),
      permissions: props.sessionID ? props.api.state.session.permission(props.sessionID).length : 0,
      questions: props.sessionID ? props.api.state.session.question(props.sessionID).length : 0,
      retrying: status === "retry",
      errors: counts.error,
      mcpConnected: mcp.filter((item) => item.status === "connected").length,
      mcpTotal: mcp.length,
      running: counts.running,
    })
  }
  const [collapsed, setCollapsed] = createSignal(false)
  return <box flexDirection="column" width="100%">
    <SectionTitle api={props.api} title="Next action" right={() => recommendation().kind === "healthy" ? "OK" : "Review"} width={props.width} collapsed={collapsed()} onToggle={() => setCollapsed(!collapsed())} />
    {!collapsed() && (
      <>
        <text fg={recommendation().kind === "healthy" ? props.api.theme.current.success : props.api.theme.current.warning} attributes={1}>{truncate(recommendation().title, props.width)}</text>
        <text fg={props.api.theme.current.textMuted}>{truncate(recommendation().detail, props.width)}</text>
        <text>{truncate(recommendation().action, props.width)}</text>
      </>
    )}
    <box height={1} />
  </box>
}

function ActivityChart(props: Props & { width: number }) {
  const [tick, setTick] = createSignal(0)
  onMount(() => {
    const off = props.api.event.on("message.updated", () => setTick((value) => value + 1))
    onCleanup(off)
  })
  const telemetry = () => props.sessionID ? sessionTelemetry(props.api, props.sessionID, tick()) : undefined
  const counts = () => props.tracker.counts(props.sessionID)
  const mode = () => props.chartMode ?? "tokens"
  const charset = () => props.chartCharset ?? "ascii"
  const detail = () => {
    if (mode() === "work-status") return `${counts().running} working  ${counts().done} OK  ${counts().error} errors`
    const data = telemetry()
    if (!data) return "No activity"
    if (mode() === "costs") return `OpenCode cost ${money(data.hasEstimatedCost ? data.cost : undefined)}`
    const total = data.input + data.output
    return `${metric(total)} tokens  ${bar(data.output, Math.max(1, total), 10, charset())}`
  }
  const [collapsed, setCollapsed] = createSignal(false)
  return <box flexDirection="column" width="100%">
    <SectionTitle api={props.api} title="Activity" right={mode} width={props.width} collapsed={collapsed()} onToggle={() => setCollapsed(!collapsed())} />
    {!collapsed() && (
      <>
        <text fg={props.api.theme.current.textMuted}>{truncate(detail(), props.width)}</text>
      </>
    )}
    <box height={1} />
  </box>
}

export function BergCommandCenter(props: Props) {
  const dimensions = useTerminalDimensions()
  const layout = () => layoutFor(dimensions().width, dimensions().height)
  const session = () => props.sessionID ? props.api.state.session.get(props.sessionID) : undefined
  const status = () => props.sessionID ? props.api.state.session.status(props.sessionID)?.type ?? "idle" : "idle"
  const rows = () => props.tracker.rows(props.sessionID)
  const innerWidth = () => Math.max(38, dimensions().width - 4)
  const paneWidths = () => widePaneWidths(innerWidth())

  return (
    <box flexDirection="column" width="100%" height="100%" padding={1} backgroundColor={props.api.theme.current.background}>
      {layout() === "minimal" ? (
        <text fg={props.api.theme.current.error}>Viewport too small. Minimum size is 40x12.</text>
      ) : (
        <>
          <TerminalTabs api={props.api} />
          <text fg={props.api.theme.current.primary} attributes={1}>
             {columns("Command center", `${status()}  ${props.api.state.vcs?.branch ?? "No branch"}`, innerWidth())}
          </text>
          <text fg={props.api.theme.current.textMuted}>
             {columns(truncate(session()?.title ?? "No active session", innerWidth() - 18), truncate(props.api.state.path.directory, 18), innerWidth())}
          </text>

          {layout() === "wide" ? (
            <box flexDirection="row" width="100%" gap={1} marginTop={1}>
               <box width={paneWidths()[0]} flexDirection="column"><NextAction {...props} width={paneWidths()[0]} /><AgentMatrix {...props} width={paneWidths()[0]} limit={100} /></box>
               <box width={paneWidths()[1]} flexDirection="column"><ActivityChart {...props} width={paneWidths()[1]} /><ExecutionBlotter {...props} width={paneWidths()[1]} limit={7} /></box>
               <box width={paneWidths()[2]} flexDirection="column"><Telemetry {...props} width={paneWidths()[2]} /><ConnectionsPanel {...props} width={paneWidths()[2]} /></box>
            </box>
          ) : layout() === "medium" ? (
            <box flexDirection="row" width="100%" gap={1} marginTop={1}>
               <box width="50%" flexDirection="column"><NextAction {...props} width={Math.floor(innerWidth() / 2) - 1} /><AgentMatrix {...props} width={Math.floor(innerWidth() / 2) - 1} limit={100} /><Telemetry {...props} width={Math.floor(innerWidth() / 2) - 1} compact /></box>
               <box width="50%" flexDirection="column"><ActivityChart {...props} width={Math.floor(innerWidth() / 2) - 1} /><ExecutionBlotter {...props} width={Math.floor(innerWidth() / 2) - 1} limit={6} /><ConnectionsPanel {...props} width={Math.floor(innerWidth() / 2) - 1} /></box>
            </box>
          ) : (
            <box flexDirection="column" width="100%" marginTop={1}>
               <NextAction {...props} width={innerWidth()} />
               <AgentMatrix {...props} width={innerWidth()} limit={100} />
               <ActivityChart {...props} width={innerWidth()} />
               <Telemetry {...props} width={innerWidth()} compact />
               <ExecutionBlotter {...props} width={innerWidth()} limit={3} />
               <ConnectionsPanel {...props} width={innerWidth()} />
            </box>
          )}

          <box flexGrow={1} />
          {rows().length > 0 && (
            <text fg={props.api.theme.current.info}>
               {truncate(`Selected ${Math.min((props.selectedIndex ?? 0) + 1, rows().length)}/${rows().length}  ${rows()[Math.min(props.selectedIndex ?? 0, rows().length - 1)]?.title ?? ""}`, innerWidth())}
            </text>
          )}
          <CommandEntry api={props.api} prompt={{ sessionID: props.sessionID }} />
          <text fg={props.api.theme.current.textMuted}>
             <span style={{ fg: props.api.theme.current.primary }}>Alt+J/K</span> select  <span style={{ fg: props.api.theme.current.primary }}>Alt+Enter</span> open  <span style={{ fg: props.api.theme.current.primary }}>Alt+C</span> chart  <span style={{ fg: props.api.theme.current.primary }}>Alt+U</span> charset
          </text>
        </>
      )}
    </box>
  )
}

export function activeSessionID(api: TuiPluginApi): string | undefined {
  return currentSessionID(api)
}

# OpenCode Berg Terminal

An open-source **TUI plugin and theme for OpenCode**. Berg adds a responsive command center, realtime agent and delegated-execution tracking, usage telemetry, opt-in quota monitoring, and a high-contrast black/orange interface.

> Press `F2` for the command center and `F1` to return to chat.

![Berg Terminal command center](assets/command-center.jpeg)

## What changes?

| Area | Standard OpenCode | OpenCode + Berg plugin and theme |
|---|---|---|
| Chat workflow | Native OpenCode chat | Native chat remains available and keeps the same prompt behavior |
| Visual identity | Selected built-in theme | Black canvas, Berg orange headers, and semantic status colors |
| Delegated work | Child work appears in the normal conversation flow | Dedicated Agents and Executions panels with realtime `WORK`, `OK`, and error states |
| Operations view | No Berg dashboard | Responsive command center for activity, usage, connections, branch, and next action |
| Usage | Native context information | Session token, cache, reasoning, response, and OpenCode cost summary |
| Quota | Provider-specific behavior | Optional OpenAI, OpenRouter, and cached Antigravity overview after an explicit click |
| Terminal sizes | Native layout | Berg switches between wide, medium, narrow, and minimum-viewport layouts |
| Startup overhead | Lowest: no Berg code is loaded | Small local plugin initialization; **no quota file read or network request at startup** |

Berg does not replace OpenCode's model runtime, provider clients, permissions, or storage. Model/API latency is therefore unchanged.

## Screenshots

### New chat

![Berg Terminal new chat](assets/new-chat.jpeg)

### Realtime agent and execution tracking

![Berg Terminal processing a delegated task](assets/process-chat.jpeg)

### Command center

![Berg Terminal responsive command center](assets/command-center.jpeg)

## Performance

The optimization target is Berg's own overhead—not model response speed. Default OpenCode remains the lowest-overhead baseline because it does not load this extension.

Startup and steady-state work were reduced as follows:

| Berg workload | Before optimization | Optimized |
|---|---:|---:|
| Automatic quota network requests on panel mount | Up to 2 | **0**; quota is opt-in |
| Full-history safety reconciliation | 60 passes/minute | **4 passes/minute** |
| Render requests for an unchanged tracker replay | 0 | **0** |
| 1,000 unchanged task events | 79.94 ms | **3.12 ms** |
| 5,000 unchanged task events | 2,455.02 ms | **14.71 ms** |

![Tracker benchmark before and after optimization](assets/performance-benchmark.svg)

The event benchmark is synthetic and isolates the execution tracker. Baseline values were captured from revision `af7835e`; optimized values are the median of seven in-process runs on Node.js 26.7.0, Windows x64. Results vary by machine and do not represent total OpenCode startup, network, or model latency.

Reproduce the current tracker measurement:

```bash
npm run benchmark
```

Raw measurement data and methodology are stored in [`benchmarks/2026-09-06-windows-node26.json`](benchmarks/2026-09-06-windows-node26.json).

### What was optimized

- Unchanged tracker events are rejected before map cloning, invalidation, or rendering.
- Internal maps are updated in place and exposed only through projected rows.
- Related render requests are coalesced into one microtask.
- Agent, execution, telemetry, connection, and recommendation projections are memoized.
- Event handlers remain the realtime path; full-history reconciliation is only a 15-second recovery safety net.
- The one-second duration clock renders only while a visible session has running work.
- Quota access is disabled until requested, removing credential-file and provider work from startup.
- Diagnostics load filesystem support lazily and serialize writes only when explicitly enabled.

## Privacy and credentials

This repository contains **no API keys, OAuth tokens, refresh tokens, passwords, or user configuration**. `.env` files, logs, build output, and dependencies are ignored.

Quota behavior is intentionally explicit:

1. Berg does not read OpenCode auth or Antigravity account files during startup.
2. Selecting **Load live quota** reads the user's existing local OpenCode auth data in memory.
3. OpenAI credentials are sent only to `https://chatgpt.com/backend-api/wham/usage`.
4. OpenRouter credentials are sent only to `https://openrouter.ai/api/v1/key`.
5. Antigravity quota is read from its local cache; Berg does not refresh Google OAuth tokens.
6. Credentials are never copied into the repository, installer-written configuration, or UI. Displayed emails are masked.

Diagnostics are off by default. `BERG_TERMINAL_DIAGNOSTIC=1` enables a unique per-process temporary log; sensitive fields, error text, and common token formats are redacted.

## Requirements

- Node.js 22.18+ and npm 10+
- OpenCode with source TSX TUI plugin support
- A stable local checkout path when installing from source

The repository is a standalone source project and package-ready: it contains its entry point, theme, installer, tests, benchmark, and screenshots. It has no hardcoded developer path. A source checkout still needs `npm install` for the declared OpenCode/OpenTUI development and peer packages; this is intentionally documented rather than presented as a zero-dependency install.

## Install from source

```bash
git clone <your-repository-url>
cd opencode-berg-terminal
npm install
node scripts/install.mjs
node scripts/install.mjs --apply
```

The first installer command is a concise dry run. `--apply` updates the selected `tui.json`, preserves unrelated settings, creates a backup before replacement, and copies the theme. Fully quit and restart OpenCode afterward.

Useful options:

```bash
node scripts/install.mjs --verbose
node scripts/install.mjs --apply --no-theme
node scripts/install.mjs --apply --keep-current-theme
node scripts/install.mjs --apply --config-dir /absolute/config/path
```

Path precedence is `--config-dir`, `OPENCODE_TUI_CONFIG` for the exact TUI file, `OPENCODE_CONFIG_DIR`, `XDG_CONFIG_HOME`, then `~/.config/opencode`.

### npm package mode

The package metadata is ready for publication. After `opencode-berg-terminal` is published to npm, the installer can add the package name instead of a machine-specific source path:

```bash
npx opencode-berg-terminal --npm
npx opencode-berg-terminal --npm --apply
```

Do not use these npm commands before a release is published.

## Manual install

1. Run `npm install` in the cloned repository.
2. Copy `themes/berg-terminal.json` to `~/.config/opencode/themes/berg-terminal.json`.
3. Add the plugin and theme to `~/.config/opencode/tui.json`:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["/absolute/path/to/opencode-berg-terminal/tui.tsx"],
  "theme": "berg-terminal"
}
```

Use forward slashes in Windows JSON paths, for example `D:/projects/opencode-berg-terminal/tui.tsx`. Fully quit and restart OpenCode; plugins and configuration are not hot-reloaded.

## Features

- Realtime configured and runtime-discovered agent status.
- Delegated execution titles, elapsed durations, completion states, and child-session navigation.
- Deterministic next-action guidance for permissions, questions, retries, errors, connections, and running work.
- Responsive wide, medium, and narrow command-center layouts; below 40x12, a viewport warning is shown.
- In-memory activity and usage calculations without full-history filesystem or database scans.
- Opt-in, masked multi-account quota presentation.
- ASCII and Unicode activity bars.
- MIT-licensed theme using `#000000`, `#FB8B1E`, `#FF433D`, `#0068FF`, and `#4AF6C3`.

## Controls

- `F2`: open Command center.
- `F1`: return to the last session or home.
- `Alt+J` / `Alt+K`: select delegated work.
- `Alt+Enter`: open the selected child session.
- `Alt+C`: switch costs, tokens, and work-status charts.
- `Alt+U`: switch ASCII and Unicode chart characters.
- Commands are available under the `berg.*` namespace.

## Add agents

Berg reads agents from OpenCode and does not require a model in every entry. Add agents to `opencode.json`, `opencode.jsonc`, or agent files under `.opencode/agent/`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "default_agent": "build",
  "agent": {
    "build": {
      "description": "Coordinates implementation work.",
      "mode": "primary"
    },
    "reviewer": {
      "description": "Reviews focused implementation changes.",
      "mode": "subagent"
    }
  }
}
```

## Development

```bash
npm run typecheck
npm test
npm run benchmark
npm run doctor
npm pack --dry-run --json
```

- Tests cover formatting, charts, decision support, quota parsing, tracker behavior, and installer helpers.
- The doctor is read-only and verifies every runtime source file, required import, theme identity, and canvas color.
- Package contents include `index.tsx`, source, theme, assets, benchmarks, scripts, documentation, and license.
- No lifecycle install script is defined.

## License

MIT © 2026 Afrizal Yogi Pratama

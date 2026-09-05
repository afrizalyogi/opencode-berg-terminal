# OpenCode Berg Terminal

A responsive OpenCode TUI for monitoring agents, executions, usage, quota, and connections. Press `F2` to open the command center and `F1` to return to chat.

## Requirements

- Node.js 22.6+ and npm 10+
- OpenCode with source TSX TUI plugin support
- A stable absolute path for this project

## Automatic install

```bash
npm install
npm run install:check
npm run install:local -- --apply
```

The check command is a dry run. The apply command updates `~/.config/opencode/tui.json`, preserves unrelated settings, and creates a backup before replacing an existing file. Fully quit and restart OpenCode afterward.

Useful options:

```bash
npm run install:local -- --apply --no-theme
npm run install:local -- --apply --keep-current-theme
npm run install:local -- --apply --config-dir /absolute/config/path
```

## Manual install

1. Copy `themes/berg-terminal.json` to `~/.config/opencode/themes/berg-terminal.json`.
2. Add the plugin and theme to `~/.config/opencode/tui.json`:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["/absolute/path/to/opencode-berg-terminal/tui.tsx"],
  "theme": "berg-terminal"
}
```

3. Fully quit and restart OpenCode. OpenCode does not hot-reload plugin or configuration files.

Use forward slashes in Windows JSON paths, for example `D:/projects/opencode-berg-terminal/tui.tsx`.

## Add agents

Berg reads agents from OpenCode. It does not require a model in each agent entry; when omitted, OpenCode uses the applicable default.

Add a primary agent and subagent to `opencode.json` or `opencode.jsonc`:

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

For non-trivial instructions, use agent files instead:

```text
.opencode/agent/build.md
.opencode/agent/reviewer.md
```

Primary agent example:

```markdown
---
description: Coordinates implementation work.
mode: primary
---

Inspect the project, delegate focused work when useful, and verify the result.
```

Subagent example:

```markdown
---
description: Reviews focused implementation changes.
mode: subagent
---

Review the requested scope and return concrete findings.
```

## Controls

- `F2`: open Command center.
- `F1`: return to the last session or home.
- `Alt+J` / `Alt+K`: select delegated work.
- `Alt+Enter`: open the selected child session.
- `Alt+C`: switch costs, tokens, and work-status charts.
- `Alt+U`: switch ASCII and Unicode chart characters.
- Commands are available under the `berg.*` namespace.

## Features

- Deterministic next-action guidance prioritizes permission requests, questions, retries, errors, unavailable Model Context Protocol connections, working executions, and healthy state.
- Responsive wide, medium, and narrow layouts; below 40x12 a viewport warning is shown.
- Activity charts use host-loaded messages and the in-memory delegated-work index rather than full-history filesystem or database scans.
- Usage shows tokens and **OpenCode cost**. Missing and numeric-zero cost are shown as unavailable. Model pricing belongs in each user's OpenCode configuration and is intentionally outside this distributable plugin.
- The dark identity uses the requested `#000000` canvas and `#FB8B1E` orange, with `#FF433D`, `#0068FF`, and `#4AF6C3` as semantic accents. Neutral white and gray are retained only for readable text and separators.

## Development

- `npm run typecheck`: no-emit TypeScript check.
- `npm test`: Node test runner for formatting, charts, decision support, and installer helpers.
- `npm run doctor`: read-only asset and installation diagnostic.
- `npm pack --dry-run --json`: inspect package contents without creating a tarball.

The package remains private while runtime compatibility is validated. No lifecycle install script is defined. MIT licensed, copyright 2026 Afrizal Yogi Pratama.

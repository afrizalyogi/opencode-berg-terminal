# OpenCode Berg Terminal

A source-first OpenCode TUI plugin with a responsive `berg-command-center` route. It keeps OpenCode's native prompt and adds next-action guidance, usage, delegated work, activity charts, connections, and agents. It is not a replacement OpenCode binary or a full host UI override.

## Automatic Setup

Requires Node.js 22.6+, npm 10+, an OpenCode host compatible with `@opencode-ai/plugin` 1.15.4, and a host that loads source TSX TUI plugins.

1. Run `npm install` in this stable project folder.
2. Preview exact paths and changes with `npm run install:check`.
3. Apply with `npm run install:local -- --apply`.
4. Fully quit and restart OpenCode.
5. Install IBM Plex Mono yourself and select it in the terminal application that launches OpenCode. The plugin does not install or select fonts.

The installer is dry-run unless `--apply` is present. Options are `--config-dir <path>`, `--no-theme`, `--keep-current-theme`, and `--replace-legacy`. If an old plugin entry is detected, installation stops until you review it and explicitly add `--replace-legacy`; apply mode backs up `tui.json` before replacing that entry. It expects strict JSON in `tui.json`; JSONC is intentionally unsupported. Apply mode writes through a temporary file, refuses symlinks/nonfiles, and refuses a differing `berg-terminal.json` unless `--keep-current-theme` is used. It preserves unrelated TUI keys and plugin entries. It installs no dependencies and changes no font settings.

## Manual Setup

1. Place `themes/berg-terminal.json` at `~/.config/opencode/themes/berg-terminal.json`.
2. Merge the following into `~/.config/opencode/tui.json`, preserving unrelated values and existing plugins.
3. Restart OpenCode.

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["/absolute/path/to/opencode-berg-terminal/tui.tsx"],
  "theme": "berg-terminal"
}
```

The package, project folder, plugin, route, command, and theme identities are `opencode-berg-terminal`, `berg-terminal`, `berg-command-center`, `berg.*`, and `berg-terminal`.

## Migration

The plugin reads `bloomberg.last-session` only as a one-way fallback and writes `berg.last-session` on session events or commands. Chart preferences use `berg.chart-mode` and `berg.chart-charset`.

The installer never silently removes legacy plugin entries or `bloomberg-terminal.json`; it warns and leaves cleanup to the user. See [`delete-me/README.md`](delete-me/README.md) in the repository for the manual cleanup manifest. Legacy files are excluded from the distributable package.

## Controls

- `F2`: open Command center.
- `F1`: return to the last session or home.
- `Alt+J` / `Alt+K`: select delegated work.
- `Alt+Enter`: open the selected child session.
- `Alt+C`: switch costs, tokens, and work-status charts.
- `Alt+U`: switch ASCII and Unicode chart characters.
- Commands are available as `berg.open`, `berg.session`, `berg.next-execution`, `berg.previous-execution`, `berg.open-execution`, `berg.next-chart`, and `berg.toggle-chart-charset`.

## Features

- Deterministic next-action guidance prioritizes permission requests, questions, retries, errors, unavailable Model Context Protocol connections, working executions, and healthy state.
- Responsive wide, medium, and narrow layouts; below 40x12 a viewport warning is shown.
- Activity charts use host-loaded messages and the in-memory delegated-work index rather than full-history filesystem or database scans.
- Usage shows tokens and **OpenCode cost**. Missing and numeric-zero cost are shown as unavailable. Model pricing belongs in each user's OpenCode configuration and is intentionally outside this distributable plugin.
- The dark identity uses the requested `#000000` canvas and `#FB8B1E` orange, with `#FF433D`, `#0068FF`, and `#4AF6C3` as semantic accents. Neutral white and gray are retained only for readable text and separators.

## API Boundaries

The plugin uses public slots, a custom route, keymaps, reactive state, typed events, one child-session hydration request per parent, and the native Prompt component. It does not replace the native transcript, prompt internals, global host header, or individual native sidebar sections. Data is limited to what the host has loaded and exposed; delegated-work matching remains heuristic and the tracker is not a durable audit log.

## Development

- `npm run typecheck`: no-emit TypeScript check.
- `npm test`: Node test runner for formatting, charts, decision support, and installer helpers.
- `npm run doctor`: read-only asset and installation diagnostic.
- `npm pack --dry-run --json`: inspect package contents without creating a tarball.

The package remains private while runtime compatibility is validated. No lifecycle install script is defined. MIT licensed, copyright 2026 Afrizal Yogi Pratama.

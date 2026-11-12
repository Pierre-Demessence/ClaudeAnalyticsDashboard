# B47 Installable without cloning

## Goal

A friend with Node ≥ 22.18 installs the dashboard with one `npm install -g` and one
setup command, on Windows, macOS or Linux; it then collects in the background
whenever Claude Code is used. Windows users can add the taskbar widget by
downloading one exe, with no Rust and no Traefik.

## Acceptance criteria

- AC1 WHEN `npm install -g claude-analytics-dashboard` then
  `claude-analytics-dashboard` run on a machine with no clone, THE SYSTEM SHALL serve the
  dashboard at `http://localhost:4747` and open it. Check: `npm run pack:check`.
- AC2 The installed package has no runtime dependency to download (the dashboard and
  its libraries are prebuilt). Check: `npm pack --dry-run` lists only `dist/`, `lib/`,
  `package.json`, `README.md`, `LICENSE`, `CHANGELOG.md`; `dependencies` is empty.
- AC3 WHEN `claude-analytics-dashboard setup` runs, THE SYSTEM SHALL add a Stop hook that
  POSTs to `localhost:4747/api/hook` and, when that fails, starts the installed server in
  the background with no window. Check: unit tests on the hook text; manual on Windows.
- AC4 WHEN `claude-analytics-dashboard` runs while a server of the same version answers on
  the port, THE SYSTEM SHALL only open the browser; of another version, it SHALL stop it
  and start the installed one; WHEN something else holds the port, it SHALL exit with a
  message naming the port and `CCA_PORT`. Check: unit tests.
- AC5 WHEN a request's `Host` is not loopback (`localhost`, `*.localhost`, `127.0.0.1`,
  `[::1]`, with any port), THE SYSTEM SHALL answer 403 on every route; a static path
  escaping `dist/` SHALL answer 404. Check: unit tests.
- AC6 The repository's `npm run hook:install` keeps installing the curl-only hook to the
  Docker dashboard, with no fallback that runs code. Check: unit test.
- AC7 WHEN the widget runs and only the npm server is up, THE SYSTEM SHALL show its data
  and open `http://localhost:4747/` on click; with Traefik up, it keeps today's address.
  Check: `npm run widget:test` (fetch tests with a local listener).
- AC8 WHEN a `v*` tag is pushed, CI SHALL test, publish the npm package with provenance
  and create a GitHub Release with `cca-widget.exe` attached. Check: the first tag.
- AC9 The Docker dashboard runs the same server as the npm package, image without dev
  dependencies, unchanged URL, hook and widget. Check: `npm run docker:up`, manual.
- AC10 The app is named "Claude Analytics Dashboard" everywhere a user reads it (header,
  browser tab, README, widget menu, install folder, Windows startup entry); WHEN the
  widget is reinstalled, THE SYSTEM SHALL leave no startup entry or folder under the old
  name. Check: `git grep "Claude Code Analytics"` finds only CHANGELOG history and the Claude Design canvas title in AGENTS; manual
  reinstall.

## Design

- **Server** `src/server/serve.ts`: `node:http`; `/api` → `createApiMiddleware()`
  (path stripped like Connect's mount); everything else from `dist/` (resolved, must
  stay under it; `/` → `index.html`; content type by extension); Host allow-list (AC5)
  before any route, replacing Vite's `allowedHosts`; `collectWhileOpen` exported from
  `api.ts` and reused. Binds `127.0.0.1` by default; `--host` exists for Docker only.
  `GET /api/health` → `{ app, version }`; `POST /api/shutdown` behind the existing
  JSON + same-origin check (any local process could kill it anyway).
- **CLI** `src/server/cli.ts`, bin `claude-analytics-dashboard`: no command = start + open;
  `start [--background] [--no-open]`; `stop`; `setup` (hook + start + open);
  `install-hook [--apply]`. `--background` re-spawns itself detached, `windowsHide`,
  `stdio: 'ignore'`, and exits. Port: `CCA_PORT`, default 4747.
- **Hook**: `installHook(claudeDir, hook)`; two hooks, `DOCKER_HOOK` (today's) and
  `NPM_HOOK` = `curl -sf -m 120 -X POST … http://localhost:<port>/api/hook ||
  claude-analytics-dashboard start --background --no-open`. Claude Code runs hooks through a
  POSIX shell (Git Bash on Windows), so `||` and the npm `sh` shim work; verify on
  Windows. `withCollectorHook` replaces any earlier hook of ours (command calls
  `/api/hook` on a `localhost` or `*.localhost` URL, or contains `collector/cli.ts`; another
  tool's webhook to some `/api/hook` is kept). The fallback runs the globally installed release,
  never a working copy: the reason the Docker hook has no fallback does not apply.
- **Packaging**: `tsconfig.lib.json` emits `core`, `collector`, `server` (no tests) to
  `lib/` with `rewriteRelativeImportExtensions` (Node refuses type stripping under
  `node_modules`, checked). `react`, `react-dom`, `react-is`, `recharts`, `lucide-react`
  move to devDependencies (bundled into `dist/`). `package.json`: name and `bin` `claude-analytics-dashboard` (the app keeps its `brand.json` name),
  `files`, `repository`, `publishConfig.access: public`, `prepack` = build + emit.
  `scripts/pack-check.ts`: `npm pack`, install the tarball in a temp prefix, run it
  with temp `CCA_DATA_DIR` and `CLAUDE_CONFIG_DIR`, fetch `/` and `/api/summary`.
- **Widget**: two candidates, Traefik (`127.0.0.1:80`, Host `analytics.claudecode.localhost`)
  then npm (`127.0.0.1:4747`, Host `localhost:4747`); the one that answered is tried
  first next time; the click opens its URL. Both stay in `fetch.rs`/`window.rs`.
- **Release**: `.github/workflows/release.yml` on `v*`: Ubuntu job lint/test/build then
  `npm publish` through trusted publishing (`id-token: write`, npm ≥ 11.5.1, provenance
  automatic); Windows job `cargo build --release`, `gh release create` with the exe and
  the version's CHANGELOG section. The exe is unsigned: SmartScreen asks once.
- **Rename scope**: only what users read. Kept: the data dir `~/.claude-code-analytics`
  (users' history; moving it needs a migration for no visible gain), `CCA_*` variables,
  the `cca-theme` key, the widget's mutex and window class (old and new builds still
  exclude each other), the Docker network and `analytics.claudecode.localhost`.
- **Rejected**: Docker for friends (Traefik is not needed by the dashboard, but Docker
  Desktop is heavy and hook and widget would need the same address work); OS login
  autostart (per-OS, console-window issues on Windows; the hook covers it: the server
  is up whenever Claude Code is used); a standalone exe bundling Node (friends have Node).

## Checklist

- [x] B47.1 Production server and Host check (`serve.ts`, health, shutdown, tests).
  Visible after: nothing: not wired to anything yet. Needs you: nothing.
- [x] B47.2 CLI and hook variants (`server/cli.ts`, `hook.ts`, tests for AC3, AC4, AC6). `stop` and the
  replace-a-stale-server path wait until `/api/health` refuses connections before starting the new
  server (`/api/shutdown` closes the listener, not necessarily the process at once).
  Visible after: nothing: runs from the repo only. Needs you: nothing.
- [x] B47.3 Packaging (`tsconfig.lib.json`, `package.json`, `pack:check`, CI runs it).
  Visible after: `npm run pack:check` installs and serves the packed dashboard.
  Needs you: nothing.
- [ ] B47.4 Docker runs `lib/server/cli.js start --host 0.0.0.0 --port 4173 --no-open`;
  Dockerfile without dev deps or `--configLoader native`; AGENTS invariants updated.
  Visible after: your always-on dashboard runs the new server, same URL.
  Needs you: `npm run docker:up`, then check the dashboard, a hook run and the widget (at the end).
- [ ] B47.5 Widget finds either dashboard (AC7). Visible after: the widget works with the
  npm version. Needs you: nothing (covered by `widget:test`).
- [ ] B47.6 Release workflow (AC8). Visible after: nothing until a tag is pushed.
  Needs you: publish 0.5.0 once by hand (`npm publish`), set the package's trusted
  publisher on npmjs.com, push the tag (at the end).
- [ ] B47.8 Rename the app to "Claude Analytics Dashboard" (AC10): `brand.json`; `Header.tsx`
  reads the name from `brand.json` instead of hard-coding it; README, AGENTS and SECURITY
  titles; widget `Cargo.toml` description, window title, install folder
  `%LOCALAPPDATA%\Claude Analytics Dashboard Widget` and Run value name;
  `install.ps1` deletes the old Run value and the old install folder after a successful
  copy; CHANGELOG. The GitHub repository is already renamed to `ClaudeAnalyticsDashboard`:
  every `Pierre-Demessence/ClaudeCodeAnalytics` link becomes
  `Pierre-Demessence/ClaudeAnalyticsDashboard` (issue templates, pull request template,
  SECURITY, README clone path, CHANGELOG compare links), and `package.json`'s
  `repository` (B47.3) uses the new name. Golden images unchanged (no name in `widget.svg`).
  Visible after: the new name in the header, the browser tab and the widget's menu.
  Needs you: quit the widget, `npm run widget:install`, check it starts with Windows
  once (at the end).
- [ ] B47.7 Docs: README "Install" (setup, widget download, update, uninstall), clone
  path under Development; CHANGELOG; CONTRIBUTING setup; AGENTS commands/layout/
  invariants; decisions: replace "Server-side summary in a Vite plugin" and "Always-on
  dashboard" entries, add the npm hook fallback to the hook entry.
  Visible after: the README tells friends how to install. Needs you: nothing.

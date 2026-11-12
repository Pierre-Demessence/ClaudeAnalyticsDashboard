# AGENTS.md

Agent operating notes for **Claude Analytics Dashboard**: a local dashboard (Vite +
React + TypeScript strict) estimating Claude Code plan usage from local
transcripts and the plan-limit endpoint.

Before opening a pull request, read `CONTRIBUTING.md`: the docs a change must
update and what the description holds.

A few notes depend on a setup a contributor may not have: the Docker dashboard
behind Traefik (which the taskbar widget polls and the Claude Code hook calls),
and the Claude Design canvas (the maintainer's only). Each says so; skip it when
that setup isn't yours.

## Commands

- Dashboard: `npm run dashboard` (build + preview) or `npm run dev`
- Always-on dashboard: `npm run docker:up` (rebuild + restart the container
  at `http://analytics.claudecode.localhost`, behind Traefik). Needs a running
  Traefik joined to an external `claudecodeanalytics` network; skip it if you
  don't have one.
- Published image check: `npm run image:check` builds the image and runs it from
  `docker/compose.yaml` with an override (temp Claude and data dirs, a free loopback
  port); needs Docker running. CI and the release's `verify` job run it
- Taskbar widget: `npm run widget:dev` (debug build, redraws when
  `widget/widget.svg` is saved) / `npm run widget:install` (release build copied
  to `%LOCALAPPDATA%\Claude Analytics Dashboard Widget` and started) /
  `npm run widget:test` (`cargo test` + `clippy -D warnings`); needs Rust, from
  `mise.toml`
- Collector: `npm run collect` (`-- --force` ignores the endpoint throttle)
- Backtest: `npm run backtest` (`-- --weeks 8 --step-hours 6`) replays the
  forecasts on the data dir, read-only, and scores them against the final %
- Hook: `npm run hook:install` prints it; `-- --apply` edits `~/.claude/settings.json`
  (the Docker dashboard's hook; the npm package's is `claude-analytics-dashboard setup`)
- npm package CLI (`src/server/cli.ts`, bin `claude-analytics-dashboard`): `start`,
  `stop`, `setup`, `install-hook`; from the clone, `npm run build && npm run build:lib`
  then `node lib/server/cli.js start` (port 4747, or `CCA_PORT`)
- Build: `npm run build` (type-checks both tsconfigs, then `vite build`)
- Package: `npm run build:lib` emits `core`, `collector` and `server` to `lib/` (the
  published package's code, git-ignored); `npm run pack:check` packs, installs the
  tarball in a temp prefix and runs `setup`, a page fetch and `stop` against it
- Release: a pushed tag `vX.Y.Z` runs `.github/workflows/release.yml` (see Invariants).
  `scripts/release-check.ts` is its first step
- Lint: `npm run lint` / `npm run lint:fix`
- Test: `npm test` / `npm run test:watch` / `npm run test:coverage`

Run lint, test and build before considering work done.

## Layout

- `src/core/` — pure logic, no Node or DOM APIs: transcript parsing, events
  (rate-limit hits, overloads, compactions), output split by tool, context added per tool, pricing,
  aggregation, calibration, forecast, active pace, weekly share, week history,
  cache anomalies, plans, restarts (a weekly window split where its usage restarted), plan fit, value for money, multipliers, breakdown, `buildSummary`,
  history ranges (`range.ts` resolves the picker's choice, `ranged.ts` builds the history
  tabs' views over one; both go through `prepareSummary` like `buildSummary`).
- `src/collector/` — Node: transcript scan, usage endpoint client, data-dir
  store, lock, hook installer; entry `cli.ts`.
- `src/server/api.ts` — Vite plugin serving `/api/*` in dev and preview (`/api/range` is the
  history tabs' view of a range, from the stored data only), and running the throttled
  collector every minute while the server is up. `serve.ts` is the production server
  (static `dist/`, `/api`, Host check, health, shutdown), `control.ts` the CLI's
  helpers (port probe, background spawn, stop), `cli.ts` the package's entry.
- `src/dashboard/` — React app (`main.tsx` entry).
- `widget/` — the taskbar widget, one native Rust process (no webview): `widget.svg`
  is its look, `src/` the logic (`view` texts and flags, `template` fills the SVG,
  `render` draws it with resvg, `fetch`, `dock`, `window` with the click and menu
  handling, `theme`, `autostart`); `core/widget.ts` builds the API's answer.
- `docs/` — `backlog.md`, `decisions.md`, `roadmap.md`, `plans/` (see "Docs"); `screenshots/` holds the README's
  images: each tab in light and dark, anonymize mode on, 1280 px wide at 2× scale, cut
  below the last whole card.
- `Dockerfile` — the one image, for both setups. `docker-compose.yml` — the
  always-on dashboard behind Traefik, built from the working copy. `docker/compose.yaml`
  — the users' file: the image published on GHCR, one loopback port, no Traefik (not a
  root `compose.yaml`, which would win over `docker-compose.yml` for `docker:up`).
- `scripts/` — `pack-check.ts` (the packed package, run like a friend would),
  `image-check.ts` (the image, run from `docker/compose.yaml`) and
  `release-check.ts` (the release workflow's version and CHANGELOG check);
  `.github/workflows/` — `ci.yml` and `release.yml`.

## Conventions

- Two tsconfigs: `tsconfig.json` (DOM: `core` + `dashboard`) and
  `tsconfig.node.json` (Node: `core`, `collector`, `server`, configs), so
  browser code cannot import Node modules. Shared types live in `core/types.ts`.
- `core`, `collector` and `server` use relative imports with `.ts` extensions:
  Node runs the collector without a build step and does not resolve `@/`. The
  dashboard imports with `@/…`.
- Co-locate tests as `<name>.test.ts(x)`. Node-side tests start with
  `// @vitest-environment node`. Vitest globals are off, so Testing Library
  needs an explicit `afterEach(cleanup)`.
- 2-space indent, single quotes, semicolons (enforced by ESLint).
- ESLint (`@antfu/eslint-config`) sorts object and interface keys with `id` and
  `name` first, and imports as one flat list. A comment line starts a new sorting
  partition, so a doc comment on an interface key stays attached only if that key
  sorts first among the keys up to the next comment. Check comments after
  `lint:fix`. Tests must not depend on object key order.
- `import-x/no-unresolved` checks every import, including the `@/` alias.
- Console output and top-level `await` are only allowed in `cli.ts` files.
- Tabs are `#/<id>` hash links (`dashboard/tabs.ts`); a new tab is one entry
  in `TABS` plus its branch in `App.tsx`. Usage, Breakdown, Sessions and Weeks share a
  history range kept in the hash's query (`?range=<preset>[&back=<n>]` or
  `?from=YYYY-MM-DD&to=YYYY-MM-DD`; none = each view's default window). They read
  `HistoryView` (`dashboard/history.ts`), wrap their content in `RangeFrame`, and page
  long lists with `Pager`/`usePage`.
- Theme: `data-theme` on `<html>`. Dark variables exist twice in `styles.css`
  (OS media query and `[data-theme='dark']`): change both. The storage key
  `cca-theme` is also read by the inline script in `index.html`.
- Cards side by side go in `CardGrid`/`Cell` (`dashboard/CardGrid.tsx`, 12
  columns, spans 4/6/12), never a bespoke grid: a row is as tall as its tallest
  cell, so pair cards of similar height or the shorter one leaves a gap.
- Icons: Lucide (`lucide-react`), `aria-hidden` next to their text; never
  text symbols (✓ ! ▲ ⓘ) or emoji.
- Charts: never color alone. Each model family has a fixed color slot and an
  SVG pattern (`dashboard/models.ts`, `Patterns.tsx`).
- Tooltips: never the `title` attribute (slow to appear, absent on touch).
  Use `useTip()` (`dashboard/useTip.ts`; `TipProvider` in `Tip.tsx` owns the
  bubble), which works on hover, focus and tap, for chart value readouts and
  the full text of shortened names. Explain a metric only when its meaning
  isn't obvious, through visible helper text or an `InfoTip` icon; plain
  labels, headers and subtitles get no tooltip.
- Anonymize mode (header eye button) masks project names, paths, branches and
  conversation titles in one place, `anonymizeSummary` (`dashboard/anonymize.ts`),
  applied to the summary in `App.tsx`. A new field showing one of those must be
  added there (ranged data goes through `anonymizeRanged`, applied in `useHistoryView`),
  and views must read it from the summary or the history view, never from another source.
- Claude Design (maintainer only: the canvas is private): one canvas for the project,
  "Claude Code Analytics redesign" (<https://claude.ai/artifact/Fw9e29WbgMikfa9CK5WyfV>).
  A new design is a page in it (board files named by feature), never a new artifact.
  Contributors skip it and show UI changes with screenshots in the pull request.
- One version for the whole project: `package.json` (and `package-lock.json`) and
  `widget/Cargo.toml` (and `Cargo.lock`) match the latest release tag `vX.Y.Z`, and
  are bumped together in the commit that the next tag points to.

## Docs

- `README.md`: what users see and do. Its "Privacy" table lists everything the
  collector reads; a change reading a new file or field updates it.
- `CHANGELOG.md`: every change a user can notice (a feature, a fix, a different
  number or behavior), under Unreleased, in the commit that makes it, pull request
  or not. Not refactors, tests, CI, dev dependencies or docs. The release commit
  moves Unreleased under the new version.
- `docs/backlog.md`: everything not done (bugs, debt, ideas), one line each, with
  a `file:line` pointer where useful. Each item starts with a `B<n>` ID taken from
  the `Next ID:` line at the top (then incremented); IDs are never reused or
  renumbered, so deleting an item leaves a gap. Something found out of scope goes there at
  once instead of being fixed silently; an item is deleted in the commit that
  completes it.
- `docs/decisions.md`: only decisions where a reader of the code would ask "why
  this way and not X?" and the answer is not in the code, a comment or this file.
  The decision, why, and the alternatives someone would plausibly re-propose. A
  reversed decision replaces its entry.
- `docs/roadmap.md`: the order of the scheduled work; an item is deleted when done.
- `docs/plans/<feature>.md`: the plan of a large change (goal, acceptance criteria,
  design, checklist). Anything deferred goes to the backlog when it is deferred;
  the plan is deleted in the feature's final commit.
- Docs other than `CHANGELOG.md` describe the current state in the present tense:
  no "previously" or "now", no dates, version stamps or changelog lines, no frontmatter. Done items are
  deleted, not ticked or struck through (only an in-progress plan ticks its
  checklist). Items are referred to by ID (`B12`), name or tag (`[forensics]`),
  never by position.

## Invariants

- **The OAuth token** (`~/.claude/.credentials.json`) is read in memory only,
  sent only to `api.anthropic.com`, never logged, stored or refreshed. It is read
  only while `endpointEnabled` is on, which defaults to off: keep it opt-in, and
  keep the table in the README's "Privacy" section in sync with what the collector reads.
- The usage endpoint needs a `claude-code/<version>` User-Agent; keep the
  throttle (default 15 min) and never add a retry loop: it shares a tight rate
  limit with Claude Code's own `/usage`.
- The Claude Code hook (`collector/hook.ts`) has two variants and `withCollectorHook`
  replaces either by the other. The repository's (`npm run hook:install`) runs no code
  from this folder: it POSTs to the container's `/api/hook`, so only the image built
  by `docker:up` collects after each response. Never make it run the working copy (a
  `node …/cli.ts` command, or a fallback when the container is down): checking out a
  contributor's branch would run their code as the user, with the OAuth token in reach.
  Run `docker:up` only on reviewed code. The npm package's (`setup`) POSTs to
  `localhost:4747/api/hook` and, when that fails, runs the globally installed
  `claude-analytics-dashboard start --background`: that is a released copy, never a
  working copy, so the same rule is kept. A failed run is recorded as `lastError` in
  the status.
- A release is a tag `vX.Y.Z` on `main` (never pushed without the user asking).
  `release.yml` checks the tag against `package.json`, `package-lock.json`,
  `widget/Cargo.toml` and the CHANGELOG, runs lint, tests, build and `pack:check`,
  builds the widget, then *stages* the npm version through trusted publishing (no
  token; the publisher on npmjs.com allows `npm stage publish` only, so a maintainer
  approves the version with 2FA there), pushes the image
  `ghcr.io/pierre-demessence/claude-analytics-dashboard` (`X.Y.Z`, `X.Y`, `latest`;
  `linux/amd64` and `linux/arm64`) only after that staging, so a failed check publishes
  no image, and creates the GitHub Release with
  `cca-widget.exe` and the version's CHANGELOG section. The image goes live at once,
  without the 2FA wait. The package must keep an empty
  `dependencies`: the dashboard and its libraries are bundled into `dist/`.
- The data dir (`~/.claude-code-analytics/`, or `CCA_DATA_DIR`) holds the
  user's history: never wipe it. Tests and manual runs use a temp
  `CCA_DATA_DIR`. Stored messages hold token counts and session metadata
  (`sessionId`, `cwd`, `gitBranch`, …), tool names with call counts, the character
  count of their inputs, the size of each tool's results (characters and
  screenshots, never their content), the
  skill or slash command name and the subagent's id and type (the type from its
  `.meta.json`, never its description), never content or tool inputs themselves; conversation titles are
  kept per session in `sessions.json`; `events.jsonl` keeps rate-limit hits,
  overloads and compactions (times and limit types, never their text). `deleted-readings.jsonl` keeps the manual readings deleted from the
  dashboard: keep it. `backup-format-<n>/` holds the message
  files from before a scan-format re-read: keep it. `status.json` keeps
  `subscriptionStartedAt`, the one field the collector takes from `~/.claude.json`
  (`oauthAccount.subscriptionCreatedAt`): never the email or the ids.
- Bump `SCAN_FORMAT` (`collector/store.ts`) only when records gain fields that
  old messages need: the next run re-reads every transcript once. Make the bump
  the last edit, after the tests pass, since `npm run dev` and `npm run collect`
  run it on the real data. With the Docker setup, the hook's runs pick it up once
  the container is rebuilt (`docker:up`).
- The API is loopback-only: POST endpoints require `application/json` and a
  same-origin `Origin`, and `serve.ts` answers 403 to any `Host` that is not loopback
  (`localhost`, `*.localhost`, `127.0.0.1`, `[::1]`) before any route. Never bind beyond
  `127.0.0.1` outside Docker, and never loosen that check. The Docker container listens
  on `0.0.0.0`. In the Traefik setup (`docker-compose.yml`) it publishes no port: from
  the host, only Traefik (bound to `127.0.0.1:80`) reaches it, with the `*.localhost`
  Host. Its `claudecodeanalytics` network is shared with Traefik alone: another
  container on it could still reach the API with `Host: localhost`. Never publish a port
  or move it back to a shared network. The users' file (`docker/compose.yaml`) publishes
  only `127.0.0.1:4747` → 4173 on the project's own network, with the same Host check
  behind it: never publish on another address, and keep the hardening (`read_only`,
  `cap_drop: ALL`, `no-new-privileges`, `~/.claude` read-only), which `image:check` asserts.
- `GET /api/range` reads the stored data only: it never runs the collector or calls the
  endpoint, so any number of tabs can ask for ranges without touching the rate limit.
- The container runs the same `lib/server/cli.js` as the npm package, from an image that
  holds only `package.json`, `dist/` and `lib/` (no `node_modules`): `core`, `collector`
  and `server` have no runtime import outside Node (`api.ts` imports Vite's types only),
  so a runtime dependency there breaks the image.
- The container serves the image it was built from; it mounts `~/.claude`
  read-only and the data dir read-write.
- Keep the `@/*` alias in sync across `tsconfig.json`, `vite.config.ts` and
  `vitest.config.ts`.
- The app name comes from `brand.json`; never hard-code it in `index.html`.
- The taskbar widget never reads the OAuth token and calls nothing but
  `GET /api/widget` (`widget/src/fetch.rs`: plain HTTP/1.0 to loopback with the real
  `Host`, since Windows does not resolve `*.localhost`: first Traefik on port 80, then
  the npm server on port 4747; the one that answered last is tried first, and a click
  opens its URL). That route runs the collector like `/summary`, so the endpoint keeps
  its throttle however many widgets poll. The dashboards' addresses and URLs live in
  `widget/src/fetch.rs` alone.
  `resetsAtMs` is epoch milliseconds so Rust needs no date parser.
- `widget.svg` has `{{placeholders}}` filled by `template.rs`; its background rect is
  almost transparent on purpose (a fully transparent pixel lets the click through to
  the taskbar). Colors follow the taskbar's theme (`SystemUsesLightTheme`), not the
  apps' one. The golden images in `widget/tests/snapshots/` use Windows' Segoe UI;
  review a changed one by eye, then `UPDATE_SNAPSHOTS=1 cargo test` rewrites them.
- A second launch exits (named mutex): quit the installed widget first. The exe is
  locked while it runs, so `widget:install` refuses until it is quit.

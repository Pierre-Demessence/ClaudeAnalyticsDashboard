# Contributing

Thanks for helping. Bug reports, ideas and pull requests are all welcome; this
page says how to make a pull request easy to merge.

## Before you start

- **Small fixes** (a bug, a typo, a wrong number): open the pull request directly.
- **Anything bigger** (a new card, tab, setting or data field): open an issue
  first, or comment on an existing one, so we agree on the approach before you
  spend time on it.
- [`docs/backlog.md`](docs/backlog.md) lists known bugs and ideas, and
  [`docs/decisions.md`](docs/decisions.md) explains choices that may look odd
  (why the endpoint is opt-in, why the token is never refreshed, …). Read the
  relevant entry before proposing to change one of those.

## Setup

Requires Node ≥ 22.18. The taskbar widget also needs Windows, Rust
(`mise install`) and a running dashboard to poll (the Docker one behind Traefik, or
the npm package's on port 4747); its tests run without them.

```sh
npm install
npm run dev # dashboard with hot reload
```

**Keep your own history safe.** The collector writes to
`~/.claude-code-analytics/` by default. For manual tests, point it at a scratch
folder with `CCA_DATA_DIR`: `npm run dev` and `npm run collect` run your working
copy's collector on that folder. The Claude Code hook never runs your working
copy; it asks the Docker dashboard, which runs the version it was built from.

| Script | Description |
| --- | --- |
| `npm run dev` | Dashboard with hot reload. |
| `npm run dashboard` | Build and open the dashboard (`vite preview`). |
| `npm run collect` | Run the collector once (`-- --force` skips the endpoint throttle). |
| `npm run backtest` | Replay the forecasts on your data and score them. |
| `npm run hook:install` | Print the hook for the Docker dashboard (`-- --apply` adds it). |
| `npm run docker:up` | Build and (re)start the always-on Docker dashboard. |
| `npm run image:check` | Build the Docker image and run it from `docker/compose.yaml` on temp dirs. |
| `npm run widget:dev` | Run the taskbar widget from the source; redraws when `widget/widget.svg` is saved. |
| `npm run widget:install` | Build the taskbar widget and install it for the user. |
| `npm run widget:test` | Test and lint the widget (`cargo test`, `clippy`). |
| `npm run build` | Type-check, then build. |
| `npm run lint` | Lint with ESLint (`lint:fix` to auto-fix). |
| `npm test` | Run Vitest once (`test:watch`, `test:coverage`). |

**Always-on dashboard from a clone.** `npm run docker:up` builds the image from your
working copy and serves it at <http://analytics.claudecode.localhost>. It needs a
running Traefik joined to an external `claudecodeanalytics` network that no other
container joins. Run it again after updating, and only on code you trust: the
collector can read your login token. `npm run hook:install -- --apply` points
Claude Code's hook at it; without a hook, any running dashboard imports every minute.

**Widget from a clone.** `npm run widget:install` builds it (Rust from `mise install`,
plus the Visual Studio C++ build tools), copies it to
`%LOCALAPPDATA%\Claude Analytics Dashboard Widget` and starts it. Only one widget
runs at a time: quit the installed one before `widget:dev` or a new `widget:install`.

## Making a change

[`AGENTS.md`](AGENTS.md) holds the project's conventions: layout, imports,
tests, theming, tooltips, charts. It is written for AI agents but applies to
everyone. The rules that matter most in review:

- **Privacy.** Never store message content, tool inputs or anything from
  `~/.claude.json` beyond `subscriptionCreatedAt`. The OAuth token stays in
  memory and goes only to `api.anthropic.com`. If your change reads a new file
  or field, update the "Privacy" table in the README in the same pull request.
- **No new network calls**, and no retry loop on the usage endpoint: it shares a
  rate limit with Claude Code's own `/usage`.
- **Accessible charts.** Never carry meaning by color alone (pair it with a
  pattern, icon or text), check both light and dark themes, and use `useTip()`
  instead of the `title` attribute.
- **Anonymize mode.** A new field showing a project, path, branch or
  conversation title goes through `anonymizeSummary` (`anonymizeRanged` for the
  history tabs).
- **Tests.** Logic in `src/core/` gets unit tests next to it; a bug fix starts
  with a test that fails without the fix.

### Docs to update

| If your change… | Update |
| --- | --- |
| Changes what users see or do | `README.md`, if it describes it |
| Is noteworthy for users | `CHANGELOG.md`, under Unreleased: one line saying what users see, plus any action they must take |
| Reads a new file or field | The README's "Privacy" table |
| Completes a backlog item | Delete it from `docs/backlog.md` |
| Finds a bug or idea you won't fix now | Add one line to `docs/backlog.md`, with the next `B<n>` ID |
| Makes a choice someone would question | `docs/decisions.md` |
| Changes commands, layout or conventions | `AGENTS.md` |

Docs describe how things are now: no "previously", dates or changelog lines;
git keeps the history. The full rules are in the "Docs" section of `AGENTS.md`.

## Pull requests

1. Run the checks CI runs, and make sure they pass:

   ```sh
   npm run lint
   npm test
   npm run build
   ```

   If you touched `widget/`, also run `npm run widget:test` on Windows; CI runs
   it too. If you touched `src/server/`, `src/collector/hook.ts`, `package.json` or
   the build, also run `npm run pack:check`, which installs the packed package in a
   temp folder and runs it; CI runs it too.
2. Keep one topic per pull request. Commit messages follow
   [Conventional Commits](https://www.conventionalcommits.org/)
   (`fix(dashboard): …`, `feat(collector): …`).
3. Fill in the pull request template: a short summary of what changed and why,
   and a test plan (what you ran, what you checked by hand). For UI changes, add
   screenshots in light and dark, with anonymize mode on if they show your
   projects.

### Using an AI agent

Welcome, with the same bar as hand-written code: you have read and understood
the diff, and the checks pass. Most agents (Claude Code, Codex, Copilot,
Cursor, …) load `AGENTS.md` on their own; point yours at this file too before
it opens a pull request.

## Security

Found a way the tool could leak data or the token? Don't open a public issue:
see [`SECURITY.md`](SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE).

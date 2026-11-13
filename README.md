# Claude Analytics Dashboard

**Will I last the week? Am I on the right plan? Where do my tokens go?**

A local dashboard for your Claude Code subscription. It reads the transcripts
Claude Code already writes on your machine, forecasts your 5-hour and weekly
limits, and shows where the usage goes. Nothing leaves your machine.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/overview-dark.png">
  <img alt="Overview tab: weekly and 5-hour limits with their projection at reset, and the budget pacing chart for the week" src="docs/screenshots/overview-light.png">
</picture>

## Contents

- [Highlights](#highlights)
- [Install](#install): [Node](#node), [Docker](#docker), [Limit readings](#limit-readings)
- [Tour](#tour)
- [Taskbar widget (Windows)](#taskbar-widget-windows)
- [Privacy](#privacy)
- [Good to know](#good-to-know)
- [Contributing](#contributing)

## Highlights

- **Limit forecasts**\
  Your weekly and 5-hour %, where they'll land at reset, and the active work time left.
- **Budget pacing**\
  This week against an even pace, and the daily spend left.
- **Subscription vs API prices**\
  What your plan saved you this billing cycle.
- **Breakdowns**\
  By model, project, conversation, skill, subagent, tool and effort level.
- **History**\
  Past 5-hour sessions and weeks, the ones that hit the limit or got rate-limited.
- **Plan fit**\
  Whether Pro, Max or Ultra would have fit your last weeks.
- **Taskbar widget**\
  Both limits at a glance on Windows, always visible.
- **Costs no usage**\
  It never calls Claude, so it uses no tokens and doesn't count toward your limits.
- **Private by design**\
  Never stores message content; anonymize mode for screenshots.
- **Accessible**\
  Light and dark themes, colorblind-friendly charts (every series has a texture).

## Install

Pick Node or Docker, not both: each runs the same dashboard at <http://localhost:4747>.

### Node

Requires Node ≥ 22.18, on Windows, macOS or Linux.

```sh
npm install -g claude-analytics-dashboard
claude-analytics-dashboard setup
```

`setup` adds a hook to Claude Code that keeps the dashboard running whenever you
use Claude Code, and opens it at <http://localhost:4747>. The hook uses none of
your usage and adds nothing to your conversations.

- **Update:** `npm install -g claude-analytics-dashboard@latest`, then
  `claude-analytics-dashboard start --background --no-open`.
- **Uninstall:** delete the Stop hook that posts to `localhost:4747/api/hook` from
  `~/.claude/settings.json` (or it restarts the dashboard), then run
  `claude-analytics-dashboard stop` and `npm uninstall -g claude-analytics-dashboard`.
- **Other commands:** `claude-analytics-dashboard` alone runs it in the terminal
  (Ctrl+C stops it); `install-hook` prints the hook (`--apply` adds it).
  `CCA_PORT` changes the port.

Your history lives in `~/.claude-code-analytics/` (`CCA_DATA_DIR` changes it). It
survives updates and uninstalls, and keeps your messages after Claude Code deletes
its old transcripts.

### Docker

Needs only Docker (Docker Desktop on Windows and macOS), on x64 or ARM.

```sh
mkdir claude-analytics-dashboard && cd claude-analytics-dashboard
curl -fsSLO https://raw.githubusercontent.com/Pierre-Demessence/ClaudeAnalyticsDashboard/main/docker/compose.yaml
docker compose up -d
```

In PowerShell, type `curl.exe`. The dashboard answers at <http://localhost:4747>,
imports your transcripts every minute (no hook needed) and restarts with Docker.

- **Update:** `docker compose pull`, then `docker compose up -d`.
- **Uninstall:** `docker compose down`.
- **Linux:** create `~/.claude-code-analytics` before the first `up`. If your user
  id isn't 1000, add `user: "<uid>:<gid>"` under `dashboard` in the compose file.

### Limit readings

The forecasts need your current % of each limit, set in the Calibration tab:
type in what `/usage` shows from time to time, or turn on the usage endpoint
(opt-in; Claude Code's undocumented endpoint, called with your login token, see
[Privacy](#privacy)), which reads the same numbers every 15 minutes. Everything
else works without readings.

## Tour

<table>
  <tr>
    <td width="50%">
      <b>Usage</b>: API-equivalent cost per day by model, Claude Code upgrades marked, when you work, cache efficiency.
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/usage-dark.png">
        <img alt="Usage tab" src="docs/screenshots/usage-light.png">
      </picture>
    </td>
    <td width="50%">
      <b>Breakdown</b>: where the usage goes, by project, skill, subagent, effort, tool and conversation.
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/breakdown-dark.png">
        <img alt="Breakdown tab" src="docs/screenshots/breakdown-light.png">
      </picture>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <b>Sessions</b>: your 5-hour windows on a timeline, with its peak and the rate limits hit.
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/sessions-dark.png">
        <img alt="Sessions tab" src="docs/screenshots/sessions-light.png">
      </picture>
    </td>
    <td width="50%">
      <b>Plans</b>: which plan would have fit your recent weeks, and what it would cost.
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/plans-dark.png">
        <img alt="Plans tab" src="docs/screenshots/plans-light.png">
      </picture>
    </td>
  </tr>
</table>

Also: **Weeks** (the last 12 weekly windows, day by day) and **Calibration**
(limit readings, settings and how well the forecasts fit them).

## Taskbar widget (Windows)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/widget-dark.png">
  <img alt="Taskbar widget: 5-hour usage at 26% resetting in 4h30m, weekly usage at 29% resetting in 5d03h" src="docs/screenshots/widget-light.png" width="300">
</picture>

Both limits next to the clock, with the time to reset. Click to open the
dashboard; right-click for "Start with Windows" and "Quit". It shows the data of
the running dashboard, npm or Docker.

Download `cca-widget.exe` from the
[latest release](https://github.com/Pierre-Demessence/ClaudeAnalyticsDashboard/releases/latest),
put it somewhere it can stay, and run it. Windows SmartScreen asks once, since the
exe is not signed: choose "More info", then "Run anyway". To update, quit it and
replace the exe.

## Privacy

Everything runs locally. The only network call is the usage endpoint, and only
once you turn it on.

| Path | What is used | When |
| --- | --- | --- |
| `~/.claude/projects/**/*.jsonl` | Token counts, model, session and subagent ids, working directory, branch, tool names and sizes, skill and slash command names, conversation titles, and the times of rate-limit hits, overloads and compactions. Never message content or tool inputs. | Every collector run |
| `~/.claude/projects/**/*.meta.json` | A subagent's type, never its description. | Every collector run |
| `~/.claude.json` (or `~/.claude/.claude.json`) | `subscriptionCreatedAt` only (the billing day, unless the plan history sets it), never the email or account ids. | Every collector run |
| `~/.claude/.credentials.json` | The OAuth access token, its expiry, the plan type and rate-limit tier. | Only with the usage endpoint on |
| `~/.claude/settings.json` | Read and edited, with a backup, to add the hook. | Only when you run `setup` or `install-hook --apply` |

The token is held in memory, sent only to
`https://api.anthropic.com/api/oauth/usage`, and never logged, stored or
refreshed. The whole client is [`src/collector/endpoint.ts`](src/collector/endpoint.ts).
The Docker setup listens on `127.0.0.1` only and mounts `~/.claude` read-only.

The eye button in the header masks project names, paths, branches and
conversation titles, for sharing screenshots like the ones above.

## Good to know

- Usage is priced at public API rates, as a common unit across models; plan
  limits are assumed to scale with those prices.
- Only this machine's transcripts count. claude.ai chat shares your limits: the
  usage endpoint tells it apart, otherwise it counts as Claude Code.
- Other plans' figures are estimates from Anthropic's advertised limits.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Built with Vite, React and TypeScript,
scaffolded with [create-corniflex](https://github.com/Pierre-Demessence/create-corniflex);
the widget is Rust.

## License

[MIT](LICENSE)

# Changelog

Noteworthy changes for users. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.5.2]

### Fixed

- The release page has the taskbar widget download again: publishing 0.5.1 failed
  before it created the page. Nothing else differs from 0.5.1.

## [0.5.1]

### Added

- Install with Docker alone, no Node needed: each release publishes an image on
  GitHub's container registry. See the
  [README](https://github.com/Pierre-Demessence/ClaudeAnalyticsDashboard#docker).

## [0.5.0]

### Added

- Install from npm: `npm install -g claude-analytics-dashboard`, then
  `claude-analytics-dashboard setup`. Works on Windows, macOS and Linux.
- The taskbar widget is a download: `cca-widget.exe` on the release page.

### Changed

- The app is renamed "Claude Analytics Dashboard". If you installed the widget
  from a clone, reinstall it and tick "Start with Windows" again.
- The 5-hour forecast lands closer to the final %.

## [0.4.0]

### Changed

- Anthropic's renamed plans: Max 5× is "Max" and Max 20× is "Ultra".
- Ultra is compared at 10× Pro instead of 20×, so its weeks look about twice as
  full on the Plans tab.
- Ultra accounts show no 5-hour limit, in the dashboard and the widget.
- The dashboard keeps collecting after a reboot, with no tab or widget open.

### Fixed

- "By skill or command" no longer lists `${name}` or `…`.

## [0.3.0]

### Added

- Forecasts keep working right after a plan change, before the new plan has
  readings of its own.
- The cache card counts subagents' cache flushes too.

### Changed

- The Plans tab recommends the smallest plan that holds your weeks, instead of
  calling it "too big".
- Conversations in a Claude Code worktree count under their repository, and
  those in temp folders under one "Temporary folders" project.

### Fixed

- The weekly forecast no longer underestimates heavy weeks.
- A week where your usage restarted (a plan change, a free reset) is no longer
  left out; the Weeks tab marks it.
- Past weeks and sessions show on the plan they ran on, so an upgrade no longer
  makes them look nearly empty.
- Forecasts and the plan comparison are more accurate after a plan change.
- Turning on the usage endpoint no longer resets the weekly forecast's typical
  pace.
- Sonnet 5.5 cache reads cost $0.10 per million tokens, not $0.20.
- Claude Haiku 5.5 is priced; it counted as $0.
- "All time" on the Subscription card no longer counts months before your
  oldest transcript.
- The plan comparison no longer counts the week of your oldest transcript as a
  light week.
- The weekly projection no longer leaves out up to half an hour of recent usage.
- "Active use left" is more accurate for rarely used models, and never longer
  than the time to the reset.
- The cache card's savings and flush costs are more accurate.
- The costliest messages spot pauses correctly when subagents are at work.
- A week no longer shows twice when its readings' reset times differ by a minute.
- A failed write no longer leaves a `.tmp` file in the data folder; old ones can
  be deleted.
- Prompts quoting a slash command no longer create skills like `${name}`.
- On a phone, the Weeks tab's median peak card no longer overflows.
- On the Sessions tab, the "now" line no longer crosses the current window's %.

## [0.2.0]

### Changed

- **The Claude Code hook needs the always-on Docker dashboard**, so checking out
  a branch can no longer run its code as you. **Run
  `npm run hook:install -- --apply` again**, and `npm run docker:up` after
  updating. Without Docker, opening the dashboard imports new transcripts.
- Settings are saved together, with Save and Discard; the limit thresholds move
  to an Advanced section.
- Turning on the usage endpoint asks for confirmation first.

### Added

- Edit when a plan period starts, from the plan history.
- Upgrades are billed as Anthropic invoices them; the Subscription card shows the
  credit for unused time.
- Billing starts at the first plan period when you set it by hand.

### Fixed

- Settings fields no longer lose focus while you type.
- Small fixes to the settings' Save bar and the plan period editor.

## [0.1.0]

First public version: limit forecasts, budget pacing, subscription vs API
prices, usage breakdowns, session and week history, plan fit, a Windows taskbar
widget and a Docker setup.

[Unreleased]: https://github.com/Pierre-Demessence/ClaudeAnalyticsDashboard/compare/v0.5.2...HEAD
[0.5.2]: https://github.com/Pierre-Demessence/ClaudeAnalyticsDashboard/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/Pierre-Demessence/ClaudeAnalyticsDashboard/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/Pierre-Demessence/ClaudeAnalyticsDashboard/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/Pierre-Demessence/ClaudeAnalyticsDashboard/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/Pierre-Demessence/ClaudeAnalyticsDashboard/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Pierre-Demessence/ClaudeAnalyticsDashboard/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Pierre-Demessence/ClaudeAnalyticsDashboard/releases/tag/v0.1.0

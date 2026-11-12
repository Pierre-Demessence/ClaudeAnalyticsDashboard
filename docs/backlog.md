# Backlog

Next ID: B50

Everything not done yet. One line per item; delete an item in the same commit
that completes it. Sections say what kind of work an item is; `docs/roadmap.md`
orders the ones that are scheduled.

## Features

New capabilities.

- B1 `[multi-account]` Support several Claude accounts (e.g. a second Pro used when the first is limited). Not needed yet; brainstormed for when it is. Today everything assumes one: one `.credentials.json` read in `collect.ts:73`, snapshots and records carry no account, so a second account's readings would interleave with the first and corrupt calibration and forecasts. Design: one account per config folder (`CLAUDE_CONFIG_DIR`, the documented way; log out/in in one folder mixes transcripts, which carry no account id). Key each folder by `organizationUuid` from its `.credentials.json` (field exists; that it differs between two accounts is unverified until a second account is logged in). Tag records and snapshots with it, with a one-time migration tagging existing data as account 1 (back up the data dir first; `SCAN_FORMAT` bump last). Dashboard: an account picker scoping readings, windows, forecast and the Sessions calendar. Pool calibration (and the 5-hour fit) across accounts of the same plan, never across plans; each point's cost must come from its own account's transcripts. Active pace is a property of the user and is probably pooled too. Open points: the second folder starts empty (global settings, plugins, skills, statusline must be copied or linked); the analytics hook must be installed in it and told which folder it runs for; the Docker container mounts only `~/.claude` and needs the second folder read-only; how the VS Code extension picks a config dir (how to set `CLAUDE_CONFIG_DIR` there) is unchecked and must be verified, since the extension is used daily.
- B2 `[forensics]` Project drill-down page: a project's sessions, weekly cost and cache health, reached from Breakdown's "By project".
- B3 claude.ai vs Claude Code split per week from `claudeCodeShare` (only feeds the fit today). Design board: `Split.dc.html`.

## Enhancements

Improvements to something that exists.

### Breakdown

- B4 `[forensics]` Skill or command per conversation: a column in "Most expensive conversations" or the skills a conversation ran. `UsageRecord.skill` already holds it.
- B5 Cost per git branch (`UsageRecord.gitBranch`); the Breakdown tab only shows each conversation's main branch.
- B6 `[forensics]` Carrying cost per tool ("where input goes"). Every API call is billed for the whole context, so a tool's input cost is an attribution, not a measurement: assume each result stays in the context for the rest of the conversation, so cost = tokens added × later turns × cache-read price, cut short by compaction. A dollar figure per tool, but a model, not an observation. The sizes per result are stored (`UsageRecord.context`, shown in "Where context grows"); the later turns and compactions are not tied to a result yet.
- B7 Calibrate `CHARS_PER_TOKEN` (`src/core/contextAdded.ts:4`): 4 is the older tokenizer's rule of thumb, and Anthropic documents about 30% more tokens for the same text from Claude Opus 4.7 on, so "Where context grows" likely reads a quarter low. Measure it on the data: a tool result's characters against the growth of the next main-thread prompt (input, cache reads and writes), per model if the two tokenizers differ.

### History ranges

- B8 Compare two periods side by side, or show deltas against the previous period.
- B9 Ranges on the Calibration tab (drift beyond 12 weeks) and on Model ratios.
- B10 Export a range (CSV).

### Forecast

- B11 `[forecast]` Carry the uncertainty of `k` into the weekly forecast band, so a weakly calibrated plan shows a wider band; check it once B26's weeks exist. On the 5-hour forecast it moved "final in range" only from 34% to 38% over 58 windows, so measure the gain before building it. Count distinct readings, not all of them: the endpoint repeats the same (%, cost) point while the PC idles, so about two thirds of the points are repeats and would overstate the evidence. The fit itself barely moves without them (`k` 2.2% higher on Pro, 0.2% on Max).
- B12 `[forecast]` Say which limit binds first (5-hour or weekly) and show a probability of hitting each, once the scheduled forecast exists.
- B13 `[forecast]` Show the current week's own ratio (`CurrentWeek.weekCalibration`) on the Fit card, which shows only the pooled one while the week's forecast, pacing and active time use the week's own.
- B14 `[forecast]` Check whether the usage endpoint's answer holds per-model weekly windows (`seven_day_opus`, `seven_day_sonnet`) that `src/collector/endpoint.ts:76` ignores: it reads only `seven_day` and its breakdown. A per-model limit would explain weeks of one plan disagreeing on the % per dollar. Max and Ultra also have a weekly Fable limit: Settings > Usage on a Max account shows it as a third bar, "Fable: Up to 50% of your weekly limit", with its own % used and the weekly reset time, so a cap inside the weekly limit, not an extra allowance. Its field in the answer is unknown.
- B17 `[forecast]` Active time per family (`activeByFamily`, `src/core/activeTime.ts:41`) gives each gap to the message that ends it, so subagent bursts (Explore on Haiku) take active time from the Opus main thread: the Opus-only pace reads high, the Haiku one low, and the model ratios inherit it. Measure the share of active time credited to subagent messages; if it is large, build the timeline from main-thread messages and give each subagent's cost to the main thread's family.

### Weeks

- B18 Show which plan the bar and % of a week from an earlier plan are on, without a label on every row: only the plan-change mark (on the week of the change) and the tooltips of its estimate and of the typical-week tick say so (`src/dashboard/Weeks.tsx`).

### Plans and what-if

- B19 The what-if only moves Opus work to Sonnet; other shifts (Sonnet to Haiku, a lower effort) would reuse the same linear `shift` per week and session.
- B20 An upper bound for capped weeks: fill the hidden time at the week's own pace before the cutoff, next to the typical-pace estimate (`src/core/planFit.ts`).
- B21 The current week's pace without the limit on the Overview, next to the forecast (which predicts the real, capped % at reset).
- B22 Capped 5-hour sessions' estimate without the limit on the Sessions tab, as the Weeks tab does for weeks. `FitSession` (`src/core/planFit.ts`) needs a `start` to join on.

### Taskbar widget

- B49 `[widget]` The widget looks for the npm server on port 4747 only (`widget/src/fetch.rs`, `NPM`); with `CCA_PORT` or `--port` set to another port it shows nothing and a click opens the wrong address. Let the widget read the port from a setting or the data dir.
- B23 `[widget]` The taskbar widget docks only into a bottom taskbar on the primary monitor (`widget/src/dock.rs:47-49`: `x` comes from the tray's left edge, the height from the whole taskbar). A side or top taskbar would clip it; fall back to a floating window near the tray, and dock into each monitor's secondary taskbar.

## Waiting for data

Blocked until more history exists, so the result can be judged. Sub-sections are
ordered by how many completed weeks of data the item needs; the week counts are
estimates of when the result becomes judgeable, not limits in the code.

### 4 weeks

- B24 `[forecast]` Backtest the week's own ratio (`weekCalibration`, `src/core/summary.ts:330`), used from the week's 3rd reading of 5% or more: a whole-percent reading at 5% is worth ±10%, and the endpoint takes 3 readings within half an hour. Compare it with the pooled ratio and with a blend that leans on the own ratio as the week's cost grows. Score each ratio on the next readings (the cost over the next hours × the ratio, against the real rise of the %), not on the final %: capped weeks end at 100% whatever the ratio, but their readings before the cap still count. The backtest has one method, so this needs a variant. The 4 Pro weeks are enough for Pro (their own ratios were 0.36, 0.41, 0.45 and 0.50 % per $, rising every week); Max needs about 3 weeks of its own.

### 6 weeks

- B25 Uncapped demand on real data: check how close the typical-pace estimate (`src/core/planFit.ts`) gets to what a capped week really needed. Pro weeks almost always reach the pressure point, so the answer key is Max weeks: cut each one where Pro's limit would have stopped it (90% of Pro, about 18% of Max), fill the rest with the estimate, and compare with the real % a day before the reset, leaving out the end-of-week push to 100% (see the pace model under "12 weeks"). Needs about 3 completed Max weeks.
- B26 `[forecast]` Check the weekly forecast band as the 5-hour one was checked, once about 3 weeks end below the limit: the 3 weeks scored so far all ended at the cap, which a forecast capped at 100% matches trivially. Score against the % a day before the reset, not the final: the end-of-week push to 100% is a choice made after reading the forecast, not something it predicts.
- B27 Forecast stage 3 (expected active hours from a weekday × hour profile) is paused: the backtest cannot tell whether it beats the flat pace on so little history. The profile needs 3 weeks to exist (`docs/plans/forecast-accuracy.md`) and the backtest needs about 3 more weeks to score it against the flat pace. Plan: `docs/plans/forecast-accuracy.md`.
- B28 Weekday-aware daily usage (weekends differ) for the forecast. Covered by stage 3 of `docs/plans/forecast-accuracy.md`.
- B29 `[forensics]` Calibration cross-check from observed limit hits: the median cost of limit-hit windows is a capacity estimate, floored by the highest cost of a window that did not hit the limit; compare with the demand estimates of limit-hit weeks. Server overloads are stored (`events.jsonl`) but not shown anywhere.
- B30 `[forensics]` Test the credit scheme cached in `~/.claude.json` (`tengu_amber_tally`: 5-hour credits 10000 / 50000 / 200000 for Pro / Max / Ultra, and credits per million tokens per model) against the readings: replay the usage under it with the backtest and compare its error with the API-price model. Unverified: units, which token types count, whether the flag is live. Opus 5.5 : Sonnet 5.5 : Haiku 4.5 is 1833 : 1250 : 833 there, against 4 : 2 : 1 by API output price.

- B31 `[forecast]` Fit the limit per token kind (output, cache read, cache write) instead of one `k` on the total API price; effort, model and subagents act on the limit through this mix. Seen on 2026-10-19: the first High-effort week (from 2026-10-14) used 40.7% of the weekly limit per $100 against 35.2 and 33.5 on Medium. 5-hour windows agree (median 325 vs 285 % per $100, 5 vs 19 windows). A least-squares fit on 25 windows gave cache writes about twice the weight of cache reads per API dollar, output in between. All High windows come after the Medium ones, so a limit change on 2026-10-14 cannot be ruled out; needs weeks that mix both efforts. These figures price Sonnet 5.5 cache reads at $0.20 per million tokens, twice the list price the price table holds: re-measure.

### 12 weeks

- B32 A model of how pace responds to the room left, to replace the fixed 90% pressure point. The user steers pace toward an even share of the room all week, by feel rather than by calculation: a heavy day is followed by slower days (and rest), a light one by faster days. Near the reset, room left is pushed to 100% on purpose (more projects in parallel, higher effort), mostly in the last day. So the pull runs both ways and all week, not only as a slow-down near the limit. Needs many weeks to tell this steering from a quiet week.
- B33 `[forecast]` A per-family weekly calibration (% per dollar by model family) instead of assuming limits scale with API price, once enough weeks with different mixes exist to tell model mix from a change in the limits. Two weeks of one plan measured 0.028 and 0.099 % per $; the current week's own fit covers it meanwhile. Both figures price Sonnet 5.5 cache reads at twice the list price: re-measure them before reading the gap as the model mix.
- B34 `[forecast]` Pace by effort level and fast mode (`UsageRecord.effort`, `speed`), once the per-model pace shows how much the model alone explains.

### Needs a second plan

- B35 Convert between plans with the measured multipliers (Plans tab, "How far to trust the conversions") when both plans have enough weeks, instead of the advertised ones; the same for the fit borrowed right after a plan change (`borrowedFit`, `src/core/summary.ts`).
- B36 Plan fit (`src/core/planFit.ts`) assumes a week's demand does not depend on the plan, but the user paces to the room the plan gives (see the pace model under "12 weeks"), so the demand estimated from capped Pro weeks likely understates what Max weeks use. Compare the two once about 3 Max weeks exist, using Max weeks' usage before the end-of-week push. Weeks pushed to 100% would otherwise read as needing all of the plan.

### No week count (waits for an event)

- B37 `[forensics]` Verify against a real transcript that a compaction writes `isCompactSummary` or a `compact_boundary` system entry (none in the local transcripts; `src/core/events.ts` assumes both), and the weekly `quotaLimits.rateLimitType` name (only `five_hour` seen; `hitScope` takes `seven_day`/`week`). Until then the no-gap flush leans on the rewritten-share rule.
- B38 Price the 4.5-generation models (Opus 4.5, Sonnet 4.5) and long-context premiums if they show up in transcripts; they are flagged as unknown today.
- B39 Treat a `seven_day.resets_at` of null (if the endpoint ever returns it) as "no usage yet" rather than `bad-shape`.
- B40 Check whether a downgrade restarts the weekly usage as the Pro to Max upgrade did on 2026-10-26 (100% to 0%, same reset time); only that upgrade has been seen.
- B41 Check how a free weekly reset shows in the readings: a drop with the same reset time, or a new reset time. A new one would start a 7-day window overlapping the old one, which nothing handles: the old window's estimated extension (`weeklyShares`, `src/core/share.ts`) would count the new window's cost.

## Technical debt

- B42 `GET /api/summary` has no Origin/Host check: it relies on Vite's default `allowedHosts` and localhost-only CORS. Add an explicit check before ever exposing the server beyond loopback.
- B43 `subscriptionStartedAt` (the billing day) is read from `~/.claude.json` only by host runs (`npm run dev`, `collect`, a host `npm run dashboard`): the container cannot see that file and the hook runs the collector there, so a Docker-only setup keeps the stored value or none (`collect.ts:73`). Mounting the file read-only would fix it, but Claude Code replaces it by rename, which a single-file bind mount may not follow, and it holds the email and account ids.
- B44 A collector killed mid-write (container stop, Ctrl+C) leaves its `*.tmp` file in the data dir for good: `writeAtomic` (`src/collector/store.ts`) removes it only when the write throws. Readers ignore it, but each is a whole month file (one of 3.6 MB seen). Sweep temp files older than an hour when the store opens.

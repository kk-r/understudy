# Understudy

**Demonstrate a routine once. The agent writes the tool. It does the other two hundred.**

A triage workspace built on WebMCP. Instead of shipping a fixed list of tools the
developer imagined, Understudy lets the user demonstrate a routine by hand — and
the agent turns that demonstration into a named, parameterised, reusable tool that
it registers into the live page at runtime.

Status: **work in progress.** See "Build sequence" below for what is done.

## Why this needs WebMCP

The demonstration is the human's actions inside a live application session. That
trace is client state that never reaches a server. The synthesised tool is then
registered into the same document the human is still working in — human and agent
sharing one workspace, which is the premise of the spec.

Every other WebMCP implementation treats `registerTool` as page setup. Here it is
the product: the tool surface stops being something the developer ships and becomes
something the user grows.

## Four design decisions

**D1 — Commands operate on sets, not on items.**
`SELECT_ITEMS {ids:[3,7,12]}` cannot generalise. `SET_FILTER {contains:"diffusion"}`
followed by `TAG_MATCHING {tag:"read-later"}` generalises for free, because the
filter value is obviously the parameter. Every action in the UI is expressed over
the current matching set. This is a product decision driven by the agent
requirement — and it is also just better bulk-triage UI.

**D2 — The agent never writes the steps. It only annotates which fields are parameters.**
`save_skill` takes a recording id plus bindings: `{paramName, stepIndex, fieldPath, type}`.
The page derives the JSON Schema. The steps come from the recording verbatim.

This is the most important decision in the project. A synthesised skill can never do
anything the human did not demonstrate, which is simultaneously the robustness story
(no hallucinated commands) and the safety story (bounded blast radius).

**D3 — Static dispatcher first; dynamic registration as an upgrade.**
Six fixed tools work in every client with zero unknowns. Per-skill `registerTool`
is layered on top, so the demo survives a client that does not honour mid-session
registration.

**D4a — Agent replay is staged; user actions are not.**
An agent rewriting a workspace a human is watching should not apply everything at once — the
human learns nothing from 250 rows changing simultaneously. Skill replay applies one step at a
time and announces each one; the human's own clicks go straight through `dispatch` and stay
instant. Pacing is capped at four seconds in total so a long skill never stalls a tool call.
There is no speed control in the interface: a dropdown beside a live agent run reads as
a setting you are meant to think about, and it isn't one.

**D4b — The controls echo the command.**
Replay dispatches to the bus, so without help the workspace changes while the controls sit
inert and the agent's work looks like magic. `src/echo.js` renders each step back through the
controls it corresponds to: fills the selects, types the value character by character, flashes
the button that would have been pressed. Strictly presentational — nothing there dispatches,
and assigning `.value` fires no events, so the real handlers never run.

Driving the actual DOM controls instead would recouple replay to the DOM, which is precisely
the brittleness the command bus exists to avoid. The command stays the source of truth; the UI
just shows its work.

**D4 — Replay returns ground truth.**
Every command returns how many items it actually affected, and a step that matches
nothing returns a structured reason rather than a silent success. The agent replans
instead of reporting a job well done.

## Live

**https://understudy-wine.vercel.app** — and the client probe at **https://understudy-wine.vercel.app/spike.html**

## Running it locally

No build step, no dependencies. Plain ES modules.

```
python3 -m http.server 8777
```

Then open <http://localhost:8777/>.

To exercise the WebMCP tools you need one of:

- **Chrome 149+** with `chrome://flags/#enable-webmcp-testing` enabled, then relaunch.
  If `document.modelContext` is still undefined, launch with `--enable-features=WebMCPTesting`.
- **ChatGPT desktop app**, built-in browser. Requires GPT-5.6 Sol or Terra
  (Luna has WebMCP disabled) and a non-Enterprise, non-Edu workspace. The in-app
  browser may not reach `localhost`, so use a tunnel or a deployed URL.

## Client compatibility

Targets the intersection of the two shipping clients:

- Imperative registration only. The declarative HTML form API is **not supported**
  in ChatGPT's browser.
- Top-level document only. Tools registered inside iframes are **not discovered**
  by ChatGPT's browser, same-origin or cross-origin.
- Feature-detected as `document.modelContext ?? navigator.modelContext`.
  The spec and both clients use `document.modelContext`; `navigator.modelContext`
  was the Chrome 146–149 spelling and is deprecated as of Chrome 150.
- Single document, no router. Tools do not survive navigation.

## Block 0 — spike results

`spike.html` probes six unknowns that neither Chrome's nor OpenAI's documentation
answers. Run it in both clients before relying on any of this.

| | Question | Chrome 149+ (flag) | ChatGPT desktop (5.6 Sol) |
|---|---|---|---|
| S2 | Which API surface is present? | `document.modelContext` | `document.modelContext` |
| — | `registerTool` / `getTools` / `executeTool` | all present | all present |
| — | **`toolchange` event** | **fires on runtime registration** | **absent — `modelContext` is not an EventTarget** |
| S1a | Does a tool registered after load reach the page registry? | yes, `getTools()` 3 → 4 immediately | yes, late registration succeeded |
| S1b | Does an *agent's* tool list pick it up? | _open_ | **yes** — verified by matching one-time tokens |
| S3 | Does `AbortController` unregistration propagate to the agent? | _open_ | _open_ |
| S4 | Can a tool registered mid-turn be called in that same turn? | _open_ | **yes, but not for free** — see below |
| S5 | Is there a tool-count ceiling? | _open_ | 34 registered page-side, no error, no truncation |
| S6 | Does `annotations.readOnlyHint` change anything observable? | _open_ | _open_ |

### S4: the stale tool snapshot

ChatGPT's built-in browser works from a **tool snapshot taken at the start of the
turn**. A tool registered during that turn is not in it, so the first call against
the new tool fails. The agent then refreshed the registry inside the same turn and
the call succeeded, in its own words:

> "The first immediate call failed because the existing tool snapshot was stale;
> after refreshing the registry within the same turn, the call succeeded."

Measured cost in the spike log: `add_tool` at 663932ms, the new tool's first
successful call at 678510ms — roughly fourteen seconds of fail-and-recover. A more
capable agent recovers; a weaker one may simply report failure.

**This is why Understudy leads with the dispatcher (D3).** `run_skill` is registered
when the page loads, so it is always in the snapshot and never goes stale: a
freshly learned skill is callable immediately, with no failed call and no refresh.
The per-skill `registerTool` layer is the upgrade on top, on a path where a stale
snapshot costs nothing.

It is also why approval is enforced at **execute** time, not merely by unregistering
the tool. A revoked skill may linger in an agent's stale snapshot; `runSkill`
re-checks `approved` on every call, so a call that arrives through a stale entry is
still refused.

**Native dialogs do not work in ChatGPT's in-app browser.** `prompt()`, `confirm()` and
`alert()` are silently no-ops, as they are in most embedded browsers — a control that
depends on one just does nothing, with no error. Understudy asks for every value inline
in the page instead. Worth knowing before you build a WebMCP app around a dialog.

The `toolchange` divergence is not documented by either vendor. Understudy does not
depend on the event — see D3 — which is why the static dispatcher exists.

Everything marked _open_ needs an agent that actually **calls** a tool. Reading the
page is not evidence: the spike therefore generates tool names per load, keeps them
out of the DOM entirely (devtools console only), and has every tool mint a one-time
token at execute time. A reported token that matches the log is the only proof a
call happened.

## Build sequence

- [x] **Block 0** — spike page (`spike.html`). *Results not yet filled in — needs a human to run it in both clients.*
- [x] **Block 1** — host app + command bus (`src/commands.js`, `src/app.js`, `src/data.js`)
- [x] **Block 2** — trace rendering + recorder (`src/trace.js`, `src/skills.js`)
- [x] **Block 3** — static tool surface, six meta-tools (`src/webmcp.js`)
- [x] **Block 4** — `save_skill` + bindings + schema derivation (`src/skills.js`)
- [x] **Block 5** — replayer + `run_skill` + structured failures
- [x] **Block 6** — schema review UI; a skill cannot run until approved
- [~] **Block 7** — dynamic `registerTool` per approved skill, revoked via `AbortController`. Written and syntax-checked; **not yet exercised in a WebMCP-capable client**. Persistence uses `localStorage`, not IndexedDB — skills are small JSON and this survives reload just as well.
- [x] **Block 8** — staged agent replay with pace control. Skipped the polyfill: it supplies the
  API but not an agent, so it does not help a judge without a WebMCP client, and the app already
  degrades correctly to a working manual triage app with the header reading `no WebMCP`.
- [ ] **Block 9** — video, description, license

## Data

1000 real Hacker News stories, public, no key and no login.

The **bundled snapshot is the default**, deliberately. Judging happens weeks after a
demo is recorded, and a live "newest stories" feed churns hourly — any topic named in
a walkthrough would match nothing by the time someone tried it. Stable data means what
you see is what the walkthrough showed. `?live=1` fetches the real feed instead, and
falls back to the snapshot if the API is unreachable.

High-yield topics for anyone reproducing the demo: `google` (64), `apple` (33),
`firefox` (19), `openai` (20), `github` (19).

Two categories have complete coverage, which is what makes the knowledge-composition
demo work — teach the skill on one member, then ask the agent to apply it to the rest
of the category and let it enumerate them itself:

- **Big tech** — google 64, apple 33, facebook 16, amazon 14, microsoft 12, twitter 10,
  meta 6, tesla 3, netflix 1 (159 items across 9 companies)
- **Social platforms** — facebook 16, youtube 16, twitter 10, reddit 5, tiktok 4,
  instagram 3 (54 items across 6)

Retail brands are not in a Hacker News corpus; pick a category the data actually has.

## The side panel

Collapsed by default — the workspace is the product, the panel is what you consult.
**Panel** in the header toggles it.

It opens itself whenever there is something in it worth seeing: a demonstration being
captured, a skill waiting for approval, an agent mid-run. Nothing important happens
behind a closed door, which is what makes collapsing it safe rather than merely tidy.

## Clearing what it has learned

Skills persist in `localStorage`, so they survive a reload. To start over:

- **`?reset`** — append it to the URL. Wipes every learned skill and recording before the
  page loads, then strips itself from the address bar. This is the one to use for repeated
  demo runs; embedded browsers have no devtools console to clear storage by hand.
- **Clear all skills** — at the foot of the Skills panel. Two clicks, same as Delete.
- **Delete** — on an individual skill card.

## Teaching, precisely

The **page** captures the demonstration, not the agent. Nothing streams to the model
while you work: you press Teach (or ask your agent to start), do the routine, press
Done, and only then does the agent read a transcript via `get_recording`.

That is a feature, not a shortcut. It costs no tokens while you demonstrate, it is
deterministic, and it works identically whether the agent is idle, busy, or absent
entirely — which is what makes the no-agent path below possible.

## Without a WebMCP client

Turning a recording into a skill is the agent's job — it reads the demonstration and
decides which values are parameters. But the app stays coherent without one: a finished
recording is shown in the Skills panel with everything it captured, and **Create it
myself instead** builds the skill with no parameters, after which you promote the values
you want using the same control the agent's choices are edited with.

So a visitor with no WebMCP client still sees the whole loop. They just do the part the
agent would have done.

## Not implemented

Tracked honestly here as the build proceeds.

- Recording individual-item actions. Only set-based commands are recorded, by
  design (D1) — an individual action would not generalise.
- `UNDO` is dropped from recordings. Replaying an undo against a different
  starting state is meaningless.
- Nested field paths. Bindings address top-level payload fields only, which is
  all the current command set has.
- The per-skill `registerTool` layer has not been verified against a live client
  yet — see Block 0.

# Understudy — submission copy

Paste-ready text for the Devpost form. Live URL and repo are filled in; add `VIDEO_URL` once uploaded.

---

## Tagline

Do the task once. The page writes the tool. The agent does the other two hundred.

---

## What it is

Understudy is a triage workspace where **the user creates the agent's tools by demonstration**.

You do a routine by hand — filter to a topic, tag the matches, set their priority, clear
the filters. The page records it as semantic commands. You say "learn that." The agent
reads the demonstration back, decides which values should be parameters, and calls
`save_skill`. A schema appears for you to review and correct. You approve it, and the page
calls `document.modelContext.registerTool` — at runtime, in a live session, for a tool that
did not exist ninety seconds earlier. The agent then runs it across two hundred items.

The tool surface stops being something the developer ships and becomes something the user grows.

Concretely: teaching an agent a routine used to mean describing it in a prompt and hoping.
Here you do the job once — four actions, about fifteen seconds — and the agent turns that into
a parameterised tool it can run across 1000 items, in a schema you can correct before it runs.

## Why this use case suits WebMCP

Every WebMCP implementation I could find — Chrome's fifteen demos, OpenAI's ten showcase
apps — ships a fixed list of tools the *developer* imagined, registered once at page load.
But the actions worth automating are not the ones a developer imagined. They are the
idiosyncratic multi-step routines each user invents for themselves, and no product team
will ever ship features for that long tail.

WebMCP is the only place this can work, for two reasons:

**The demonstration is client state that never reaches a server.** What the user did, in
what order, over which working set, is a live application session. There is no server-side
artifact to reason about — the trace exists only in the tab where the work happened.

**The tool is registered into the same document the human is still working in.** Human and
agent share one workspace: the human demonstrates in it, the agent's new tool acts on it,
the human watches the results land and corrects the schema. That shared surface is the
premise of the spec, and a server-side MCP has no access to either half.

## What humans and agents can now do together that was hard before

**The page supplies the verb. The agent supplies the nouns.**

Teach it once on a single example — filter for `amazon`, tag them `big-tech`, set priority
high. Fourteen items. Then say: *"now do the same for every other big tech company."* The
agent enumerates Google, Apple, Microsoft, Meta, Facebook, Twitter, Netflix and Tesla from
its own world knowledge, and runs your tool once per company. **Fourteen items taught, a
hundred and forty-five more from knowledge the page never had.**

Neither half can do this alone. The page has no idea what a big tech company is. The agent
has no reliable way to operate your interface — that is the whole reason WebMCP exists. What
makes the pair work is that the human contributes a third thing: the routine itself,
demonstrated rather than described.

And the correction runs the other way too. When the agent leaves `high` hardcoded and you
think priority should be a parameter, you promote it with one click and the schema changes
underneath it. The agent proposes; the human is the authority on intent.

Teaching an agent a workflow otherwise means writing a prompt describing it. Prompts are
lossy, unverifiable, and rewritten every time. **A demonstration is exact.**

## How it improves the experience

- Nothing to configure. The routine you already do by hand *is* the specification.
- No prompt engineering. You never describe the task in words.
- Skills are inspectable, editable, revocable, and persist across reloads.
- You can see what the agent did to your workspace, one step at a time, instead of watching
  the whole list change at once.
- The agent reports what actually happened — how many items each step affected — so a run
  that matched nothing fails loudly instead of claiming success.

## The WebMCP implementation

Two layers, and the split is deliberate.

**A fixed dispatcher, registered at page load.** Six meta-tools: `start_recording`,
`stop_recording`, `get_recording`, `save_skill`, `list_skills`, `run_skill`. Read-only tools
carry `annotations.readOnlyHint`.

**One first-class tool per approved skill,** registered at runtime with
`document.modelContext.registerTool` and held by an `AbortController` so revoking a skill
unregisters its tool.

Four design decisions carry the project:

**Commands operate on sets, not on items.** `SELECT_ITEMS {ids:[3,7,12]}` cannot generalise.
`SET_FILTER {contains:"rust"}` followed by `TAG_MATCHING {tag:"read-later"}` generalises for
free, because the filter value is obviously the parameter. Every action in the UI is expressed
over the current matching set. This is a product decision forced by the agent requirement —
and it is also just better bulk-triage UI.

**The agent never writes the steps.** `save_skill` takes a recording id plus bindings —
`{paramName, stepIndex, fieldPath, type}`. The page derives the JSON Schema. The steps come
from the recording verbatim. So a synthesised skill **cannot do anything the human did not
demonstrate**. That is both the robustness story — no hallucinated commands — and the safety
story: bounded blast radius, by construction.

**The dispatcher leads; runtime registration is the upgrade.** This one is evidence-driven.
Testing against ChatGPT desktop showed its browser works from a **tool snapshot taken at the
start of the turn** — a tool registered mid-turn is not in it, and the first call fails until
the registry refreshes. The agent's own words: *"The first immediate call failed because the
existing tool snapshot was stale; after refreshing the registry within the same turn, the
call succeeded."* Measured cost: about fourteen seconds of fail-and-recover. `run_skill` is
registered at load, so it is always in the snapshot and never stale — a freshly learned skill
is callable immediately. The per-skill tool is the bonus, on a path where staleness is free.

The same finding is why **approval is enforced at execute time**, not merely by unregistering.
A revoked skill can linger in an agent's stale snapshot, so every call re-checks approval and
a call arriving through a stale entry is refused.

**The agent's work is staged so a human can follow it.** When an agent rewrites a workspace
someone is watching, applying every step at once teaches them nothing — 250 rows change and the
reason is lost. Skill replay applies one step at a time, announcing each in the app's own words
with a progress track, while the trace panel grows an entry at a time. The human's own clicks
stay instant; only replay is paced, and it is capped at four seconds total so a long skill never
stalls a tool call.

**The controls show the agent's work.** Replay dispatches commands, not clicks — but each step
is echoed back through the control it corresponds to, typing the filter value in character by
character and flashing the button that would have been pressed. Presentational only: nothing in
that path dispatches. Driving the real DOM controls would recouple replay to the DOM and undo
the generalisation the command bus buys.

**Replay returns ground truth.** Every step reports how many items it actually affected. A step
that matches nothing returns the failing step index, the reason, and which earlier steps already
applied, so the agent adjusts instead of retrying blindly.

## What I measured about the clients

Both were tested; findings are in the repo README with the probe page that produced them
(`spike.html`, which generates tool names per load, keeps them out of the DOM, and has every
tool mint a one-time token — so a reported token is the only proof a call actually happened).

| | Chrome 149+ | ChatGPT desktop (5.6 Sol) |
|---|---|---|
| API surface | `document.modelContext` | `document.modelContext` |
| `toolchange` event | fires on runtime registration | **absent — `modelContext` is not an EventTarget** |
| Tool registered after load | reaches the registry immediately | reaches the registry; agent sees it after a refresh |
| Mid-turn registration | — | works, but the first call fails against a stale snapshot |

The `toolchange` divergence is not documented by either vendor. Understudy does not depend on
the event, which is why the dispatcher exists.

## Who would deploy this

Any product with power users and a long tail of workflows it will never build features for —
Linear, Notion, Figma, Retool, Airtable, Zendesk, every admin console. The broader claim is the
interesting one: **any app with a command bus, action log, or undo stack can adopt this pattern
more or less wholesale.** Understudy is that pattern with one host app around it.

## Built with

Plain ES modules. No framework, no build step, no backend, no dependencies. 1000 real Hacker News
stories via the Algolia API — no key, no login. The bundled snapshot is the default so that what
a judge sees weeks from now matches the demo video; `?live=1` fetches the live feed. Skills
persist in `localStorage`.

## Try it

1. Open https://understudy-wine.vercel.app in ChatGPT desktop's built-in browser (GPT-5.6 Sol or Terra — Luna has WebMCP
   disabled), or Chrome 149+ with `chrome://flags/#enable-webmcp-testing`.
2. Header should read `WebMCP: 6 tools`.
3. Press **Teach**, filter `title contains google` (64 matches), tag them, set priority, clear
   filters, press **Done**.
4. Ask the agent: *"Look at what I just did and turn it into a reusable skill."*
5. Review the parameters it chose. Promote one it missed. Approve.
6. Ask it to run the skill for topics you never demonstrated — try `apple`, `openai`, `github`,
   `firefox` in one request and watch the counts add up.

Without a WebMCP client it stays a working triage app, with the header reading `no WebMCP`.

## Honest limitations

- Individual-item actions are not recorded, by design — they would not generalise.
- `UNDO` is dropped from recordings; replaying an undo against a different starting state is meaningless.
- Bindings address top-level payload fields only, which is all the current command set has.
- `readOnlyHint` behaviour and `AbortController` revocation propagation were not conclusively
  measured against either client. Marked open in the README rather than claimed.

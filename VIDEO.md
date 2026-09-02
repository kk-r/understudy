# Video plan — ~2:30, under the 3:00 limit

Written against Devpost's own guidance: show it working in the first 10–15 seconds,
make the agent using your tools the centerpiece, cut every wait, don't type live,
use jump cuts, and save the story for the written description.

## Method

**Record in short clips.** One clip per beat below. A fumble costs you one clip, not
the take. It also lets you jump-cut the agent's thinking time out of every tool call.

**Paste prompts, never type them.** Have all four prompts in a scratch file and paste.

**Screen silent first, narrate after.** Audio is then cheap to redo and easy to retime.
Synthetic narration is explicitly endorsed by the organisers — use it if you'd rather.

**Let the agent press Teach.** Say "start recording" rather than clicking: it puts a
tool call on screen instead of a click, and the agent using your tools is the thing
being scored. The Teach button is your fallback if the agent misroutes twice.

**Do not say the agent "watches" you.** It doesn't. The page captures; the agent reads
the transcript afterwards via `get_recording`. The true version is the stronger claim.

**Settings:** bundled snapshot (not `?live=1`), Agent pace **Normal**. Topic yields:
`google` 64, `apple` 32, `openai` 20, `github` 19, `firefox` 19.

---

## Shot list

**0:00–0:12 — COLD OPEN. The payoff, no preamble.**
Already mid-flow. The agent runs a learned skill: controls fill in, buttons depress,
counts climb. On-screen text only — no narration yet:

> `triage_topic(topic) — a tool that did not exist 90 seconds ago`

**0:12–0:24 — What you just saw.**

> "Every WebMCP demo ships a fixed list of tools the developer imagined. That tool
> wasn't in the list. I taught it, by doing the job once."

**0:24–0:34 — Hand the recorder to the agent.** Paste: *"I'm going to teach you my
triage routine. Start recording."* Jump-cut the thinking. Show the tool call land and
the button flip to **Done**.

**0:34–0:52 — Teach it.** Filter `title contains google` — 64 matches. Tag `alphabet`.
Priority High. Press Done. Let the trace panel fill; **don't narrate over it**.

> "I do the routine once, by hand. The page captures it as commands in its own
> vocabulary — filter, tag, prioritise."

**0:52–1:18 — The agent learns it.** Paste: *"Stop recording. Look at what I did and
turn it into a reusable skill — you decide which values should be parameters."*

> "The agent reads the transcript and decides what should be a parameter. It never
> writes the steps — it can't. It only says which fields in which steps become
> arguments. The steps are what I actually did, verbatim, so a learned skill can never
> do something I never demonstrated."

**1:18–1:42 — You overrule it.** The card is **pending**. Promote a value it left
hardcoded. Approve.

> "It made topic a parameter and left priority fixed. I disagree — one click, and the
> schema changes underneath it. It proposes; I decide. Until I approve, it can't run."

**1:42–2:05 — Run it wide.** Paste: *"Run it for apple, openai, github and firefox."*

> "Watch the controls. It isn't clicking the page — it's dispatching the commands I
> demonstrated, and the interface shows its work so I can follow what was done for me."

**2:05–2:18 — It's a real tool.** Site tools in the address bar, or DevTools →
Application → WebMCP. Point at the learned tool among the six built-ins.

> "Registered at runtime, with a schema the agent wrote and I corrected."

**2:18–2:32 — The finding. Cut this first if you're long.**
Spike log, two matching tokens on screen.

> "ChatGPT's browser works from a tool snapshot taken at the start of the turn, so a
> tool registered mid-turn fails its first call. That's why a dispatcher registered at
> page load runs learned skills — they work immediately."

**2:32–2:38 — Close.**

> "Any app with a command bus can adopt this."

---

## Protect beat 1:18

If you run long, cut the 2:18 finding, then trim the cold open. **Never cut the
schema correction.** Everything else exists somewhere in the reference demos; a human
overruling the agent's schema and the tool changing shape underneath does not.

## Dry run before recording

- `save_skill` picks sane parameters unprompted.
- The agent respects the approval gate rather than forcing a run.
- Normal pace reads well on playback, not just live.

## Checklist

- [ ] Under 3:00
- [ ] Public on YouTube, not unlisted
- [ ] Audio covering what was built and how WebMCP was used
- [ ] Working product visible in the first 10–15 seconds
- [ ] No third-party trademarks or copyrighted music
- [ ] Recorded on https://understudy-wine.vercel.app, not localhost
- [ ] No sign-up, loading, or dead air

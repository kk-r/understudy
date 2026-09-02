# Video plan — 2:40, under the 3:00 limit

Public YouTube, audio narration, no music. Screen recording of ChatGPT desktop with the
built-in browser open beside the chat — both halves visible the whole time, because the
point of the project is that the human and the agent are in the same workspace.

Record on the deployed URL, not localhost. Do a dry run first: the loop takes about
ninety seconds live and the schema-review beat is the one worth rehearsing.

---

## Method

**Record the screen silently first, then narrate over it.** Live narration means
redoing the whole demo every time a sentence fumbles. Separated, audio is cheap to
redo and easy to retime under 3:00. Synthetic narration is permitted — the rules only
bar third-party trademarks and copyrighted music.

**Let the agent drive the recorder.** Say "start recording" rather than pressing the
button: it puts a WebMCP tool call on screen instead of a click, and it frames the
agent as watching you work, which is the premise. The button stays as a fallback if a
call misfires mid-take.

**Use the bundled snapshot, not `?live=1`.** Fixed data, so what a judge sees weeks
later matches the video. Topic yields: `google` 64, `apple` 32, `openai` 20,
`github` 19, `firefox` 19.

**Agent pace: Normal.** Slow only if the controls read too fast on playback.

---

## Shot list

**0:00–0:15 — The problem, over a still of the app.**

> "Every WebMCP demo ships a fixed list of tools the developer imagined. But the
> routines worth automating are the ones each user invents for themselves, and no
> product team is ever going to ship features for that long tail. Understudy lets the
> user create the tools."

**0:15–0:25 — Hand the recorder to the agent.** Type: *"I'm going to teach you my triage
routine. Start recording."* Show the tool call land and the Teach state go live.

> "I tell the agent to watch."

**0:25–0:50 — Demonstrate by hand.** Filter `title contains google` — 64 matches. Tag
`read-later`. Priority High. Clear filters. Let the trace panel fill; **don't talk over
it**, the silence sells that these are real commands, not clicks.

> "I do the routine once, by hand. The page records it as commands in its own
> vocabulary — filter, tag, prioritise. Four steps."

**0:50–1:20 — The agent reads it back.** Type: *"Stop recording. Look at what I did and
turn it into a reusable skill — you decide which values should be parameters."*

> "It reads the demonstration and decides what should be a parameter. It does not write
> the steps, and it can't. It only says which fields in which steps become arguments.
> The steps come from what I actually did, verbatim — so a learned skill can never do
> something I never demonstrated."

**1:20–1:45 — The human corrects it.** The card appears **pending**. Promote a value the
agent left hardcoded — `level` is usually the one. Approve.

> "It made topic and tag parameters but left priority fixed. I disagree. One click and
> the schema changes underneath it. It proposes; I'm the authority on intent. Now I
> approve — and until I do, it can't run."

**1:45–2:15 — The payoff.** Type: *"Run it for apple, openai, github and firefox."*
Four paced replays. Let the controls move — the typing and the button presses are the shot.

> "Watch the controls. It's not clicking the page — it's dispatching the commands I
> demonstrated, and the interface is showing its work so I can follow what was done on
> my behalf. That tool did not exist two minutes ago."

**2:15–2:30 — Show the registration.** Site tools in the address bar, or Chrome DevTools
→ Application → WebMCP. Point at the learned tool sitting among the six built-ins.

> "It's a real WebMCP tool now. Registered at runtime, with a schema the agent wrote and
> I corrected."

**2:30–2:50 — The engineering finding.** Cut to the spike log with the two matching tokens.

> "One thing I measured: ChatGPT's browser works from a tool snapshot taken at the start
> of the turn, so a tool registered mid-turn fails its first call until the registry
> refreshes. That's why Understudy leads with a dispatcher registered at page load — a
> freshly learned skill is callable immediately."

**2:50–2:58 — Close.**

> "Any app with a command bus can adopt this. Understudy is that pattern, with one
> workspace around it."

---

## Dry run first

The loop takes about ninety seconds live. Run it once end to end before recording and
check three things:

- `save_skill` picks sane parameters unprompted. If it doesn't, that's a tool-description
  problem worth fixing before you narrate a claim about it.
- The agent respects the approval gate rather than trying to force a run.
- The paced replay reads at Normal on playback, not just live.

---

## Rules checklist

- [ ] Under 3:00
- [ ] Public on YouTube, not unlisted
- [ ] Audio explaining what was built and how WebMCP was used
- [ ] No third-party trademarks or copyrighted music
- [ ] Shows the project actually working
- [ ] Recorded on the deployed URL, not localhost

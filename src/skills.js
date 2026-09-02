// Recordings and learned skills.
//
// D2 -- the agent never writes the steps. It reads a recording and says which
// fields in which steps should become parameters. The steps themselves come
// from what the human actually did, verbatim. A learned skill therefore cannot
// do anything that was never demonstrated.

import { describePlain, bindablePaths } from './trace.js';

export const STORE = 'understudy.skills.v1';

/** Wipe everything learned. Used by `?reset` and by Clear all. */
export function clearStored() {
  try { localStorage.removeItem(STORE); } catch (e) { console.warn('[understudy] clear failed', e); }
}
const ident = /^[a-z][a-z0-9_]{2,47}$/;

export function createSkills(bus) {
  const recordings = new Map();
  const skills = new Map();
  const listeners = new Set();
  let active = null; // { id, startIndex }
  let seq = 0;

  // Replay pacing. When an agent rewrites a workspace a human is watching, applying
  // every step at once tells them nothing -- a thousand rows change and the reason is lost.
  // Defaults to the slowest setting: the first time you see an agent operate your
  // interface, legibility matters more than speed. Instant is one click away.
  // Steps are applied one at a time with the current step announced, so the human can
  // follow what was done on their behalf. 0 disables it. Total pacing is capped so a
  // long skill never stalls a tool call.
  let paceMs = 520;
  const PACE_BUDGET_MS = 2400;
  const progress = new Set();

  const notify = () => listeners.forEach((fn) => fn());

  // --- persistence (localStorage: skills are small JSON, and this survives reload) ---
  function save() {
    try {
      localStorage.setItem(STORE, JSON.stringify({
        recordings: [...recordings.values()],
        skills: [...skills.values()],
      }));
    } catch (e) { console.warn('[understudy] persist failed', e); }
  }
  function load() {
    try {
      const raw = localStorage.getItem(STORE);
      if (!raw) return;
      const data = JSON.parse(raw);
      for (const r of data.recordings ?? []) { recordings.set(r.id, r); seq = Math.max(seq, +r.id.split('-')[1] || 0); }
      for (const s of data.skills ?? []) skills.set(s.name, s);
    } catch (e) { console.warn('[understudy] load failed', e); }
  }

  // --- recording ----------------------------------------------------------

  function startRecording() {
    if (active) return { ok: false, reason: `already recording (${active.id}); stop it first` };
    active = { id: `rec-${++seq}`, startIndex: bus.getLog().length };
    notify();
    return { ok: true, recordingId: active.id };
  }

  function stopRecording() {
    if (!active) return { ok: false, reason: 'not recording' };
    // UNDO is dropped: replaying an undo against a different starting state does
    // not mean anything. Deliberate -- see README "Not implemented".
    const steps = bus.getLog().slice(active.startIndex)
      .filter((e) => e.type !== 'UNDO')
      .map((e) => ({ type: e.type, payload: e.payload, affected: e.affected }));
    const rec = { id: active.id, steps, at: Date.now() };
    active = null;
    if (steps.length === 0) { notify(); return { ok: false, reason: 'nothing was demonstrated between start and stop' }; }
    recordings.set(rec.id, rec);
    save(); notify();
    return { ok: true, recordingId: rec.id, steps: steps.length };
  }

  /** What the agent reads: prose to reason over, plus the exact paths it may bind. */
  function describeRecording(id) {
    const rec = recordings.get(id) ?? [...recordings.values()].at(-1);
    if (!rec) return { ok: false, reason: 'no recordings yet — call start_recording, demonstrate, then stop_recording' };
    return {
      ok: true,
      recordingId: rec.id,
      demonstration: rec.steps.map((s, i) => `${i}. ${describePlain(s)}${s.affected ? ` (${s.affected} items affected)` : ''}`).join('\n'),
      guidance:
        'Bind every field marked kind:"content" as a parameter unless the user has said it should stay fixed -- ' +
        'those are the values they typed or picked, and they are what changes between runs. ' +
        'Leave kind:"structural" fields alone: they describe the shape of the command, not the case being handled. ' +
        'Give each parameter a short lowercase name that says what it means to the user, not the field it came from.',
      steps: rec.steps.map((s, i) => ({
        stepIndex: i,
        command: s.type,
        bindableFields: bindablePaths(s).map((b) => ({
          fieldPath: b.path,
          currentValue: b.value,
          type: b.type,
          kind: b.kind,
        })),
      })),
    };
  }

  // --- synthesis ----------------------------------------------------------

  function saveSkill({ recordingId, name, description, params = [] }) {
    const rec = recordings.get(recordingId) ?? [...recordings.values()].at(-1);
    if (!rec) return { ok: false, reason: 'no such recording' };
    if (!ident.test(name || '')) return { ok: false, reason: `invalid skill name "${name}" — use lowercase letters, digits and underscores, 3-48 chars` };
    if (skills.has(name)) return { ok: false, reason: `a skill named "${name}" already exists` };
    if (!description) return { ok: false, reason: 'description is required' };

    const seen = new Set();
    for (const p of params) {
      if (!ident.test(p.name || '')) return { ok: false, reason: `invalid parameter name "${p.name}"` };
      if (seen.has(p.name)) return { ok: false, reason: `duplicate parameter "${p.name}"` };
      seen.add(p.name);
      const step = rec.steps[p.stepIndex];
      if (!step) return { ok: false, reason: `step ${p.stepIndex} does not exist (recording has ${rec.steps.length} steps: 0-${rec.steps.length - 1})` };
      if (!(p.fieldPath in (step.payload ?? {}))) {
        return { ok: false, reason: `step ${p.stepIndex} (${step.type}) has no field "${p.fieldPath}" — it has: ${Object.keys(step.payload ?? {}).join(', ')}` };
      }
    }

    const skill = {
      name, description, recordingId: rec.id,
      steps: rec.steps.map((s) => ({ type: s.type, payload: s.payload })),
      params: params.map((p) => ({
        name: p.name, stepIndex: p.stepIndex, fieldPath: p.fieldPath,
        type: p.type || typeof rec.steps[p.stepIndex].payload[p.fieldPath],
        description: p.description || `value for ${p.fieldPath} in step ${p.stepIndex}`,
      })),
      approved: false,
      createdAt: Date.now(),
    };
    skills.set(name, skill);
    save(); notify();
    return { ok: true, name, inputSchema: schemaFor(skill), approved: false };
  }

  function schemaFor(skill) {
    const properties = {};
    for (const p of skill.params) properties[p.name] = { type: p.type === 'number' ? 'number' : 'string', description: p.description };
    return { type: 'object', properties, required: skill.params.map((p) => p.name) };
  }

  function approveSkill(name, on = true) {
    const s = skills.get(name);
    if (!s) return { ok: false, reason: `no skill named "${name}"` };
    s.approved = on; save(); notify();
    return { ok: true };
  }

  function updateParams(name, params) {
    const s = skills.get(name);
    if (!s) return { ok: false, reason: `no skill named "${name}"` };
    s.params = params; s.approved = false; save(); notify();
    return { ok: true };
  }

  function deleteSkill(name) {
    if (!skills.delete(name)) return { ok: false, reason: `no skill named "${name}"` };
    save(); notify();
    return { ok: true };
  }

  // --- replay -------------------------------------------------------------

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Listeners may be async (the control echo is). Their time counts against the
  // step's pacing budget, so an echoed step is not slower than an un-echoed one.
  // `blocking` is false when pacing is off: listeners are still told, but replay
  // does not wait for them, so Instant stays instant however slow a listener is.
  const announce = async (p, blocking) => {
    const calls = [...progress].map((fn) => { try { return fn(p); } catch { return null; } });
    if (!blocking) return 0;
    const t0 = Date.now();
    await Promise.all(calls);
    return Date.now() - t0;
  };

  /** D4 -- returns what actually happened, per step, and a structured reason on failure. */
  async function runSkill(name, args = {}, { pace = paceMs } = {}) {
    const skill = skills.get(name);
    if (!skill) return { ok: false, reason: `no skill named "${name}". Call list_skills to see what exists.` };
    if (!skill.approved) return { ok: false, reason: `skill "${name}" is awaiting human approval in the Skills panel and cannot run yet` };

    for (const p of skill.params) {
      if (!(p.name in args)) return { ok: false, reason: `missing required argument "${p.name}" (${p.description})` };
    }

    const steps = skill.steps.map((s) => ({ type: s.type, payload: { ...s.payload } }));
    for (const p of skill.params) steps[p.stepIndex].payload[p.fieldPath] = args[p.name];

    const trace = [];
    const delay = pace > 0 ? Math.min(pace, PACE_BUDGET_MS / Math.max(steps.length, 1)) : 0;

    for (const [i, step] of steps.entries()) {
      const spent = await announce({ skill: name, step: i, total: steps.length, did: describePlain(step), running: true, command: step, budgetMs: delay }, delay > 0);
      if (delay > spent) await sleep(delay - spent);
      const res = bus.dispatch(step);
      trace.push({ step: i, did: describePlain(step), affected: res.affected ?? 0, ok: res.ok, reason: res.reason });
      if (!res.ok) {
        await announce({ skill: name, step: i, total: steps.length, did: describePlain(step), running: false, failed: true }, false);
        return {
          ok: false, status: 'failed',
          failedAtStep: i, did: describePlain(step), reason: res.reason,
          completedSteps: trace.slice(0, i),
          hint: 'Earlier steps were applied and are still in effect. Adjust the arguments and try again, or undo.',
        };
      }
    }
    await announce({ skill: name, step: steps.length - 1, total: steps.length, running: false }, false);
    return { ok: true, status: 'complete', trace, totalAffected: trace.reduce((n, t) => n + t.affected, 0) };
  }

  load();
  return {
    startRecording, stopRecording, describeRecording,
    saveSkill, approveSkill, updateParams, deleteSkill, runSkill, schemaFor,
    setPace: (ms) => { paceMs = Math.max(0, ms | 0); },
    getPace: () => paceMs,
    onProgress: (fn) => { progress.add(fn); return () => progress.delete(fn); },
    isRecording: () => !!active,
    activeId: () => active?.id ?? null,
    recordedSoFar: () => (active ? bus.getLog().length - active.startIndex : 0),
    clearAll: () => {
      skills.clear(); recordings.clear(); active = null;
      clearStored(); notify();
      return { ok: true };
    },
    listSkills: () => [...skills.values()],
    /** Recordings no skill has been built from yet. */
    listUnlearnedRecordings: () => {
      const used = new Set([...skills.values()].map((s) => s.recordingId));
      return [...recordings.values()].filter((r) => !used.has(r.id)).reverse();
    },
    stepsOf: (id) => (recordings.get(id)?.steps ?? []),
    getSkill: (n) => skills.get(n),
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  };
}

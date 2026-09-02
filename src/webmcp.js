// The WebMCP surface.
//
// D3 -- two layers. A fixed set of six meta-tools registered at load, which works
// in every client with no assumptions about mid-session refresh; and, on top of
// that, one first-class tool per approved skill via registerTool at runtime.
// If a client ignores runtime registration, the dispatcher (list_skills +
// run_skill) still carries the whole flow.

const mc = () => document.modelContext ?? navigator.modelContext ?? null;

const reply = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 1) }] });
const str = (description) => ({ type: 'string', description });

export function isAvailable() { return !!mc()?.registerTool; }

export async function install(skills, onEvent = () => {}) {
  const ctx = mc();
  if (!ctx?.registerTool) return { ok: false, reason: 'WebMCP unavailable in this browser' };

  const announce = (tool, result) => { onEvent(tool, result); return reply(result); };

  const META = [
    {
      name: 'start_recording',
      description:
        'Begin capturing the user\'s actions as a demonstration -- they are teaching you a routine. ' +
        'Call this when they say anything like "let me teach you", "watch what I do", or "start recording". ' +
        'The page does the capturing; you see nothing until you call get_recording afterwards. ' +
        'Call stop_recording when they say they are done. This is how new skills get created.',
      inputSchema: { type: 'object', properties: {}, required: [] },
      execute: async () => announce('start_recording', skills.startRecording()),
    },
    {
      name: 'stop_recording',
      description: 'Stop capturing and return the demonstration id and step count. Call this when the user says they are done teaching. ' +
        'Then call get_recording to see what they actually did.',
      inputSchema: { type: 'object', properties: {}, required: [] },
      execute: async () => announce('stop_recording', skills.stopRecording()),
    },
    {
      name: 'get_recording',
      description:
        'Read back what the user taught you: a plain-language list of what they did, plus, for each step, the exact fields you may turn into parameters. ' +
        'Use this to decide which values are parameters before calling save_skill. Defaults to the most recent recording.',
      inputSchema: { type: 'object', properties: { recordingId: str('Recording id. Omit for the most recent.') }, required: [] },
      annotations: { readOnlyHint: true },
      execute: async ({ recordingId } = {}) => announce('get_recording', skills.describeRecording(recordingId)),
    },
    {
      name: 'save_skill',
      description:
        'Turn a recording into a reusable, parameterised skill. You do NOT supply the steps -- they come from the recording exactly as the user performed them. ' +
        'You supply a name, a description, and which fields in which steps become parameters. ' +
        'Each parameter needs: name, stepIndex, fieldPath (both from get_recording), type, and description. ' +
        'The skill is created unapproved; the user reviews the parameters in the Skills panel before it can run.',
      inputSchema: {
        type: 'object',
        properties: {
          name: str('Skill name: lowercase letters, digits and underscores, e.g. triage_by_topic'),
          description: str('What the skill does, written for whoever calls it later'),
          recordingId: str('Recording id. Omit for the most recent.'),
          params: {
            type: 'array',
            description: 'Fields to expose as parameters. Empty means the skill always does exactly what was demonstrated.',
            items: {
              type: 'object',
              properties: {
                name: str('Parameter name'),
                stepIndex: { type: 'number', description: 'Which step, from get_recording' },
                fieldPath: str('Which field in that step, from bindableFields'),
                type: { type: 'string', enum: ['string', 'number'], description: 'Parameter type' },
                description: str('What this parameter means'),
              },
              required: ['name', 'stepIndex', 'fieldPath'],
            },
          },
        },
        required: ['name', 'description'],
      },
      execute: async (args) => {
        const res = skills.saveSkill(args ?? {});
        // Measured, ChatGPT desktop 5.6 Sol: the client works from a tool snapshot
        // taken at the start of the turn, so a tool registered now is not in it and
        // the first call against it fails until the registry refreshes. run_skill was
        // registered at load, is always in the snapshot, and never goes stale.
        if (res.ok) res.howToRun = `Once the user approves it, run this with run_skill(name: "${res.name}"). ` +
          `It is also registered as a tool called "${res.name}", but your tool list may be a snapshot from the start of this turn — ` +
          `calling it directly may fail until that refreshes. run_skill always works.`;
        return announce('save_skill', res);
      },
    },
    {
      name: 'list_skills',
      description:
        'List the skills this page has learned, with their parameters and whether the user has approved them. ' +
        'Approved skills can be run with run_skill, and are also registered as tools in their own right. ' +
        'Prefer run_skill: it was registered when the page loaded, so it is never missing from a stale tool snapshot.',
      inputSchema: { type: 'object', properties: {}, required: [] },
      annotations: { readOnlyHint: true },
      execute: async () => announce('list_skills', {
        ok: true,
        skills: skills.listSkills().map((s) => ({
          name: s.name, description: s.description, approved: s.approved,
          inputSchema: skills.schemaFor(s), stepCount: s.steps.length,
        })),
      }),
    },
    {
      name: 'run_skill',
      description:
        'Run a learned skill. Returns what actually happened at each step, including how many items were affected. ' +
        'If a step matches nothing it fails with the reason and tells you which earlier steps already applied -- read that and adjust rather than retrying blindly.',
      inputSchema: {
        type: 'object',
        properties: {
          name: str('Skill name, from list_skills'),
          args: { type: 'object', description: 'Arguments matching the skill\'s inputSchema', additionalProperties: true },
        },
        required: ['name'],
      },
      execute: async ({ name, args } = {}) => announce('run_skill', await skills.runSkill(name, args ?? {})),
    },
  ];

  for (const def of META) {
    try { await ctx.registerTool(def); }
    catch (e) { console.error('[understudy] failed to register', def.name, e); }
  }

  // --- per-skill tools, registered and revoked as the user approves ---------
  const live = new Map(); // skill name -> AbortController

  async function sync() {
    const approved = new Map(skills.listSkills().filter((s) => s.approved).map((s) => [s.name, s]));

    for (const [name, ctl] of live) {
      if (!approved.has(name)) { ctl.abort(); live.delete(name); onEvent('unregister', { name }); }
    }
    for (const [name, skill] of approved) {
      if (live.has(name)) continue;
      const ctl = new AbortController();
      try {
        await ctx.registerTool({
          name,
          description: `${skill.description} (Learned from a demonstration by the user on this page.)`,
          inputSchema: skills.schemaFor(skill),
          execute: async (args) => announce(name, await skills.runSkill(name, args ?? {})),
        }, { signal: ctl.signal });
        live.set(name, ctl);
        onEvent('register', { name });
      } catch (e) {
        console.error('[understudy] failed to register skill', name, e);
      }
    }
  }

  skills.subscribe(sync);
  await sync();

  return { ok: true, metaTools: META.map((t) => t.name), sync };
}

// Renders a command in the app's own vocabulary rather than as JSON.
//
// This matters more than it looks: the agent reads this prose to work out what
// the human demonstrated. If a step doesn't read like a sentence, the agent
// can't reason about which parts of it should become parameters.

const V = (s) => `<code>${String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</code>`;

const TEMPLATES = {
  SET_FILTER:           (p, v) => `filter: ${p.field} ${p.op} ${v(p.value)}`,
  REMOVE_FILTER:        (p, v) => `remove filter on ${v(p.field)}`,
  CLEAR_FILTERS:        () => 'clear all filters',
  SET_SORT:             (p, v) => `sort by ${v(p.field)} ${p.dir}`,
  TAG_MATCHING:         (p, v) => `tag matching items ${v(p.tag)}`,
  UNTAG_MATCHING:       (p, v) => `remove tag ${v(p.tag)} from matching items`,
  SET_PRIORITY_MATCHING:(p, v) => p.level ? `set priority of matching items to ${v(p.level)}` : 'clear priority of matching items',
  DISMISS_MATCHING:     () => 'dismiss matching items',
  PROMOTE_MATCHING:     () => 'promote matching items',
  UNDO:                 () => 'undo',
};

export function describe(entry) {
  const fn = TEMPLATES[entry.type];
  return fn ? fn(entry.payload ?? {}, V) : `${entry.type} ${JSON.stringify(entry.payload ?? {})}`;
}

/** Same sentence, no markup -- this is what goes to the agent. */
export function describePlain(entry) {
  const fn = TEMPLATES[entry.type];
  return fn ? fn(entry.payload ?? {}, (s) => `"${s}"`) : `${entry.type} ${JSON.stringify(entry.payload ?? {})}`;
}

/** Every value in a command that could plausibly become a parameter, with its path. */
export function bindablePaths(entry) {
  return Object.entries(entry.payload ?? {})
    .filter(([, v]) => v !== null && typeof v !== 'object')
    .map(([k, v]) => ({ path: k, value: v, type: typeof v === 'number' ? 'number' : 'string' }));
}

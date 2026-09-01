// The command bus. Every state change in this app goes through dispatch().
//
// This is the whole foundation of Understudy: because user actions are recorded
// as semantic commands rather than DOM events, a demonstration can be replayed
// with different arguments. Commands act on the *matching set* (whatever the
// current filters select), never on hardcoded item ids -- that is what makes a
// recording generalizable at all.

export const FILTER_FIELDS = {
  title:    { ops: ['contains'],        type: 'string' },
  author:   { ops: ['contains', 'is'],  type: 'string' },
  tag:      { ops: ['is'],              type: 'string' },
  status:   { ops: ['is'],              type: 'string' },
  priority: { ops: ['is'],              type: 'string' },
  points:   { ops: ['atLeast'],         type: 'number' },
  comments: { ops: ['atLeast'],         type: 'number' },
};

export const SORT_FIELDS = ['points', 'comments', 'createdAt', 'title'];
export const PRIORITIES = ['high', 'normal', 'low'];
export const STATUSES = ['inbox', 'promoted', 'dismissed'];

export function initialState(items) {
  return {
    items: items.map((it) => ({ ...it, tags: [], priority: null, status: 'inbox' })),
    filters: [],
    sort: { field: 'points', dir: 'desc' },
  };
}

// --- selection ------------------------------------------------------------

function passes(item, f) {
  switch (f.op) {
    case 'contains': return String(item[f.field] ?? '').toLowerCase().includes(String(f.value).toLowerCase());
    case 'is':       return f.field === 'tag' ? item.tags.includes(f.value) : item[f.field] === f.value;
    case 'atLeast':  return Number(item[f.field] ?? 0) >= Number(f.value);
    default:         return false;
  }
}

/** Items the current filters select. Dismissed items are hidden unless explicitly filtered for. */
export function matching(state) {
  const explicitStatus = state.filters.some((f) => f.field === 'status');
  return state.items.filter((it) =>
    (explicitStatus || it.status !== 'dismissed') && state.filters.every((f) => passes(it, f)));
}

export function sorted(items, sort) {
  const dir = sort.dir === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => {
    const av = a[sort.field], bv = b[sort.field];
    if (typeof av === 'string') return av.localeCompare(bv) * dir;
    return ((av ?? 0) - (bv ?? 0)) * dir;
  });
}

// --- reducer --------------------------------------------------------------

const fail = (reason) => ({ error: reason });

/** Apply `fn` to every matching item. Returns a new state plus the affected count. */
function mapMatching(state, fn) {
  const hits = new Set(matching(state).map((it) => it.id));
  if (hits.size === 0) return fail('filters matched 0 items');
  return {
    state: { ...state, items: state.items.map((it) => (hits.has(it.id) ? fn(it) : it)) },
    affected: hits.size,
  };
}

export function reduce(state, cmd) {
  const p = cmd.payload ?? {};
  switch (cmd.type) {
    case 'SET_FILTER': {
      const spec = FILTER_FIELDS[p.field];
      if (!spec) return fail(`unknown filter field "${p.field}" (expected one of: ${Object.keys(FILTER_FIELDS).join(', ')})`);
      if (!spec.ops.includes(p.op)) return fail(`field "${p.field}" does not support op "${p.op}" (supports: ${spec.ops.join(', ')})`);
      if (p.value === '' || p.value == null) return fail('filter value is empty');
      const filters = [...state.filters.filter((f) => f.field !== p.field), { field: p.field, op: p.op, value: p.value }];
      const next = { ...state, filters };
      return { state: next, affected: matching(next).length };
    }
    case 'REMOVE_FILTER': {
      if (!state.filters.some((f) => f.field === p.field)) return fail(`no filter set on "${p.field}"`);
      const next = { ...state, filters: state.filters.filter((f) => f.field !== p.field) };
      return { state: next, affected: matching(next).length };
    }
    case 'CLEAR_FILTERS': {
      if (state.filters.length === 0) return fail('no filters to clear');
      const next = { ...state, filters: [] };
      return { state: next, affected: matching(next).length };
    }
    case 'SET_SORT': {
      if (!SORT_FIELDS.includes(p.field)) return fail(`unknown sort field "${p.field}" (expected one of: ${SORT_FIELDS.join(', ')})`);
      return { state: { ...state, sort: { field: p.field, dir: p.dir === 'asc' ? 'asc' : 'desc' } }, affected: 0 };
    }
    case 'TAG_MATCHING': {
      if (!p.tag) return fail('tag is empty');
      return mapMatching(state, (it) => (it.tags.includes(p.tag) ? it : { ...it, tags: [...it.tags, p.tag] }));
    }
    case 'UNTAG_MATCHING': {
      if (!p.tag) return fail('tag is empty');
      return mapMatching(state, (it) => ({ ...it, tags: it.tags.filter((t) => t !== p.tag) }));
    }
    case 'SET_PRIORITY_MATCHING': {
      if (p.level !== null && !PRIORITIES.includes(p.level)) return fail(`unknown priority "${p.level}" (expected one of: ${PRIORITIES.join(', ')}, or null)`);
      return mapMatching(state, (it) => ({ ...it, priority: p.level }));
    }
    case 'DISMISS_MATCHING': return mapMatching(state, (it) => ({ ...it, status: 'dismissed' }));
    case 'PROMOTE_MATCHING': return mapMatching(state, (it) => ({ ...it, status: 'promoted' }));
    default: return fail(`unknown command "${cmd.type}"`);
  }
}

// --- bus ------------------------------------------------------------------

export function createBus(items) {
  let state = initialState(items);
  const log = [];
  const undoStack = [];
  const subscribers = new Set();

  const notify = () => subscribers.forEach((fn) => fn(state, log));

  /** Returns {ok, affected} or {ok:false, reason}. Never throws on bad input. */
  function dispatch(cmd) {
    if (cmd.type === 'UNDO') {
      if (undoStack.length === 0) return { ok: false, reason: 'nothing to undo' };
      state = undoStack.pop();
      log.push({ ...cmd, ts: Date.now(), affected: 0 });
      notify();
      return { ok: true, affected: 0 };
    }
    const result = reduce(state, cmd);
    if (result.error) return { ok: false, reason: result.error };
    undoStack.push(state);
    state = result.state;
    log.push({ type: cmd.type, payload: cmd.payload ?? {}, ts: Date.now(), affected: result.affected });
    notify();
    return { ok: true, affected: result.affected };
  }

  return {
    dispatch,
    getState: () => state,
    getLog: () => log,
    subscribe: (fn) => { subscribers.add(fn); return () => subscribers.delete(fn); },
  };
}

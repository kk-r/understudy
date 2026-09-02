import { loadItems } from './data.js';
import {
  createBus, matching, sorted,
  FILTER_FIELDS, SORT_FIELDS, PRIORITIES,
} from './commands.js';
import { describe } from './trace.js';
import { createSkills, clearStored } from './skills.js';
import { install, isAvailable } from './webmcp.js';
import { echo } from './echo.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ?reset wipes learned skills before anything loads. Repeated demo takes need a clean
// slate, and there is no devtools console in an embedded browser to do it by hand.
if (new URLSearchParams(location.search).has('reset')) {
  clearStored();
  const u = new URL(location.href);
  u.searchParams.delete('reset');
  history.replaceState(null, '', u.pathname + u.search);
}

const { items, source, live } = await loadItems();
const bus = createBus(items);
const skills = createSkills(bus);

// Everything the UI does goes through here, so every user action lands in the
// command log exactly the way an agent-invoked action would.
function run(type, payload = {}) {
  const res = bus.dispatch({ type, payload });
  if (!res.ok) flash(res.reason);
  return res;
}

let flashTimer;
function flash(msg) {
  const el = $('rec-state');
  el.textContent = msg;
  el.style.color = 'var(--bad)';
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { el.style.color = ''; renderTrace(bus.getState(), bus.getLog()); }, 2600);
}

// --- controls -------------------------------------------------------------

$('stat-source').innerHTML = `${esc(source)} &middot; ${items.length} items` +
  (live ? ' &middot; <a href="./">use snapshot</a>' : ' &middot; <a href="./?live=1">load live feed</a>');

for (const f of Object.keys(FILTER_FIELDS)) $('f-field').add(new Option(f, f));
for (const f of SORT_FIELDS) $('s-field').add(new Option(f, f));

function syncOps() {
  const ops = FILTER_FIELDS[$('f-field').value].ops;
  $('f-op').replaceChildren(...ops.map((o) => new Option(o, o)));
}
$('f-field').onchange = syncOps;
syncOps();

const addFilter = () => {
  const field = $('f-field').value;
  const raw = $('f-value').value.trim();
  const value = FILTER_FIELDS[field].type === 'number' ? Number(raw) : raw;
  if (run('SET_FILTER', { field, op: $('f-op').value, value }).ok) $('f-value').value = '';
};
$('f-add').onclick = addFilter;
$('f-value').onkeydown = (e) => { if (e.key === 'Enter') addFilter(); };
$('f-clear').onclick = () => run('CLEAR_FILTERS');

const applySort = () => run('SET_SORT', { field: $('s-field').value, dir: $('s-dir').value });
$('s-field').onchange = applySort;
$('s-dir').onchange = applySort;

const tagValue = () => $('a-tag').value.trim();
$('a-tag-add').onclick = () => { if (run('TAG_MATCHING', { tag: tagValue() }).ok) $('a-tag').value = ''; };
$('a-tag-remove').onclick = () => run('UNTAG_MATCHING', { tag: tagValue() });
$('a-tag').onkeydown = (e) => { if (e.key === 'Enter') $('a-tag-add').click(); };

for (const btn of document.querySelectorAll('[data-priority]')) {
  btn.onclick = () => run('SET_PRIORITY_MATCHING', { level: btn.dataset.priority || null });
}
$('a-promote').onclick = () => run('PROMOTE_MATCHING');
$('a-dismiss').onclick = () => run('DISMISS_MATCHING');
$('a-undo').onclick = () => run('UNDO');

// --- render ---------------------------------------------------------------

function renderChips(state) {
  const box = $('chips');
  if (state.filters.length === 0) {
    box.innerHTML = '<span class="empty">no filters &mdash; all items</span>';
    return;
  }
  box.replaceChildren(...state.filters.map((f) => {
    const el = document.createElement('span');
    el.className = 'chip';
    el.innerHTML = `${esc(f.field)} ${esc(f.op)} ${esc(f.value)} <button title="remove">&times;</button>`;
    el.querySelector('button').onclick = () => run('REMOVE_FILTER', { field: f.field });
    return el;
  }));
}

function renderList(state) {
  const rows = sorted(matching(state), state.sort);
  if (rows.length === 0) {
    $('list').innerHTML = '<div class="empty-state">Nothing matches the current filters.</div>';
    return;
  }
  $('list').innerHTML = rows.slice(0, 200).map((it) => `
    <div class="item ${it.status === 'dismissed' ? 'dismissed' : ''}">
      <div class="score"><b>${it.points}</b>${it.comments}c</div>
      <div>
        <div class="title">${it.url ? `<a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a>` : esc(it.title)}</div>
        <div class="meta"><span>${esc(it.author)}</span><span>&middot;</span><span>${esc((it.createdAt || '').slice(0, 10))}</span></div>
      </div>
      <div class="badges">
        ${it.status !== 'inbox' ? `<span class="badge s-${it.status}">${it.status}</span>` : ''}
        ${it.priority ? `<span class="badge p-${it.priority}">${it.priority}</span>` : ''}
        ${it.tags.map((t) => `<span class="badge tag">${esc(t)}</span>`).join('')}
      </div>
    </div>`).join('') + (rows.length > 200 ? `<div class="empty-state">+${rows.length - 200} more not shown</div>` : '');
}

function renderStats(state) {
  $('stat-matching').textContent = matching(state).length;
  $('stat-inbox').textContent = state.items.filter((i) => i.status === 'inbox').length;
  $('stat-done').textContent = state.items.filter((i) => i.status !== 'inbox').length;
}

function renderTrace(state, log) {
  $('rec-state').textContent = `${log.length} command${log.length === 1 ? '' : 's'}`;
  if (log.length === 0) {
    $('trace').innerHTML = '<div class="empty-state">Do something. Every action you take is recorded here as a command.</div>';
    return;
  }
  $('trace').innerHTML = log.map((entry, i) => `
    <div class="step">
      <div class="n">${i + 1}</div>
      <div>
        <div class="what">${describe(entry)}</div>
        ${entry.affected ? `<div class="eff">${entry.affected} item${entry.affected === 1 ? '' : 's'} affected</div>` : ''}
      </div>
    </div>`).join('');
  $('trace').scrollTop = $('trace').scrollHeight;
}

function render(state, log) {
  renderChips(state);
  renderList(state);
  renderStats(state);
  renderTrace(state, log);
}

bus.subscribe(render);
render(bus.getState(), bus.getLog());

// --- recording ------------------------------------------------------------

$('rec-toggle').onclick = () => {
  const res = skills.isRecording() ? skills.stopRecording() : skills.startRecording();
  if (!res.ok) flash(res.reason);
  renderRec();
};

function renderRec() {
  const on = skills.isRecording();
  $('rec-toggle').textContent = on ? 'Done' : 'Teach';
  $('rec-toggle').className = on ? '' : 'primary';
  $('rec-bar').className = on ? 'bar on' : 'bar';
  $('rec-state').innerHTML = on
    ? `<span class="rec-dot"></span> teaching &mdash; ${skills.recordedSoFar()} step(s). Do the routine, then press Done.`
    : `<span class="muted">${bus.getLog().length} command(s) this session</span>`;
}

/**
 * Ask for a value inline, in place of `anchor`.
 *
 * Native prompt()/confirm() are unusable here: embedded browsers -- ChatGPT's in-app
 * browser among them -- silently no-op them, so a dialog-driven control just does
 * nothing. Everything the user has to type is asked for in the page itself.
 */
function ask(anchor, { label, value = '', size = 14 }) {
  return new Promise((resolve) => {
    const form = document.createElement('span');
    form.className = 'ask-inline';
    form.innerHTML = `<input size="${size}" placeholder="${esc(label)}" aria-label="${esc(label)}">` +
                     `<button class="primary">OK</button><button>Cancel</button>`;
    const input = form.querySelector('input');
    const [okBtn, cancelBtn] = form.querySelectorAll('button');
    const done = (v) => { if (form.isConnected) form.replaceWith(anchor); resolve(v); };
    okBtn.onclick = () => done(input.value.trim() || null);
    cancelBtn.onclick = () => done(null);
    input.onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); done(input.value.trim() || null); }
      if (e.key === 'Escape') { e.preventDefault(); done(null); }
    };
    anchor.replaceWith(form);
    input.value = value;
    input.focus();
    input.select();
  });
}

// --- skills panel ---------------------------------------------------------

function renderSkills() {
  const list = skills.listSkills();
  const pending = skills.listUnlearnedRecordings();
  $('skill-count').textContent = list.length ? `(${list.length})` : '';
  if (list.length === 0 && pending.length === 0) {
    $('skills').innerHTML = '<div class="empty-state">No skills yet.<br><br>Press <b>Teach</b>, do a routine by hand, press <b>Done</b>, then ask your agent to learn it.</div>';
    return;
  }
  const children = [...pending.map(renderRecordingCard), ...list.map(renderSkillCard)];
  if (list.length) children.push(renderClearAll());
  $('skills').replaceChildren(...children);
}

/** Two-click wipe of everything learned, matching the per-skill delete. */
function renderClearAll() {
  const row = document.createElement('div');
  row.className = 'row';
  row.style.justifyContent = 'flex-end';
  const btn = document.createElement('button');
  btn.textContent = 'Clear all skills';
  let t;
  const disarm = () => { clearTimeout(t); if (btn.isConnected) { btn.dataset.armed = ''; btn.classList.remove('danger'); btn.textContent = 'Clear all skills'; } };
  btn.onclick = () => {
    if (btn.dataset.armed) { disarm(); skills.clearAll(); flash('All learned skills cleared.'); return; }
    btn.dataset.armed = '1';
    btn.classList.add('danger');
    btn.textContent = 'Clear everything?';
    t = setTimeout(disarm, 8000);
  };
  row.appendChild(btn);
  return row;
}

/**
 * A recording is not yet a skill. Turning one into a skill is the agent's job --
 * it reads the demonstration and decides which values are parameters. But the app
 * has to stay coherent for someone without a WebMCP client, so the recording is
 * shown with what it captured and a manual path: create it with no parameters,
 * then promote the values you want using the same control the agent's choices use.
 */
function renderRecordingCard(rec) {
  const el = document.createElement('div');
  el.className = 'rec';
  el.innerHTML = `
    <h3>You taught &middot; ${rec.steps.length} step${rec.steps.length === 1 ? '' : 's'}</h3>
    <ol>${rec.steps.map((st) => `<li>${describe(st)}${st.affected ? ` <span class="muted">(${st.affected})</span>` : ''}</li>`).join('')}</ol>
    <div class="ask">Ask your agent: <b>&ldquo;Look at what I just did and turn it into a reusable skill.&rdquo;</b></div>
    <div class="row"><button data-make>Create it myself instead</button></div>`;
  el.querySelector('[data-make]').onclick = async (ev) => {
    const btn = ev.currentTarget;
    const name = await ask(btn, { label: 'skill name', value: 'my_routine', size: 18 });
    if (!name) return;
    const res = skills.saveSkill({
      recordingId: rec.id, name,
      description: `${rec.steps.length}-step routine demonstrated by hand.`,
      params: [],
    });
    if (!res.ok) flash(res.reason);
    else flash('Created with no parameters — promote the values you want below.');
  };
  return el;
}

function renderSkillCard(skill) {
  const el = document.createElement('div');
  el.className = `skill ${skill.approved ? '' : 'pending'}`;
  const schema = skills.schemaFor(skill);
  el.innerHTML = `
    <h3>${esc(skill.name)}(${skill.params.map((p) => esc(p.name)).join(', ')})</h3>
    <div class="desc">${esc(skill.description)}</div>
    ${skill.params.map((p, i) => `
      <div class="param">
        <code>${esc(p.name)}</code>
        <span class="src">${esc(p.type)} &middot; step ${p.stepIndex} &rarr; ${esc(p.fieldPath)}
          <button data-unbind="${i}" title="make this a fixed value again">unbind</button></span>
      </div>`).join('')}
    <div class="unbound"></div>
    <div class="row">
      <span class="status ${skill.approved ? 'live' : 'pending'}">${skill.approved ? 'approved &middot; registered as a tool' : 'awaiting your approval'}</span>
      <span style="flex:1"></span>
      ${skill.approved ? '<button data-act="revoke">Revoke</button>' : '<button class="primary" data-act="approve">Approve</button>'}
      <button data-act="delete">Delete</button>
    </div>`;

  // let the human promote a still-hardcoded value into a parameter
  const bound = new Set(skill.params.map((p) => `${p.stepIndex}:${p.fieldPath}`));
  const candidates = [];
  skill.steps.forEach((step, stepIndex) => {
    for (const [fieldPath, value] of Object.entries(step.payload ?? {})) {
      if (value === null || typeof value === 'object') continue;
      if (bound.has(`${stepIndex}:${fieldPath}`)) continue;
      candidates.push({ stepIndex, fieldPath, value });
    }
  });
  if (candidates.length) {
    const box = el.querySelector('.unbound');
    box.innerHTML = `<div class="row"><span class="src muted">fixed:</span></div>`;
    const row = box.querySelector('.row');
    for (const c of candidates) {
      const b = document.createElement('button');
      b.innerHTML = `+ ${esc(c.fieldPath)}=<code>${esc(c.value)}</code>`;
      b.title = `step ${c.stepIndex}: make this a parameter`;
      b.onclick = async () => {
        const name = await ask(b, { label: 'parameter name', value: c.fieldPath });
        if (!name) return;
        const res = skills.updateParams(skill.name, [...skill.params, {
          name, stepIndex: c.stepIndex, fieldPath: c.fieldPath,
          type: typeof c.value === 'number' ? 'number' : 'string',
          description: `value for ${c.fieldPath}`,
        }]);
        if (!res.ok) flash(res.reason);
      };
      row.appendChild(b);
    }
  }

  el.querySelectorAll('[data-unbind]').forEach((b) => {
    b.onclick = () => skills.updateParams(skill.name, skill.params.filter((_, i) => i !== +b.dataset.unbind));
  });
  el.querySelector('[data-act="approve"]')?.addEventListener('click', () => skills.approveSkill(skill.name, true));
  el.querySelector('[data-act="revoke"]')?.addEventListener('click', () => skills.approveSkill(skill.name, false));
  // Two-click confirm rather than confirm(), which embedded browsers no-op. The arm
  // window is deliberately long: this is a control you are meant to stop and think
  // about, and a short timeout makes the second click silently re-arm instead of
  // deleting, so the button looks broken.
  const del = el.querySelector('[data-act="delete"]');
  let armTimer;
  const disarm = () => {
    clearTimeout(armTimer);
    document.removeEventListener('click', outside, true);
    if (!del.isConnected) return;
    delete del.dataset.armed;
    del.classList.remove('danger');
    del.textContent = 'Delete';
  };
  function outside(e) { if (e.target !== del) disarm(); }
  del.onclick = () => {
    if (del.dataset.armed) {
      disarm();
      const res = skills.deleteSkill(skill.name);
      if (!res.ok) flash(res.reason);
      return;
    }
    del.dataset.armed = '1';
    del.classList.add('danger');
    del.textContent = 'Delete for good?';
    armTimer = setTimeout(disarm, 8000);
    setTimeout(() => document.addEventListener('click', outside, true), 0);
  };
  return el;
}

// --- tabs -----------------------------------------------------------------

for (const [tab, pane] of [['tab-trace', 'pane-trace'], ['tab-skills', 'pane-skills']]) {
  $(tab).onclick = () => {
    for (const [t, p] of [['tab-trace', 'pane-trace'], ['tab-skills', 'pane-skills']]) {
      $(t).classList.toggle('active', t === tab);
      $(p).hidden = p !== pane;
    }
  };
}

// --- agent replay ---------------------------------------------------------

$('pace').value = String(skills.getPace());
$('pace').onchange = () => skills.setPace(+$('pace').value);

let runClear;
skills.onProgress(async ({ skill, step, total, did, running, failed, command, budgetMs }) => {
  const box = $('agent-run');
  box.hidden = false;
  box.className = failed ? 'failed' : '';
  box.innerHTML = `
    <div class="who">${esc(skill)} &middot; step ${step + 1} of ${total}${failed ? ' — failed' : ''}</div>
    ${did ? `<div class="doing">${describe({ type: 'NOOP' }) && ''}${esc(did)}</div>` : ''}
    <div class="track">${Array.from({ length: total }, (_, i) =>
      `<i class="${i < step ? 'done' : i === step ? (running ? 'now' : 'done') : ''}"></i>`).join('')}</div>`;
  $('list').classList.remove('agent-touched');
  void $('list').offsetWidth;
  $('list').classList.add('agent-touched');
  clearTimeout(runClear);
  if (!running) { runClear = setTimeout(() => { box.hidden = true; }, failed ? 9000 : 3500); return; }
  // show the step happening in the controls, then let the replayer apply it
  if (command && budgetMs > 0) await echo(command, budgetMs);
});

// --- WebMCP ---------------------------------------------------------------

skills.subscribe(() => { renderSkills(); renderRec(); });
bus.subscribe(renderRec);
renderSkills();
renderRec();

if (isAvailable()) {
  let clear;
  const { ok, metaTools } = await install(skills, (tool, result) => {
    $('agent-activity').textContent = `agent: ${tool}${result?.ok === false ? ' \u2717' : ''}`;
    clearTimeout(clear);
    clear = setTimeout(() => { $('agent-activity').textContent = ''; }, 6000);
    if (tool === 'start_recording' || tool === 'stop_recording') renderRec();
  });
  $('stat-webmcp').textContent = ok ? `WebMCP: ${metaTools.length} tools` : 'WebMCP install failed';
} else {
  $('stat-webmcp').textContent = 'no WebMCP';
}

// exposed for the console and for testing
window.understudy = { bus, skills };

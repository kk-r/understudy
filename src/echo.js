// Replaying a skill dispatches commands straight to the bus, so the workspace
// changes but the controls never move -- the agent's work looks like magic.
//
// This module echoes each command back through the controls it corresponds to:
// fills the selects, types the value, flashes the button that would have been
// pressed. It is strictly presentational. Nothing here dispatches, and setting
// .value fires no events, so the real handlers never run. The command stays the
// source of truth; the UI is just showing its work.

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function type(el, value, budget) {
  if (!el) return;
  const s = String(value);
  const per = Math.max(12, Math.min(45, budget / Math.max(s.length, 1)));
  el.value = '';
  el.classList.add('echo-focus');
  for (const ch of s) { el.value += ch; await sleep(per); }
  el.classList.remove('echo-focus');
}

async function press(el, hold = 260) {
  if (!el) return;
  el.classList.add('echo-press');
  await sleep(hold);
  el.classList.remove('echo-press');
}

function set(el, value) { if (el) { el.value = String(value); el.classList.add('echo-focus'); } }
function unset(...els) { for (const el of els) el?.classList.remove('echo-focus'); }

/**
 * Show `cmd` happening in the controls. Resolves when the gesture is done;
 * the caller applies the command afterwards. `budget` is roughly how long it
 * may take, so pacing stays inside the replay's overall cap.
 */
export async function echo(cmd, budget = 600) {
  const p = cmd.payload ?? {};
  const typeBudget = budget * 0.55;

  switch (cmd.type) {
    case 'SET_FILTER': {
      set($('f-field'), p.field);
      $('f-field').dispatchEvent(new Event('change', { bubbles: true })); // repopulates the op list
      set($('f-op'), p.op);
      await type($('f-value'), p.value, typeBudget);
      await press($('f-add'));
      $('f-value').value = '';
      unset($('f-field'), $('f-op'));
      return;
    }
    case 'CLEAR_FILTERS':  return press($('f-clear'));
    case 'REMOVE_FILTER':  return press(document.querySelector('#chips .chip button'));
    case 'SET_SORT': {
      set($('s-field'), p.field); set($('s-dir'), p.dir);
      await sleep(Math.min(320, budget));
      unset($('s-field'), $('s-dir'));
      return;
    }
    case 'TAG_MATCHING':
    case 'UNTAG_MATCHING': {
      await type($('a-tag'), p.tag, typeBudget);
      await press($(cmd.type === 'TAG_MATCHING' ? 'a-tag-add' : 'a-tag-remove'));
      $('a-tag').value = '';
      return;
    }
    case 'SET_PRIORITY_MATCHING':
      return press(document.querySelector(`[data-priority="${p.level ?? ''}"]`));
    case 'DISMISS_MATCHING': return press($('a-dismiss'));
    case 'PROMOTE_MATCHING': return press($('a-promote'));
    default: return;
  }
}

// The Builder's approval panel on the twin page (Claude.md §7.2, step 8.5): each station is built in
// three phases (layout → machines → process); every phase's draft is loaded into the 3D view and shown
// here with its change diff (JSON Patch against the last approved state), its checks and its cost. The
// owner approves it, or rejects it with a comment that goes back to the Builder for that phase.
// Talks to /api/builder (server/builderApi.js); never to a model.
import { icon } from '../../ui/icon.js';

const PHASES = [['layout', 'Layout'], ['machines', 'Machines'], ['process', 'Process']];

export const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const usd = (v) => `$${Number(v ?? 0).toFixed(v > 0 && v < 0.01 ? 4 : 2)}`;
const short = (v) => {
  const text = JSON.stringify(v);
  return text === undefined ? '—' : text;
};

/** A one-line outline of a long value: scalars shown, arrays and objects by their size. */
function outline(v) {
  if (Array.isArray(v)) return `[${v.length} item${v.length === 1 ? '' : 's'}]`;
  if (v && typeof v === 'object') {
    const parts = Object.entries(v).map(([k, x]) => {
      if (Array.isArray(x)) return `${k}[${x.length}]`;
      if (x && typeof x === 'object') return `${k}{…}`;
      const s = JSON.stringify(x);
      return `${k}: ${s.length > 18 ? `${s.slice(0, 16)}…"` : s}`;
    });
    return `{ ${parts.join(', ')} }`;
  }
  return short(v);
}

/** One diff op as a row: short values inline, long ones folded. */
export function diffRow(d) {
  const sign = { add: '+', remove: '−', replace: '~' }[d.op] ?? d.op;
  const inline = (v) => {
    const t = short(v);
    return t.length <= 48 ? `<code>${esc(t)}</code>` : `<details><summary>${esc(outline(v))}</summary><pre>${esc(JSON.stringify(v, null, 2))}</pre></details>`;
  };
  const value = d.op === 'add' ? inline(d.value)
    : d.op === 'remove' ? `<s>${inline(d.from)}</s>`
    : `${inline(d.from)} <span class="bp-arrow">→</span> ${inline(d.value)}`;
  return `<li class="bp-diff__row bp-diff__row--${d.op}"><span class="bp-diff__sign">${sign}</span><span class="bp-diff__body"><span class="bp-diff__path" title="${esc(d.path)}">${esc(d.label)}</span><span class="bp-diff__value">${value}</span></span></li>`;
}

/**
 * @param {HTMLElement} host
 * @param {object} o
 * @param {(url: string | null, view: object) => Promise<void>} o.onDraft   load this draft into the 3D view
 * @param {() => void} [o.onReady]   called once the first state has been drawn (screenshots)
 */
export function BuilderPanel(host, { onDraft, onReady = null }) {
  const el = document.createElement('aside');
  el.className = 'bp';
  el.setAttribute('aria-label', 'Builder approvals');
  host.appendChild(el);

  let view = null;
  let rehearsals = [];
  let lines = { lines: [], examples: [] }; // stored lines (/api/lines), to open in the Editor
  let busy = null; // what is running ('Building the next draft…')
  let error = null;
  let rejecting = false;
  let shownUrl;
  let alive = true;

  async function api(path, body) {
    const res = await fetch(`/api/builder${path}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    if (!res.ok) {
      const e = new Error(data.error ?? `HTTP ${res.status}`);
      e.session = data.session;
      throw e;
    }
    return data;
  }

  async function act(label, path, body = {}) {
    busy = label;
    error = null;
    render();
    try {
      const data = await api(path, body);
      view = data.session;
      rejecting = false;
    } catch (e) {
      error = e.message;
      if (e.session !== undefined) view = e.session;
    }
    busy = null;
    await show();
  }

  async function show() {
    render();
    const url = view?.url ?? null;
    if (url !== shownUrl) {
      shownUrl = url;
      await onDraft(url, view);
    }
  }

  function stepper() {
    if (!view) return '';
    const stations = view.plan.map((p) => `<li class="bp-station bp-station--${p.state}" title="${esc(p.title)}">${p.state === 'approved' ? icon('Check', { size: 12 }) : ''}<span>${esc(p.title)}</span></li>`).join('');
    const current = view.gate?.phase ?? view.phase;
    const doneIdx = view.finished ? 3 : PHASES.findIndex(([k]) => k === current);
    const phases = view.finished ? '' : `<ol class="bp-phases">${PHASES.map(([k, t], i) => `<li class="bp-phase${i < doneIdx ? ' is-done' : ''}${i === doneIdx ? ' is-current' : ''}"><span>${i + 1}</span>${t}</li>`).join('')}</ol>`;
    return `<ol class="bp-stations">${stations}</ol>${phases}`;
  }

  function gateCard(g) {
    const status = g.ok
      ? `<span class="bp-status bp-status--ok">${icon('CircleCheck', { size: 14 })} Checks passed</span>`
      : `<span class="bp-status bp-status--fail">${icon('CircleAlert', { size: 14 })} Still failing after ${g.attempts.length - 1} retries</span>`;
    const retries = g.attempts.length ? `<details class="bp-block"><summary>${g.attempts.length} refusal${g.attempts.length > 1 ? 's' : ''} sent back to the model</summary><ul class="bp-list">${g.attempts.map((a) => `<li><b>${esc(a.phase)}</b> ${a.problems.map(esc).join('<br>')}</li>`).join('')}</ul></details>` : '';
    const notes = g.notes.length ? `<div class="bp-block"><h4>Placement notes</h4><ul class="bp-list">${g.notes.map((n) => `<li>${esc(n.message ?? n)}</li>`).join('')}</ul></div>` : '';
    const findings = g.findings.length ? `<div class="bp-block"><h4>Reviewer</h4><ul class="bp-list">${g.findings.map((f) => `<li class="bp-finding bp-finding--${esc(f.severity)}"><span>${esc(f.check)}</span> ${esc(f.message)}</li>`).join('')}</ul></div>` : '';
    const diff = `<div class="bp-block"><h4>Changes <span class="muted">${g.diff.length} JSON Patch op${g.diff.length === 1 ? '' : 's'} on factory.json</span></h4>${g.diff.length ? `<ul class="bp-diff">${g.diff.map(diffRow).join('')}</ul>` : '<p class="muted">No change.</p>'}</div>`;
    const reject = rejecting
      ? `<form class="bp-reject"><textarea name="comment" rows="3" placeholder="What should the Builder change in this ${esc(g.phase)} draft?" required></textarea>${view.source?.kind === 'rehearsal' ? '<p class="muted">A rehearsal replays the same answers: the comment is sent, not read.</p>' : ''}<div class="bp-actions"><button type="button" class="bp-btn bp-btn--ghost" data-act="cancel">Cancel</button><button type="submit" class="bp-btn bp-btn--warn">${icon('Send', { size: 14 })} Send back</button></div></form>`
      : `<div class="bp-actions"><button type="button" class="bp-btn bp-btn--ghost" data-act="reject">${icon('MessageSquareX', { size: 14 })} Reject…</button><button type="button" class="bp-btn bp-btn--primary" data-act="approve"${g.ok ? '' : ' disabled'}>${icon('Check', { size: 14 })} Approve ${esc(g.phase)}</button></div>`;
    return `
      <section class="bp-gate">
        <header class="bp-gate__head">
          <div><h3>${esc(g.title)} <span class="muted">· ${esc(g.phase)} draft</span></h3>
          <p class="muted">rev ${g.rev} · ${g.files.length ? `${g.files.length} files` : 'no files'} · ${usd(g.cost)}</p></div>
          ${status}
        </header>
        ${retries}${notes}${findings}${diff}
        ${reject}
      </section>`;
  }

  function render() {
    if (!alive) return;
    const src = view?.source;
    const badge = !view ? '' : src?.kind === 'rehearsal'
      ? `<span class="bp-badge" title="${esc(src.about ?? '')}">Rehearsal · scripted · $0</span>`
      : `<span class="bp-badge bp-badge--llm">OpenAI ${esc(src?.mode ?? '')}</span>`;
    let body;
    if (!view) {
      body = `
        <section class="bp-empty">
          <p>No build yet. A real build starts from an approved plan (the Spec agent, Phase 9).</p>
          <p class="muted">A rehearsal runs the whole approval flow at $0: the Builder, the placer and the reviewer are real; the model's answers are scripted from a hand-written example line.</p>
          ${rehearsals.map((r) => `<button type="button" class="bp-btn bp-btn--primary" data-act="start" data-name="${esc(r)}">${icon('Play', { size: 14 })} Rehearse: ${esc(r)}</button>`).join('')}
        </section>
        ${linesBlock()}`;
    } else if (view.gate) {
      body = gateCard(view.gate);
    } else if (view.finished) {
      body = `<section class="bp-empty"><p class="bp-done">${icon('CircleCheck', { size: 16 })} Every planned station is built and approved (${view.plan.length}).</p><p class="muted">The approved line is in the 3D view. Save it to keep it as lines/${esc(view.line.id)}/factory.json (version 1) and edit it in plain words.</p><div class="bp-actions"><button type="button" class="bp-btn bp-btn--ghost" data-act="reset">${icon('RotateCcw', { size: 14 })} Start over</button><button type="button" class="bp-btn bp-btn--primary" data-act="save">${icon('Save', { size: 14 })} Save the line</button></div></section>`;
    } else {
      body = `<section class="bp-empty"><p>Next: the ${esc(view.phase)} of “${esc(view.plan[view.index]?.title ?? '')}”.</p><button type="button" class="bp-btn bp-btn--primary" data-act="next">${icon('Play', { size: 14 })} Build the next draft</button></section>`;
    }
    el.innerHTML = `
      <header class="bp-head">
        <div class="bp-head__title">${icon('Hammer', { size: 16 })}<span>Builder</span>${badge}</div>
        ${view ? `<span class="bp-cost" title="Spent by this build">${usd(view.cost)}</span>` : ''}
      </header>
      ${view ? `<p class="bp-line">${esc(view.line.title)}</p>` : ''}
      ${stepper()}
      ${error ? `<p class="bp-error" role="alert">${icon('TriangleAlert', { size: 14 })} ${esc(error)}</p>` : ''}
      ${busy ? `<p class="bp-busy" role="status"><span class="bp-spin"></span>${esc(busy)}</p>` : ''}
      <div class="bp-body${busy ? ' is-busy' : ''}">${body}</div>
      ${view?.log?.length ? `<details class="bp-log"><summary>History (${view.log.length})</summary><ol>${view.log.slice().reverse().map((l) => `<li><span>${esc(l.station ?? '')}</span> ${esc(l.phase ?? '')} <b>${esc(l.action)}</b>${l.comment ? ` “${esc(l.comment)}”` : ''}</li>`).join('')}</ol></details>` : ''}
      ${view && !view.finished ? `<footer class="bp-foot"><button type="button" class="bp-link" data-act="reset">Discard this build</button></footer>` : ''}`;
    const ta = el.querySelector('textarea');
    if (ta) ta.focus();
  }

  /** Stored lines to open in the Editor, and examples to copy for editing. */
  function linesBlock() {
    const stored = lines.lines.length ? `<ul class="bp-list bp-lines">${lines.lines.map((l) => `<li><a href="#/twin?edit=${esc(l.id)}">${icon('PencilRuler', { size: 13 })} ${esc(l.title)}</a> <span class="muted">${esc(l.id)} · v${l.version} · ${l.stations} stations</span></li>`).join('')}</ul>` : '<p class="muted">No saved lines yet.</p>';
    const copy = lines.examples.length ? `<form class="bp-copy" data-form="copy"><select name="example">${lines.examples.map((x) => `<option>${esc(x)}</option>`).join('')}</select><input name="id" placeholder="new id, e.g. bottlingEdit" pattern="[a-z][a-zA-Z0-9]*" required><button type="submit" class="bp-btn bp-btn--ghost">${icon('Copy', { size: 14 })} Copy to edit</button></form>` : '';
    return `<section class="bp-block bp-saved"><h4>Saved lines · edit in plain words</h4>${stored}${copy}</section>`;
  }

  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || busy) return;
    const a = b.dataset.act;
    if (a === 'save') {
      busy = 'Saving the line…';
      render();
      fetch('/api/builder/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then((r) => r.json()).then((d) => {
        busy = null;
        if (d.saved) location.hash = `#/twin?edit=${d.saved.id}`;
        else { error = d.error ?? 'not saved'; render(); }
      });
      return;
    }
    if (a === 'start') act('Building the first draft…', '/start', { rehearsal: b.dataset.name });
    else if (a === 'approve') act(view.gate.done && view.index + 1 >= view.plan.length ? 'Approving…' : 'Approved · building the next draft…', '/approve');
    else if (a === 'reject') { rejecting = true; render(); }
    else if (a === 'cancel') { rejecting = false; render(); }
    else if (a === 'next') act('Building the next draft…', '/next');
    else if (a === 'reset' && confirm('Discard this build? Its approved stations are forgotten.')) act('Discarding…', '/reset');
  });
  el.addEventListener('submit', (e) => {
    e.preventDefault();
    if (e.target.dataset.form === 'copy') {
      const f = new FormData(e.target);
      busy = 'Copying the example…';
      render();
      fetch('/api/lines/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ example: f.get('example'), id: f.get('id') }) }).then((r) => r.json()).then((d) => {
        busy = null;
        if (d.line) location.hash = `#/twin?edit=${d.line.id}`;
        else { error = d.error ?? 'not copied'; render(); }
      });
      return;
    }
    const comment = new FormData(e.target).get('comment');
    if (String(comment).trim()) act('Sent back · rebuilding this phase…', '/reject', { comment });
  });

  api('')
    .then(async (data) => {
      view = data.session;
      rehearsals = data.rehearsals ?? [];
      lines = await fetch('/api/lines').then((r) => r.json()).catch(() => lines);
    })
    .catch((e) => { error = `The Builder API is not there (${e.message}): run the dev server.`; })
    .then(show)
    .then(() => onReady?.());

  return {
    dispose() {
      alive = false;
      el.remove();
    },
  };
}

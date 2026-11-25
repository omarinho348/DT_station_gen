// The Editor panel on the twin page (Claude.md §7.4, step 10.4): the owner asks for a change in plain
// words; the Editor's JSON Patch comes back checked (schema, reviewer, a played run) and is shown as a
// diff with its findings; Apply saves it as a new version of lines/<id>/factory.json and recompiles (the
// changed files reload the page), Discard drops it (with a comment: the Editor tries again with it).
// The history lists every version; Undo saves the previous one again. Talks to /api/lines only.
import { icon } from '../../ui/icon.js';
import { esc, usd, diffRow } from './BuilderPanel.js';

const BY = { owner: 'you', builder: 'Builder', editor: 'Editor', undo: 'undo' };

/**
 * @param {HTMLElement} host
 * @param {object} o
 * @param {string} o.id           the line id in lines/
 * @param {() => void} [o.onReady]
 */
export function EditorPanel(host, { id, onReady = null }) {
  const el = document.createElement('aside');
  el.className = 'bp ep';
  el.setAttribute('aria-label', 'Editor');
  host.appendChild(el);
  let view = null;
  let busy = null;
  let error = null;
  let discarding = false;
  let alive = true;

  async function api(path, body) {
    const res = await fetch(`/api/lines/${id}${path}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    if (!res.ok) throw Object.assign(new Error(data.error ?? `HTTP ${res.status}`), { view: data.line ? data : null });
    return data;
  }
  async function act(label, path, body = {}) {
    busy = label;
    error = null;
    render();
    try {
      view = await api(path, body);
      discarding = false;
      // A saved version rewrote compiled files: Vite reloads the page with the new line.
      if (view.saved) busy = `Version ${view.saved.version} saved · reloading the line…`;
      else busy = null;
    } catch (e) {
      error = e.message;
      if (e.view) view = e.view;
      busy = null;
    }
    render();
  }

  function pendingCard(p) {
    const status = p.questions?.length && !p.diff.length
      ? `<span class="bp-status">${icon('MessageCircleQuestion', { size: 14 })} Questions</span>`
      : p.ok ? `<span class="bp-status bp-status--ok">${icon('CircleCheck', { size: 14 })} Checks passed</span>`
        : `<span class="bp-status bp-status--fail">${icon('CircleAlert', { size: 14 })} Still failing</span>`;
    const findings = (p.findings ?? []).length ? `<div class="bp-block"><h4>Reviewer <span class="muted">on the changed line (earlier warnings included)</span></h4><ul class="bp-list">${p.findings.map((f) => `<li class="bp-finding bp-finding--${esc(f.severity)}"><span>${esc(f.check)}</span> ${esc(f.message)}</li>`).join('')}</ul></div>` : '';
    const problems = !p.ok && p.problems?.length ? `<div class="bp-block"><h4>Refused ${p.retries} times</h4><ul class="bp-list">${p.problems.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '';
    const questions = p.questions?.length ? `<div class="bp-block"><h4>The Editor asks</h4><ol class="bp-list">${p.questions.map((q) => `<li>${esc(q)}</li>`).join('')}</ol></div>` : '';
    const diff = p.diff?.length ? `<div class="bp-block"><h4>Changes <span class="muted">${p.diff.length} JSON Patch op${p.diff.length === 1 ? '' : 's'} on factory.json</span></h4><ul class="bp-diff">${p.diff.map(diffRow).join('')}</ul></div>` : '';
    const actions = discarding
      ? `<form class="bp-reject" data-form="discard"><textarea name="comment" rows="2" placeholder="Optional: what should the Editor do instead? (empty: just discard)"></textarea><div class="bp-actions"><button type="button" class="bp-btn bp-btn--ghost" data-act="cancel">Cancel</button><button type="submit" class="bp-btn bp-btn--warn">${icon('Send', { size: 14 })} Discard</button></div></form>`
      : `<div class="bp-actions"><button type="button" class="bp-btn bp-btn--ghost" data-act="discard">${icon('X', { size: 14 })} Discard…</button>${p.ok && p.diff?.length ? `<button type="button" class="bp-btn bp-btn--primary" data-act="apply">${icon('Check', { size: 14 })} Apply</button>` : ''}</div>`;
    return `<section class="bp-gate">
      <header class="bp-gate__head"><div><h3>${esc(p.summary || 'Proposed change')}</h3><p class="muted">“${esc(p.request)}” · on version ${p.baseVersion} · ${usd(p.cost)}${p.retries ? ` · ${p.retries} refusal${p.retries > 1 ? 's' : ''}` : ''}</p></div>${status}</header>
      ${questions}${problems}${findings}${diff}${actions}
    </section>`;
  }

  function critiqueBlock(c) {
    if (!c) return `<section class="bp-block ep-review"><h4>Reviewer</h4><p class="muted">An engineer's read of the line against its brief (after the checks pass): a model call.</p><button type="button" class="bp-btn bp-btn--ghost" data-act="critique">${icon('ShieldCheck', { size: 14 })} Ask the Reviewer</button></section>`;
    if (c.skipped) return `<section class="bp-block ep-review"><h4>Reviewer</h4><p class="bp-error">${esc(c.skipped)}</p></section>`;
    const verdict = { fits: ['CircleCheck', 'bp-status--ok', 'Fits the brief'], concerns: ['CircleAlert', '', 'Concerns'], misfit: ['CircleX', 'bp-status--fail', 'Misses the brief'] }[c.verdict] ?? ['Circle', '', c.verdict];
    return `<section class="bp-block ep-review">
      <h4>Reviewer <span class="muted">on version ${c.version}${c.stale ? ' (the line changed since)' : ''}${c.withBrief ? ' · against its brief' : ' · no brief'}${c.withKpis ? ' · with SimPy KPIs' : ''} · ${usd(c.cost)}</span></h4>
      <p><span class="bp-status ${verdict[1]}">${icon(verdict[0], { size: 14 })} ${verdict[2]}</span> ${esc(c.summary)}</p>
      ${c.issues.length ? `<ol class="bp-list ep-issues">${c.issues.map((i, k) => `<li><b class="ep-sev ep-sev--${esc(i.severity)}">${esc(i.severity)}</b>${i.station ? ` <span class="muted">${esc(i.station)}</span>` : ''} ${esc(i.issue)}${i.request && !view.pending ? `<br><button type="button" class="bp-link" data-issue="${k}">${icon('PencilRuler', { size: 12 })} Propose: “${esc(i.request)}”</button>` : ''}</li>`).join('')}</ol>` : ''}
      <button type="button" class="bp-btn bp-btn--ghost" data-act="critique">${icon('RotateCcw', { size: 14 })} Ask again</button>
    </section>`;
  }

  function render() {
    if (!alive) return;
    const l = view?.line;
    const history = view?.history ?? [];
    el.innerHTML = `
      <header class="bp-head">
        <div class="bp-head__title">${icon('PencilRuler', { size: 16 })}<span>Editor</span>${l ? `<span class="bp-badge">version ${l.version}</span>` : ''}</div>
        <span class="ep-links">${l ? `<a class="bp-link" href="/api/lines/${esc(l.id)}/zip" download="${esc(l.id)}.zip" title="factory.json, history, compiled files, SimPy model and results, SDD documents">${icon('Download', { size: 14 })} .zip</a>` : ''}
        <a class="bp-link" href="#/twin" title="Back to the Builder">${icon('Hammer', { size: 14 })} Builder</a></span>
      </header>
      ${l ? `<p class="bp-line">${esc(l.title)} <span class="muted">· ${l.stations} stations · lines/${esc(l.id)}/</span></p>` : ''}
      ${error ? `<p class="bp-error" role="alert">${icon('TriangleAlert', { size: 14 })} ${esc(error)}</p>` : ''}
      ${busy ? `<p class="bp-busy" role="status"><span class="bp-spin"></span>${esc(busy)}</p>` : ''}
      <div class="bp-body${busy ? ' is-busy' : ''}">
        ${view?.pending ? pendingCard(view.pending) : `<form class="bp-reject ep-ask" data-form="propose">
          <textarea name="request" rows="3" placeholder="Say what to change, e.g. “make Capping 1 s faster”, “run 12 bottles”, “rename Inspection to Vision check”"${l ? '' : ' disabled'}></textarea>
          <div class="bp-actions"><button type="submit" class="bp-btn bp-btn--primary"${l ? '' : ' disabled'}>${icon('Sparkles', { size: 14 })} Propose a change</button></div>
          <p class="muted ep-note">The Editor answers with a patch on factory.json; it is checked and played before you see it, and nothing changes until you apply it.</p>
        </form>`}
      </div>
      ${l && !busy ? critiqueBlock(view.critique) : ''}
      ${history.length ? `<details class="bp-log ep-history" open><summary>History (${history.length})</summary><ol>${history.map((h) => `<li><span>v${h.version}</span> <b>${esc(BY[h.by] ?? h.by)}</b> ${esc(h.message)}${h.ops ? ` <span>· ${h.ops} op${h.ops === 1 ? '' : 's'}</span>` : ''}</li>`).join('')}</ol>
        ${l && l.version > 1 && !view.pending ? `<button type="button" class="bp-btn bp-btn--ghost ep-undo" data-act="undo">${icon('Undo2', { size: 14 })} Undo version ${l.version}</button>` : ''}</details>` : ''}`;
  }

  el.addEventListener('click', (e) => {
    const issue = e.target.closest('[data-issue]');
    if (issue && !busy) {
      const req = view?.critique?.issues?.[Number(issue.dataset.issue)]?.request;
      if (req) act('The Editor is writing a patch · checking it…', '/propose', { request: req });
      return;
    }
    const b = e.target.closest('[data-act]');
    if (!b || busy) return;
    const a = b.dataset.act;
    if (a === 'apply') act('Applying · saving a new version…', '/apply');
    else if (a === 'critique') act('The Reviewer is reading the line against its brief…', '/critique');
    else if (a === 'discard') { discarding = true; render(); }
    else if (a === 'cancel') { discarding = false; render(); }
    else if (a === 'undo') act('Undoing…', '/undo');
  });
  el.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    if (e.target.dataset.form === 'propose') {
      const request = String(f.get('request') ?? '').trim();
      if (request) act('The Editor is writing a patch · checking it…', '/propose', { request });
    } else if (e.target.dataset.form === 'discard') {
      const comment = String(f.get('comment') ?? '').trim();
      act(comment ? 'Discarded · the Editor tries again…' : 'Discarding…', '/discard', comment ? { comment } : {});
    }
  });

  api('')
    .then((data) => { view = data; })
    .catch((e) => { error = e.message; })
    .then(() => { render(); onReady?.(); });

  return { dispose() { alive = false; el.remove(); } };
}

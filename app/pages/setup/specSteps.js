// The setup page's Spec steps (Phase 9 step 4): 2 Brief (chat, guided questions, a template or an
// uploaded .md, all sent to the Spec agent; its follow-up questions answered in the chat), 3 Documents
// (constitution, brief and plan rendered as markdown, each approved or rejected with a comment) and
// 4 Build (the approved plan handed to the Builder, then the twin page). Talks to /api/spec and
// /api/builder; never to a model.
import { icon } from '../../ui/icon.js';
import { href } from '../../router.js';
import { markdownToHtml } from '../../ui/markdown.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const usd = (v) => `$${Number(v ?? 0).toFixed(v > 0 && v < 0.01 ? 4 : 2)}`;

/** Shared state of the Spec steps for one visit of the setup page. */
export function createSpecStore() {
  const listeners = new Set();
  const st = { session: null, templates: [], busy: null, error: null, loaded: false, method: 'chat', open: {} };
  const emit = () => listeners.forEach((fn) => fn(st));

  async function api(path, body) {
    const res = await fetch(`/api/spec${path}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    if (!res.ok) throw Object.assign(new Error(data.error ?? `HTTP ${res.status}`), { session: data.session });
    return data;
  }

  return {
    st,
    subscribe(fn) { listeners.add(fn); fn(st); return () => listeners.delete(fn); },
    set(patch) { Object.assign(st, patch); emit(); },
    async load() {
      try {
        const data = await api('');
        Object.assign(st, { session: data.session, templates: data.templates ?? [], loaded: true });
      } catch (e) {
        Object.assign(st, { error: `The Spec API is not there (${e.message}): run the dev server.`, loaded: true });
      }
      emit();
    },
    async act(label, path, body = {}) {
      Object.assign(st, { busy: label, error: null });
      emit();
      try {
        st.session = (await api(path, body)).session;
      } catch (e) {
        st.error = e.message;
        if (e.session) st.session = e.session;
      }
      st.busy = null;
      emit();
      return !st.error;
    },
    async build() {
      Object.assign(st, { busy: 'Handing the plan to the Builder…', error: null });
      emit();
      try {
        const res = await fetch('/api/builder/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(st.session.job) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          // The session exists but its first draft was refused (budget, mock mode without a recording).
          throw new Error(data.session ? `The Builder started but could not draft the first station: ${data.error}. The twin page can try again.` : data.error ?? `HTTP ${res.status}`);
        }
        st.busy = null;
        location.hash = href('twin');
      } catch (e) {
        Object.assign(st, { busy: null, error: e.message });
        emit();
      }
    },
  };
}

const busyLine = (st) => (st.busy ? `<p class="spec-busy" role="status"><span class="spec-spin"></span>${esc(st.busy)}</p>` : '');
const errorLine = (st) => (st.error ? `<p class="spec-error" role="alert">${icon('TriangleAlert', { size: 14 })} ${esc(st.error)}</p>` : '');

// ---- 2 Brief ----------------------------------------------------------------------------------

const METHODS = [
  ['chat', 'MessageSquare', 'Chat', 'Describe the line in your own words'],
  ['guided', 'ListTodo', 'Guided questions', 'Answer a short questionnaire'],
  ['template', 'LayoutTemplate', 'Template', 'Start from an example line'],
  ['upload', 'Upload', 'Upload .md', 'Use a brief you already wrote'],
];

function guidedText(form) {
  const f = Object.fromEntries(new FormData(form));
  const steps = String(f.steps ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
  return [
    f.product && `Product: ${f.product}.`,
    f.size && `Size: ${f.size}.`,
    f.rate && `Target: ${f.rate} units per ${f.per}${f.per === 'shift' && f.shift ? ` (${f.shift} h shifts)` : ''}.`,
    steps.length && `Steps, in order:\n${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
    f.quality && `Quality: ${f.quality}.`,
    f.constraints && `Constraints: ${f.constraints}.`,
  ].filter(Boolean).join('\n');
}

export function mountBrief(el, store) {
  let uploaded = null;
  const render = (st) => {
    const s = st.session;
    const conv = s?.conversation ?? [];
    const brief = s?.docs.brief;
    const methods = `<div class="method-grid" role="radiogroup" aria-label="How to give the brief">${METHODS.map(([id, ic, title, text]) => `
      <button class="method${st.method === id ? ' is-selected' : ''}" role="radio" aria-checked="${st.method === id}" type="button" data-method="${id}">
        <span class="method__icon">${icon(ic, { size: 20 })}</span><span class="method__title">${title}</span><span class="method__text">${text}</span>
      </button>`).join('')}</div>`;
    let work = '';
    if (st.method === 'chat') {
      work = `<div class="card composer spec-chat">
        ${conv.length ? `<ol class="spec-thread">${conv.map((m) => `<li class="spec-msg spec-msg--${m.from}"><span class="spec-msg__who">${m.from === 'spec' ? 'Spec agent' : `You${m.source && m.source !== 'chat' ? ` · ${esc(m.source)}` : ''}`}</span><div class="spec-msg__text">${esc(m.text.length > 600 ? `${m.text.slice(0, 600)}…` : m.text)}</div></li>`).join('')}</ol>` : ''}
        <form data-form="chat"><textarea name="text" rows="${conv.length ? 3 : 6}" placeholder="${conv.length ? 'Answer the questions, or add anything the brief should know…' : 'Example: We bottle apple juice in 1 L glass bottles, 240 an hour: fill, cap, label, inspect.'}"></textarea>
        <div class="composer__bar"><span class="hint">${icon('Sparkles', { size: 14 })} The Spec agent writes the brief and asks when something is missing.</span>
        <button class="btn btn--primary" type="submit"${st.busy ? ' disabled' : ''}>${icon('Send', { size: 16 })} Send to Spec</button></div></form></div>`;
    } else if (st.method === 'guided') {
      work = `<form class="card spec-guided" data-form="guided">
        <label>What do you make?<input name="product" placeholder="Apple juice in glass bottles" required></label>
        <label>Its size<input name="size" placeholder="1 L bottle, 90 mm across, 260 mm tall"></label>
        <div class="spec-row"><label>How many<input name="rate" type="number" min="1" placeholder="240" required></label>
        <label>per<select name="per"><option value="hour">hour</option><option value="shift">shift</option><option value="day">day</option></select></label>
        <label>Shift length (h)<input name="shift" type="number" min="1" max="24" placeholder="8"></label></div>
        <label>What happens to it, one step per line<textarea name="steps" rows="5" placeholder="Fill with juice&#10;Screw on the cap&#10;Label&#10;Camera check, bad ones off the line" required></textarea></label>
        <label>Quality checks (optional)<input name="quality" placeholder="A camera checks fill level and cap"></label>
        <label>Constraints (optional)<input name="constraints" placeholder="Food grade, little floor space"></label>
        <div class="composer__bar"><span class="hint">Your answers are sent to the Spec agent as one message.</span><button class="btn btn--primary" type="submit"${st.busy ? ' disabled' : ''}>${icon('Send', { size: 16 })} Send to Spec</button></div>
      </form>`;
    } else if (st.method === 'template') {
      work = `<div class="spec-templates">${st.templates.map((t) => `<article class="card spec-template"><h3>${esc(t.title)}</h3><p>${esc(t.text.replace(/^#.*\n+/, '').slice(0, 220))}…</p><button class="btn btn--ghost" type="button" data-template="${esc(t.name)}"${st.busy ? ' disabled' : ''}>${icon('LayoutTemplate', { size: 16 })} Use this brief</button></article>`).join('') || '<p class="muted">No templates in spec/sdd/templates/.</p>'}</div>`;
    } else {
      work = `<div class="card spec-upload">
        <label class="spec-drop"><input type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" data-upload hidden>${icon('Upload', { size: 22 })}<span>${uploaded ? esc(uploaded.name) : 'Choose a .md file'}</span><span class="muted">${uploaded ? `${uploaded.text.length} characters` : 'A brief written in markdown or plain text'}</span></label>
        ${uploaded ? `<pre class="spec-preview">${esc(uploaded.text.slice(0, 900))}${uploaded.text.length > 900 ? '\n…' : ''}</pre><div class="composer__bar"><span class="hint">Sent as it is; the Spec agent turns it into the brief.</span><button class="btn btn--primary" type="button" data-send-upload${st.busy ? ' disabled' : ''}>${icon('Send', { size: 16 })} Send to Spec</button></div>` : ''}
      </div>`;
    }
    const questions = s?.questions ?? [];
    const status = !brief || brief.status === 'none' ? '' : `
      <div class="card spec-status">
        <div class="spec-status__head">${icon(brief.status === 'failed' ? 'CircleAlert' : 'FileText', { size: 18 })}
          <b>${brief.status === 'failed' ? 'The brief failed its checks' : `Brief draft ${brief.rev}`}</b>
          <span class="muted">${s.line ? `${esc(s.line.title)} · ${s.line.targetPerHour}/h · takt ${Math.round(s.line.takt * 10) / 10} s` : ''}${brief.retries ? ` · ${brief.retries} refusal${brief.retries > 1 ? 's' : ''} fixed` : ''} · ${usd(brief.cost)}</span></div>
        ${brief.status === 'failed' ? `<ul class="spec-problems">${brief.problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
        ${brief.warnings?.length ? `<ul class="spec-warnings">${brief.warnings.map((w) => `<li>${icon('TriangleAlert', { size: 14 })} ${esc(w)}</li>`).join('')}</ul>` : ''}
        ${questions.length ? `<p class="spec-ask">${icon('MessageCircleQuestion', { size: 16 })} The Spec agent asks (answer in the chat, or approve the brief with its assumptions):</p><ol class="spec-questions">${questions.map((q) => `<li><b>${esc(q.question)}</b> <span class="muted">${esc(q.why)}</span></li>`).join('')}</ol>` : (brief.status === 'draft' ? '<p class="muted">No open questions: the brief is ready for review.</p>' : '')}
        <a class="btn btn--primary" href="${href('setup', 'docs')}">${icon('FileCheck', { size: 16 })} Review the documents</a>
      </div>`;
    el.innerHTML = `${methods}${work}${busyLine(st)}${errorLine(st)}${status}`;
  };
  const off = store.subscribe(render);
  const onClick = (e) => {
    const m = e.target.closest('[data-method]');
    if (m) { store.set({ method: m.dataset.method }); return; }
    const t = e.target.closest('[data-template]');
    if (t) {
      const tpl = store.st.templates.find((x) => x.name === t.dataset.template);
      if (tpl) store.act(`The Spec agent is reading "${tpl.title}"…`, '/message', { text: tpl.text, source: 'template' }).then((ok) => ok && store.set({ method: 'chat' }));
      return;
    }
    if (e.target.closest('[data-send-upload]') && uploaded) {
      store.act(`The Spec agent is reading ${uploaded.name}…`, '/message', { text: uploaded.text, source: 'upload' }).then((ok) => { if (ok) { uploaded = null; store.set({ method: 'chat' }); } });
    }
  };
  const onSubmit = (e) => {
    e.preventDefault();
    const form = e.target;
    if (form.dataset.form === 'chat') {
      const text = new FormData(form).get('text');
      if (String(text).trim()) store.act('The Spec agent is writing the brief…', '/message', { text, source: 'chat' });
    } else if (form.dataset.form === 'guided') {
      store.act('The Spec agent is writing the brief…', '/message', { text: guidedText(form), source: 'guided' }).then((ok) => ok && store.set({ method: 'chat' }));
    }
  };
  const onChange = async (e) => {
    if (!e.target.matches('[data-upload]')) return;
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 400 * 1024) { store.set({ error: `${f.name} is over 400 KB: a brief should be a few pages` }); return; }
    uploaded = { name: f.name, text: await f.text() };
    store.set({ error: null });
  };
  el.addEventListener('click', onClick);
  el.addEventListener('submit', onSubmit);
  el.addEventListener('change', onChange);
  return () => { off(); el.removeEventListener('click', onClick); el.removeEventListener('submit', onSubmit); el.removeEventListener('change', onChange); };
}

// ---- 3 Documents --------------------------------------------------------------------------------

const DOCS = [
  ['constitution', 'constitution.md', 'Fixed rules: units, axes, flow direction, ports, naming, determinism'],
  ['brief', 'factory-brief.md', 'Product, throughput and takt, process steps, constraints'],
  ['plan', 'plan.md', 'Station list, process steps, line graph, takt budget'],
];
const STATUS = {
  none: ['CircleDashed', 'Waiting', 'waiting'],
  draft: ['CircleDot', 'Draft to review', 'draft'],
  approved: ['CircleCheck', 'Approved', 'approved'],
  failed: ['CircleAlert', 'Failed its checks', 'failed'],
};

export function mountDocs(el, store) {
  let rejecting = null;
  const render = (st) => {
    const s = st.session;
    if (!s) { el.innerHTML = `${busyLine(st)}${errorLine(st)}`; return; }
    el.innerHTML = `<div class="doc-list">${DOCS.map(([id, file, text]) => {
      const d = s.docs[id];
      const [ic, label, cls] = STATUS[d.status];
      const waitingFor = id === 'brief' ? 'Describe the factory first (step 2)' : id === 'plan' ? 'Approve the brief first' : '';
      // Open: as the owner left it, else the first document waiting for review.
      const firstDraft = DOCS.map(([k]) => k).find((k) => s.docs[k].status === 'draft' || s.docs[k].status === 'failed');
      const open = (st.open[id] ?? id === firstDraft) && d.md;
      const meta = d.status === 'none' ? waitingFor : id === 'constitution' ? 'From the project conventions, no model' : `Draft ${d.rev}${d.retries ? ` · ${d.retries} refusal${d.retries > 1 ? 's' : ''} fixed` : ''} · ${usd(d.cost)}`;
      return `
        <article class="card doc spec-doc${open ? ' is-open' : ''}">
          <div class="spec-doc__row">
            <span class="doc__icon">${icon('FileText', { size: 22 })}</span>
            <div class="doc__body"><h3 class="doc__file">${file}</h3><p class="doc__text">${text}</p><p class="spec-doc__meta">${esc(meta)}</p></div>
            <span class="status status--${cls}">${icon(ic, { size: 14 })} ${label}</span>
            <button class="btn btn--ghost" type="button" data-toggle="${id}"${d.md ? '' : ' disabled'}>${open ? 'Hide' : 'Review'}</button>
          </div>
          ${d.status === 'failed' ? `<ul class="spec-problems">${d.problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
          ${d.warnings?.length && d.status !== 'approved' ? `<ul class="spec-warnings spec-doc__warnings">${d.warnings.map((w) => `<li>${icon('TriangleAlert', { size: 14 })} ${esc(w)}</li>`).join('')}</ul>` : ''}
          ${open ? `<div class="md">${markdownToHtml(d.md)}</div>` : ''}
          ${open || d.status === 'failed' ? `<div class="spec-doc__actions">
            ${rejecting === id ? `<form data-reject="${id}" class="spec-reject"><textarea name="comment" rows="3" placeholder="What should the Spec agent change in ${file}?" required></textarea><div class="spec-doc__buttons"><button class="btn btn--ghost" type="button" data-cancel>Cancel</button><button class="btn btn--primary" type="submit"${st.busy ? ' disabled' : ''}>${icon('Send', { size: 16 })} Send back</button></div></form>`
              : `<div class="spec-doc__buttons">
                ${id !== 'constitution' && d.status !== 'none' ? `<button class="btn btn--ghost" type="button" data-reject-open="${id}"${st.busy ? ' disabled' : ''}>${icon('MessageSquareX', { size: 16 })} Reject…</button>` : ''}
                ${d.status === 'draft' ? `<button class="btn btn--primary" type="button" data-approve="${id}"${st.busy ? ' disabled' : ''}>${icon('Check', { size: 16 })} Approve</button>` : ''}
              </div>`}
          </div>` : ''}
        </article>`;
    }).join('')}</div>
    ${s.docs.brief.status === 'approved' && ['none', 'failed'].includes(s.docs.plan.status) && !st.busy ? `<p class="note"><button class="btn btn--ghost" type="button" data-retry>${icon('RotateCcw', { size: 16 })} Draft the plan again</button></p>` : ''}
    ${busyLine(st)}${errorLine(st)}
    ${s.ready ? `<p class="note spec-ready">${icon('CircleCheck', { size: 14 })} All three documents approved and saved in <code>sdd/${esc(s.line.id)}/</code>. Next: build the line.</p>` : ''}`;
    el.querySelector('textarea')?.focus();
  };
  const off = store.subscribe(render);
  const onClick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.toggle) { const id = b.dataset.toggle; store.st.open[id] = !(b.textContent.trim() === 'Hide'); store.set({}); }
    else if (b.dataset.approve) {
      const id = b.dataset.approve;
      store.act(id === 'brief' ? 'Brief approved · the Spec agent is writing the plan…' : `Approving ${id}…`, '/approve', { doc: id }).then(() => {
        store.st.open = {}; // back to "the next document waiting for review"
        store.set({});
      });
    } else if (b.dataset.rejectOpen) { rejecting = b.dataset.rejectOpen; store.set({}); }
    else if (b.hasAttribute('data-cancel')) { rejecting = null; store.set({}); }
    else if (b.hasAttribute('data-retry')) store.act('The Spec agent is writing the plan…', '/retry');
  };
  const onSubmit = (e) => {
    e.preventDefault();
    const id = e.target.dataset.reject;
    const comment = new FormData(e.target).get('comment');
    if (!String(comment).trim()) return;
    rejecting = null;
    store.act(`Sent back · the Spec agent is redrafting ${id}…`, '/reject', { doc: id, comment });
  };
  el.addEventListener('click', onClick);
  el.addEventListener('submit', onSubmit);
  return () => { off(); el.removeEventListener('click', onClick); el.removeEventListener('submit', onSubmit); };
}

// ---- 4 Build ------------------------------------------------------------------------------------

export function mountBuild(el, store) {
  const render = (st) => {
    const s = st.session;
    const phases = [
      ['Layout', 'Machines by catalog type, placed from hints by the layout program'],
      ['Machines', 'Each machine\'s params, inside its ranges'],
      ['Process', 'Ops wired into the station cycle, reviewed and played'],
    ];
    const job = s?.job;
    const missing = !s ? [] : [['constitution', 'constitution.md'], ['brief', 'factory-brief.md'], ['plan', 'plan.md']].filter(([k]) => s.docs[k].status !== 'approved').map(([, f]) => f);
    el.innerHTML = `
      <div class="card build">
        <ol class="build__phases">${phases.map(([t, d], i) => `<li><span class="build__num">${i + 1}</span><span><b>${t}</b><span class="muted">${d}</span></span></li>`).join('')}</ol>
        <p class="note">Each phase runs for each station and waits for your approval in the 3D view, with a diff.</p>
      </div>
      ${job ? `<div class="card spec-job">
        <h3>${esc(job.line.title)} <span class="muted">· ${job.plan.length} stations · takt ${Math.round(s.line.takt * 10) / 10} s · ${esc(job.line.transport.type)} between stations</span></h3>
        <ol class="spec-job__stations">${job.plan.map((p) => `<li><b>${esc(p.code ?? p.id)}</b> ${esc(p.title)} <span class="muted">${esc(p.does)} · ${p.seconds} s</span></li>`).join('')}</ol>
        <button class="btn btn--primary" type="button" data-build${st.busy ? ' disabled' : ''}>${icon('Hammer', { size: 16 })} Build the line</button>
        <p class="hint">Starting a build replaces the Builder's current session.</p>
      </div>` : `<p class="note">${icon('Info', { size: 14 })} ${s ? `Approve ${missing.join(', ')} first (step 3).` : 'The Spec API is not there.'} The twin page also offers a $0 rehearsal of the Builder.</p>`}
      ${busyLine(st)}${errorLine(st)}`;
  };
  const off = store.subscribe(render);
  const onClick = (e) => { if (e.target.closest('[data-build]')) store.build(); };
  el.addEventListener('click', onClick);
  return () => { off(); el.removeEventListener('click', onClick); };
}

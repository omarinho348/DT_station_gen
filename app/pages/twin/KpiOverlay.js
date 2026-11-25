// The KPI overlay on the twin page (Claude.md §2 "a KPI overlay", Phase 11 step 3): the 3D run's live
// numbers next to the SimPy model's KPIs for the same line (simpy/FORMAT.md). The SimPy run is on demand
// (a button); its last results are shown when the page opens.
import { icon } from '../../ui/icon.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n = (v, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? '–' : Number(v).toFixed(d));
const clock = (s) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '–');

/**
 * @param {HTMLElement} host
 * @param {object} o
 * @param {() => object | null} o.getLine   the playing Line (lib/line/Line.js), or null
 * @param {string} o.folder                 the line's folder (simpy/<folder>/)
 * @param {object} o.target                 what /api/simpy/run runs: { line: id } or { example: name }
 */
export function KpiOverlay(host, { getLine, folder, target }) {
  const el = document.createElement('section');
  el.className = 'kpi';
  el.setAttribute('aria-label', 'KPIs');
  host.appendChild(el);
  let sim = null;
  let busy = false;
  let error = null;
  let open = true;

  function live() {
    const line = getLine();
    if (!line) return '<p class="kpi__muted">The line is loading…</p>';
    const s = line.status;
    const t = line.clock ?? 0;
    return `<div class="kpi__grid">
      <div><span>Sim time</span><b>${clock(t)}</b></div>
      <div><span>Out</span><b>${s.exited}/${s.runSize}</b></div>
      <div><span>In the line</span><b>${s.inProcess}</b></div>
      <div><span>Rate so far</span><b>${t > 0 && s.exited ? n((s.exited / t) * 3600, 0) : '–'}<small>/h</small></b></div>
    </div><p class="kpi__muted">${esc(s.state.toLowerCase())} · ${s.speed}× speed</p>`;
  }

  function simpy() {
    if (error) return `<p class="kpi__error">${icon('TriangleAlert', { size: 12 })} ${esc(error)}</p>`;
    if (!sim) return '<p class="kpi__muted">No SimPy run of this line yet.</p>';
    const util = Object.entries(sim.utilisation ?? {});
    return `<div class="kpi__grid">
      <div><span>Throughput, steady</span><b>${n(sim.steadyPerHour ?? sim.throughputPerHour, 0)}<small>/h</small></b><em>${n(sim.throughputPerHour, 0)}/h over this run</em></div>
      <div><span>Takt achieved</span><b>${n(sim.taktAchieved, 1)}<small> s</small></b><em>planned ${n(sim.taktPlanned, 1)} s</em></div>
      <div><span>Lead time</span><b>${n(sim.leadTime?.mean, 0)}<small> s</small></b><em>${n(sim.leadTime?.min, 0)}–${n(sim.leadTime?.max, 0)} s</em></div>
      <div><span>WIP</span><b>${n(sim.wip?.mean, 1)}</b><em>max ${sim.wip?.max ?? '–'}</em></div>
      <div><span>Run of ${sim.runSize}</span><b>${clock(sim.makespan)}</b><em>${sim.goodUnits} good</em></div>
      <div><span>Rejects</span><b>${sim.rejects?.count ?? 0}</b><em>${n((sim.rejects?.rate ?? 0) * 100, 0)} %</em></div>
    </div>
    <ul class="kpi__util">${util.map(([id, u]) => `<li><span>${esc(id)}</span><i style="--u:${Math.min(1, u).toFixed(3)}"></i><b>${Math.round(u * 100)}%</b></li>`).join('')}</ul>
    <p class="kpi__muted">bottleneck (planned): ${esc(sim.bottleneckPlanned?.kind)} ${esc(sim.bottleneckPlanned?.id)}${sim.finished ? '' : ' · <b>the run did not finish</b>'}</p>`;
  }

  function render() {
    el.classList.toggle('is-closed', !open);
    el.innerHTML = `
      <header class="kpi__head"><button type="button" class="kpi__toggle" data-act="toggle" aria-expanded="${open}">${icon('ChartNoAxesColumn', { size: 14 })} KPIs</button>
        ${open ? `<button type="button" class="kpi__run" data-act="run"${busy ? ' disabled' : ''}>${busy ? '<span class="kpi__spin"></span> Running SimPy…' : `${icon('Play', { size: 12 })} Run SimPy`}</button>` : ''}</header>
      ${open ? `<h4>3D twin, live</h4><div data-live>${live()}</div><h4>SimPy model <a href="/api/simpy/${esc(folder)}/trace.jsonl" target="_blank" rel="noopener">trace</a> · <a href="/api/simpy/${esc(folder)}/kpis.json" target="_blank" rel="noopener">kpis.json</a></h4>${simpy()}` : ''}`;
  }

  el.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (a === 'toggle') { open = !open; render(); }
    if (a === 'run' && !busy) {
      busy = true;
      error = null;
      render();
      try {
        const res = await fetch('/api/simpy/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(target) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        sim = data.kpis;
      } catch (err) {
        error = err.message;
      }
      busy = false;
      render();
    }
  });
  const timer = setInterval(() => { const box = el.querySelector('[data-live]'); if (box) box.innerHTML = live(); }, 500);
  fetch(`/api/simpy/${encodeURIComponent(folder)}/kpis.json`).then((r) => (r.ok ? r.json() : null)).then((k) => { sim = k; render(); }).catch(() => render());
  render();
  return { dispose() { clearInterval(timer); el.remove(); } };
}

// Setup page (light theme): a stepper wizard. Phase 0 mock-up: static UI, no agents connected.
// Values marked data-placeholder are filled by the server in Phase 8 (budget, key status, models).
import { icon } from '../../ui/icon.js';
import { href } from '../../router.js';
import { CREW, SETUP_STEPS } from '../../data/crew.js';
import { APP_NAME, APP_VERSION } from '../../brand.js';
import { loadTheme, saveTheme, nextTheme } from '../../ui/theme.js';

const PLACEHOLDER_TIP = 'Placeholder until the LLM layer is connected (Phase 8)';

export function SetupPage(outlet, route) {
  const root = document.createElement('div');
  let theme = loadTheme(route.query?.theme);
  root.innerHTML = `
    <header class="topbar">
      <a class="brand" href="${href('setup')}">
        <span class="brand__mark">${icon('Cuboid', { size: 16, stroke: 2 })}</span>
        <span class="brand__name">${APP_NAME}</span>
        <span class="brand__ver">${APP_VERSION}</span>
      </a>
      <nav class="stepper" aria-label="Setup steps"></nav>
      <div class="topbar__status">
        <span class="chip" data-placeholder title="${PLACEHOLDER_TIP}">
          ${icon('KeyRound', { size: 14 })} OpenAI <b>mock</b>
        </span>
        <span class="chip" data-placeholder title="${PLACEHOLDER_TIP}">
          ${icon('Wallet', { size: 14 })} <b>$4.50</b> left
        </span>
        <button class="icon-btn theme-toggle" type="button"></button>
      </div>
    </header>
    <main class="setup__main">
      <section class="setup__panel" aria-live="polite"></section>
    </main>
    <footer class="setup__footer"></footer>
  `;
  outlet.appendChild(root);

  const stepper = root.querySelector('.stepper');
  const panel = root.querySelector('.setup__panel');
  const footer = root.querySelector('.setup__footer');
  const toggle = root.querySelector('.theme-toggle');

  function applyTheme() {
    root.className = `setup theme-${theme}`;
    const target = nextTheme(theme);
    toggle.innerHTML = icon(target === 'dark' ? 'Moon' : 'Sun', { size: 16 });
    toggle.title = `Switch to ${target} mode`;
    toggle.setAttribute('aria-label', toggle.title);
  }
  toggle.addEventListener('click', () => {
    theme = nextTheme(theme);
    saveTheme(theme);
    applyTheme();
  });
  applyTheme();

  function render({ sub }) {
    const index = Math.max(0, SETUP_STEPS.findIndex((s) => s.id === sub));
    const step = SETUP_STEPS[index];
    document.title = `${step.title} · ${APP_NAME}`;

    stepper.innerHTML = SETUP_STEPS.map((s, i) => {
      const state = i < index ? 'done' : i === index ? 'current' : 'todo';
      return `
        <a class="stepper__item is-${state}" href="${href('setup', s.id)}" ${state === 'current' ? 'aria-current="step"' : ''}>
          <span class="stepper__dot">${state === 'done' ? icon('Check', { size: 12, stroke: 3 }) : i + 1}</span>
          <span class="stepper__label">${s.short}</span>
        </a>${i < SETUP_STEPS.length - 1 ? '<span class="stepper__bar"></span>' : ''}`;
    }).join('');

    panel.innerHTML = `
      <div class="panel-head">
        <p class="eyebrow">Step ${index + 1} of ${SETUP_STEPS.length}</p>
        <h1>${step.title}</h1>
        <p class="lede">${LEDES[step.id]}</p>
      </div>
      ${STEP_VIEWS[step.id]()}
    `;
    panel.classList.remove('is-entering');
    void panel.offsetWidth; // restart the enter animation
    panel.classList.add('is-entering');

    const prev = SETUP_STEPS[index - 1];
    const next = SETUP_STEPS[index + 1];
    footer.innerHTML = `
      <div class="setup__footer-inner">
        ${prev ? `<a class="btn btn--ghost" href="${href('setup', prev.id)}">${icon('ChevronLeft', { size: 16 })} ${prev.short}</a>` : '<span></span>'}
        ${
          next
            ? `<a class="btn btn--primary" href="${href('setup', next.id)}">Next: ${next.short} ${icon('ChevronRight', { size: 16 })}</a>`
            : `<a class="btn btn--primary" href="${href('twin')}">${icon('Play', { size: 16 })} Open the twin</a>`
        }
      </div>`;

    window.__appReady = true;
  }

  render(route);
  return {
    update: render,
    unmount: () => root.remove(),
  };
}

const LEDES = {
  crew: 'Four agents work for you. They only write JSON and markdown; every line of code comes from fixed templates. Pick how each one runs.',
  brief: 'Tell the Spec agent what you make and how fast. It asks follow-up questions when something is missing.',
  docs: 'The Spec agent writes three documents. Approve each one before anything gets built.',
  build: 'The Builder lays out the line station by station in the 3D view. You approve every phase with a diff.',
};

const STEP_VIEWS = {
  crew() {
    const rows = (group) =>
      CREW.filter((m) => m.group === group)
        .map(
          (m) => `
        <div class="crew-row" role="row">
          <div class="crew-agent" role="cell">
            <span class="avatar avatar--${m.llm ? 'llm' : 'code'}">${icon(m.icon, { size: 20 })}</span>
            <span>
              <span class="crew-agent__name">${m.name}</span>
              <span class="crew-agent__role">${m.role}</span>
            </span>
          </div>
          <div role="cell">
            ${
              m.llm
                ? `<label class="select"><span class="sr-only">${m.name} runs on</span>
                     <select data-placeholder><option>OpenAI</option><option>Mock (recorded)</option></select></label>`
                : '<span class="tag tag--direct">direct</span>'
            }
          </div>
          <div role="cell">
            ${
              m.llm
                ? `<label class="select"><span class="sr-only">${m.name} model</span>
                     <select data-placeholder title="${PLACEHOLDER_TIP}">
                       <option>Default model</option>
                       ${m.strongAllowed ? '<option>Strong model (plan.md only)</option>' : ''}
                     </select></label>`
                : '<span class="muted">No model, plain code</span>'
            }
          </div>
          <div class="crew-spend" role="cell"><span class="crew-spend__label">Spent</span>${m.llm ? '<span data-placeholder>$0.00</span>' : '<span class="muted">free</span>'}</div>
        </div>`,
        )
        .join('');

    return `
      <div class="card crew" role="table" aria-label="Agent crew">
        <div class="crew-row crew-row--head" role="row">
          <div role="columnheader">Agent</div>
          <div role="columnheader">Runs on</div>
          <div role="columnheader">Model <span class="crew-head-note">from .env</span></div>
          <div role="columnheader" class="crew-spend">Spent</div>
        </div>
        <div class="crew-group" role="row"><div role="cell">Build crew</div></div>
        ${rows('build')}
        <div class="crew-group" role="row"><div role="cell">Oversight</div></div>
        ${rows('oversight')}
      </div>
      <p class="note">${icon('Lock', { size: 14 })} Your OpenAI key stays in <code>.env</code> on this machine. Every call goes through a budget guard and a response cache.</p>`;
  },

  brief() {
    const methods = [
      ['MessageSquare', 'Chat', 'Describe the line in your own words', true],
      ['ListTodo', 'Guided questions', 'Answer a short questionnaire'],
      ['LayoutTemplate', 'Template', 'Start from an example line'],
      ['Upload', 'Upload .md', 'Use a brief you already wrote'],
    ];
    return `
      <div class="method-grid" role="radiogroup" aria-label="How to give the brief">
        ${methods
          .map(
            ([ic, title, text, on]) => `
          <button class="method${on ? ' is-selected' : ''}" role="radio" aria-checked="${!!on}" type="button">
            <span class="method__icon">${icon(ic, { size: 20 })}</span>
            <span class="method__title">${title}</span>
            <span class="method__text">${text}</span>
          </button>`,
          )
          .join('')}
      </div>
      <div class="card composer">
        <textarea rows="6" placeholder="Example: A line that assembles desktop 3D printers. 6 stations: frame, gantry, extruder, electronics, enclosure, final test. Target 1 unit every 90 seconds."></textarea>
        <div class="composer__bar">
          <span class="hint">${icon('Sparkles', { size: 14 })} The Spec agent is connected in Phase 9.</span>
          <button class="btn btn--primary" type="button" disabled>Send to Spec</button>
        </div>
      </div>`;
  },

  docs() {
    const docs = [
      ['constitution.md', 'Fixed rules: units, axes, flow direction, ports, naming, determinism'],
      ['factory-brief.md', 'Product, throughput and takt, stations, constraints'],
      ['plan.md', 'Station list, process steps, line graph, takt budget'],
    ];
    return `
      <div class="doc-list">
        ${docs
          .map(
            ([file, text]) => `
          <article class="card doc">
            <span class="doc__icon">${icon('FileText', { size: 22 })}</span>
            <div class="doc__body">
              <h3 class="doc__file">${file}</h3>
              <p class="doc__text">${text}</p>
            </div>
            <span class="status status--waiting">${icon('CircleDashed', { size: 14 })} Waiting for brief</span>
            <button class="btn btn--ghost" type="button" disabled>Review</button>
          </article>`,
          )
          .join('')}
      </div>`;
  },

  build() {
    const phases = [
      ['Layout', 'Station shells, conveyors and transfers placed by the layout engine'],
      ['Machines', 'Equipment from the catalog, composites or placeholders'],
      ['Motions & process', 'Ops wired into each station cycle, checked against takt'],
    ];
    return `
      <div class="card build">
        <ol class="build__phases">
          ${phases
            .map(
              ([t, d], i) => `
            <li><span class="build__num">${i + 1}</span><span><b>${t}</b><span class="muted">${d}</span></span></li>`,
            )
            .join('')}
        </ol>
        <p class="note">Each phase is run for each station and waits for your approval in the 3D view.</p>
      </div>`;
  },
};

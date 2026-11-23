// Component gallery (dark): every registered component (and product) with live parameter sliders
// and motion controls; a product's build stages show as a 'stage' motion. #/gallery/<type>; add ?golden=1 for a clean, UI-free golden screenshot.
// Everything here is generic: it reads the registry, never a component by name (rule 6).
import { Box3, Box3Helper, Color, Vector3, Mesh, SphereGeometry, MeshBasicMaterial, Group } from 'three';
import '../../../lib/products/index.js';
import { Viewer } from '../../viewer/Viewer.js';
import { icon } from '../../ui/icon.js';
import { href } from '../../router.js';
import { APP_NAME } from '../../brand.js';
import { registry } from '../../../lib/components/index.js';
import { paramFields } from '../../../lib/registry.js';
import { createMaterials, disposeMaterials } from '../../../lib/core/materials.js';
import { smoother } from '../../../lib/core/motion.js';
import { preloadComponentAssets } from '../../../lib/core/assets.js';

const CATEGORY_LABELS = {
  conveyor: 'Conveyors', robot: 'Robots', machine: 'Machines', fixture: 'Fixtures', station: 'Station furniture',
  frame: 'Frames', axis: 'Axes', tool: 'Tools', transport: 'Transport', buffer: 'Buffers', product: 'Products',
};
const PLAY_SECONDS = 1.6;
const PORT_GEOMETRY = new SphereGeometry(0.035, 16, 12);
const PORT_MATERIALS = {
  in: new MeshBasicMaterial({ color: 0x3b9bff, depthTest: false }),
  work: new MeshBasicMaterial({ color: 0x00c1b6, depthTest: false }),
  out: new MeshBasicMaterial({ color: 0xf2a516, depthTest: false }),
};

export function GalleryPage(outlet, route) {
  const golden = route.query?.golden === '1';
  const defs = [
    ...registry.components(),
    ...registry.products().map((p) => ({ ...p, category: 'product', mount: 'carrier', ops: [], isProduct: true })),
  ];
  const getDef = (type) => defs.find((d) => d.type === type);
  const root = document.createElement('div');
  root.className = `gallery theme-dark${golden ? ' is-golden' : ''}`;
  root.innerHTML = `
    <div class="viewport"></div>
    <header class="hud-brand">
      <a class="hud-back" href="${href('setup')}" title="Back to setup">${icon('ArrowLeft', { size: 16 })}</a>
      <span class="hud-brand__mark"></span>
      <span class="hud-brand__name">${APP_NAME}</span>
      <span class="hud-brand__sep">/</span>
      <span class="hud-brand__page">Gallery</span>
    </header>
    <aside class="gal-list" aria-label="Components"></aside>
    <aside class="gal-panel" aria-label="Component controls"></aside>
    <div class="gal-error" role="alert" hidden>${icon('TriangleAlert', { size: 15 })}<span></span></div>
  `;
  outlet.appendChild(root);

  const list = root.querySelector('.gal-list');
  const panel = root.querySelector('.gal-panel');
  const materials = createMaterials();
  const viewer = new Viewer(root.querySelector('.viewport'));
  viewer.stage.origin.visible = false; // the 1 m flow arrow dwarfs small components
  if (import.meta.env.DEV) window.viewer = viewer;
  window.__screenshotPrepare = () => viewer.pause();

  let inst = null;
  let params = {};
  let footprintBox = null;
  let showFootprint = route.query?.footprint === '1';
  let play = null; // { name, t }

  viewer.onFrame((dt) => {
    if (!play || !inst) return;
    play.t += dt / PLAY_SECONDS;
    const phase = play.t % 2; // 0→1 then 1→0
    const [lo, hi] = inst.motions[play.name].range;
    const v = lo + (hi - lo) * smoother(phase <= 1 ? phase : 2 - phase);
    inst.set(play.name, v);
    const slider = panel.querySelector(`[data-motion="${play.name}"]`);
    if (slider) slider.value = v;
  });

  function select(type, query = {}) {
    const def = defs.find((d) => d.type === type) ?? defs[0];
    if (!def) return;
    document.title = `${def.type} · Gallery · ${APP_NAME}`;
    params = paramsFromQuery(def, query);
    renderList(def.type);
    rebuild(def, true);
  }

  function rebuild(def, frame = false) {
    play = null;
    let next;
    try {
      next = def.isProduct ? productView(def, params) : registry.buildComponent(def.type, params, { materials });
    } catch (e) {
      // e.g. a parameter combination the component's schema rejects: keep the last valid build.
      showError(e.message.replace(/^Invalid params for "[^"]+": /, ''));
      if (inst) {
        params = { ...inst.params };
        renderPanel(getDef(inst.type)); // put the slider back
      }
      return;
    }
    showError(null);
    const keepState = inst?.type === def.type ? { ...inst.state } : null;
    inst?.dispose();
    footprintBox?.removeFromParent();
    inst = next;
    params = { ...inst.params };
    if (keepState) for (const [k, v] of Object.entries(keepState)) inst.set(k, v);
    viewer.content.add(inst.root);
    const fp = inst.footprint;
    // Overlay: footprint box + port markers (a Box3Helper rescales its children, so both
    // live side by side in a plain group).
    footprintBox = new Group();
    footprintBox.name = 'overlay';
    footprintBox.visible = showFootprint;
    const outline = new Box3Helper(
      new Box3(new Vector3(fp.x[0], 0, fp.z[0]), new Vector3(fp.x[1], fp.height, fp.z[1])),
      new Color(0x00c1b6),
    );
    outline.name = 'footprint';
    footprintBox.add(outline);
    const markerSize = Math.max(0.6, Math.max(fp.x[1] - fp.x[0], fp.height) / 3);
    for (const [name, port] of Object.entries(inst.ports)) {
      const marker = new Mesh(PORT_GEOMETRY, PORT_MATERIALS[port.direction]);
      marker.name = `port ${name}`;
      marker.position.set(...port.position);
      marker.scale.setScalar(markerSize);
      marker.renderOrder = 10;
      footprintBox.add(marker);
    }
    viewer.scene.add(footprintBox);
    if (frame) frameCamera();
    renderPanel(def);
  }

  let errorTimer = null;
  function showError(message) {
    const el = root.querySelector('.gal-error');
    clearTimeout(errorTimer);
    el.hidden = !message;
    if (message) {
      el.querySelector('span').textContent = message;
      errorTimer = setTimeout(() => (el.hidden = true), 6000);
    }
  }

  function frameCamera() {
    const box = visibleBounds(inst.root);
    const size = box.getSize(new Vector3());
    const center = box.getCenter(new Vector3());
    const radius = Math.max(size.length() / 2, 0.05); // small parts (a 5 cm lamp) still fill the view
    const dist = radius / Math.sin((viewer.camera.fov * Math.PI) / 360) * 1.05;
    const dir = new Vector3(0.75, 0.42, 1).normalize();
    viewer.camera.position.copy(center).addScaledVector(dir, dist);
    viewer.camera.near = Math.max(0.01, dist / 100);
    viewer.camera.updateProjectionMatrix();
    viewer.controls.target.copy(center);
    viewer.controls.minDistance = radius * 0.5;
    viewer.controls.update();
  }

  function renderList(active) {
    const byCat = Object.groupBy(defs, (d) => d.category);
    list.innerHTML = `
      <div class="gal-list__head">${icon('LayoutGrid', { size: 15 })} Components <span class="gal-count">${defs.length}</span></div>
      ${Object.entries(byCat)
        .map(
          ([cat, items]) => `
        <div class="gal-cat">${CATEGORY_LABELS[cat] ?? cat}</div>
        ${items
          .map((d) => `<a class="gal-item${d.type === active ? ' is-active' : ''}" href="${href('gallery', d.type)}">${d.type}</a>`)
          .join('')}`,
        )
        .join('')}`;
  }

  function renderPanel(def) {
    const fields = paramFields(def.params);
    const fp = inst.footprint;
    const dims = `${(fp.x[1] - fp.x[0]).toFixed(2)} × ${(fp.z[1] - fp.z[0]).toFixed(2)} × ${fp.height.toFixed(2)} m`;
    panel.innerHTML = `
      <div class="gal-title">
        <span class="gal-type">${def.type}</span>
        <span class="gal-cat-tag">${def.category}</span>
      </div>
      <p class="gal-summary">${def.summary}</p>
      <dl class="gal-facts">
        <div><dt>Mount</dt><dd>${def.mount}</dd></div>
        <div><dt>Footprint</dt><dd>${dims}</dd></div>
        ${def.ops.length ? `<div><dt>Ops</dt><dd>${def.ops.join(', ')}</dd></div>` : ''}
        ${Object.keys(inst.ports).length ? `<div><dt>Ports</dt><dd>${Object.entries(inst.ports).map(([n, p]) => `<span class="gal-port gal-port--${p.direction}">${n}</span>`).join(' ')}</dd></div>` : ''}
      </dl>

      <section class="gal-section">
        <h3>Parameters</h3>
        ${fields.map((f) => fieldHtml(f, params[f.key])).join('') || '<p class="gal-empty">No parameters</p>'}
        <button class="gal-link" type="button" data-action="reset">${icon('RotateCcw', { size: 13 })} Defaults</button>
      </section>

      <section class="gal-section">
        <h3>Motions</h3>
        ${Object.entries(inst.motions).map(([name, spec]) => motionHtml(name, spec, inst.state[name])).join('') || '<p class="gal-empty">No motions</p>'}
      </section>

      <label class="gal-toggle">
        <input type="checkbox" data-action="footprint" ${showFootprint ? 'checked' : ''} />
        <span>Show footprint</span>
      </label>`;
  }

  function fieldHtml(f, value) {
    if (f.kind === 'boolean') {
      return `<label class="gal-field gal-field--bool"><span>${f.label}</span>
        <input type="checkbox" data-param="${f.key}" ${value ? 'checked' : ''} /></label>`;
    }
    if (f.kind === 'string') {
      return `<label class="gal-field"><span>${f.label}</span>
        <input type="text" value="${escapeAttr(value)}" ${f.maxLength ? `maxlength="${f.maxLength}"` : ''} data-param="${f.key}" data-kind="string" /></label>`;
    }
    if (f.kind === 'numberList') {
      return `<label class="gal-field"><span>${f.label}</span>
        <input type="text" value="${escapeAttr(value.join(', '))}" data-param="${f.key}" data-kind="numberList" /></label>`;
    }
    if (f.kind === 'enum') {
      return `<label class="gal-field"><span>${f.label}</span>
        <select data-param="${f.key}">${f.options.map((o) => `<option ${o === value ? 'selected' : ''}>${o}</option>`).join('')}</select></label>`;
    }
    if (f.kind === 'number' || f.kind === 'integer') {
      return `<label class="gal-field"><span>${f.label}<output>${fmt(value, f)}</output></span>
        <input type="range" min="${f.min}" max="${f.max}" step="${f.step}" value="${value}" data-param="${f.key}" data-kind="${f.kind}" /></label>`;
    }
    return '';
  }

  function motionHtml(name, spec, value) {
    if (spec.values) {
      return `<div class="gal-field"><span>${name}</span><div class="gal-seg" role="group">
        ${spec.values.map((v) => `<button type="button" class="${v === value ? 'is-on' : ''}" data-motion-value="${name}" value="${v}">${v}</button>`).join('')}
      </div></div>`;
    }
    const [lo, hi] = spec.range;
    return `<div class="gal-field"><span>${name}</span><div class="gal-motion">
      <input type="range" min="${lo}" max="${hi}" step="${(hi - lo) / 200}" value="${value}" data-motion="${name}" />
      <button type="button" class="gal-play" data-play="${name}" title="Play ${name}">${icon('Play', { size: 13 })}</button>
    </div></div>`;
  }

  // Text fields rebuild when the edit is committed (Enter / blur), not on every keystroke.
  panel.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.kind === 'string') params[t.dataset.param] = t.value;
    else if (t.dataset.kind === 'numberList') params[t.dataset.param] = parseList(t.value);
    else return;
    rebuild(getDef(inst.type));
  });

  panel.addEventListener('input', (e) => {
    const t = e.target;
    const def = getDef(inst.type);
    if (t.dataset.kind === 'string' || t.dataset.kind === 'numberList') return;
    if (t.dataset.param) {
      const f = paramFields(def.params).find((x) => x.key === t.dataset.param);
      params[f.key] = t.type === 'checkbox' ? t.checked : f.kind === 'enum' ? t.value : Number(t.value);
      if (t.type === 'range') t.previousElementSibling.querySelector('output').textContent = fmt(params[f.key], f);
      rebuild(def);
      panel.querySelector(`[data-param="${f.key}"]`)?.focus();
    } else if (t.dataset.motion) {
      play = null;
      inst.set(t.dataset.motion, Number(t.value));
    } else if (t.dataset.action === 'footprint') {
      showFootprint = t.checked;
      footprintBox.visible = showFootprint;
    }
  });

  panel.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const def = getDef(inst.type);
    if (b.dataset.motionValue) {
      inst.set(b.dataset.motionValue, b.value);
      b.parentElement.querySelectorAll('button').forEach((x) => x.classList.toggle('is-on', x === b));
    } else if (b.dataset.play) {
      play = play?.name === b.dataset.play ? null : { name: b.dataset.play, t: 0 };
    } else if (b.dataset.action === 'reset') {
      params = {};
      rebuild(def);
    }
  });

  /**
   * A product shown like a component: its stages as a 'stage' motion (one button each), its
   * footprint from the visible meshes at the last stage. Starts at the last (complete) stage.
   */
  function productView(def, productParams) {
    const p = registry.buildProduct(def.type, productParams, { materials });
    const last = def.stages.at(-1);
    p.setStage(last);
    const b = visibleBounds(p.root);
    const view = {
      type: def.type,
      params: p.params,
      footprint: { x: [b.min.x, b.max.x], z: [b.min.z, b.max.z], height: b.max.y },
      ports: {},
      motions: { stage: { values: def.stages, default: last } },
      state: { stage: last },
      root: p.root,
      set(name, value) {
        p.setStage(value);
        view.state[name] = value;
      },
      dispose: () => p.dispose(),
    };
    return view;
  }

  // Components built from a model (the ABB robot) need it loaded first; the rest don't wait long.
  let started = false;
  preloadComponentAssets(registry).catch((e) => showError(`Model assets: ${e.message}`)).finally(() => {
    started = true;
    select(route.sub, route.query);
    applyMotionQuery(route.query);
    // Golden shots show every lamp/motion at its default; ready once the first frames are drawn.
    requestAnimationFrame(() => requestAnimationFrame(() => (window.__appReady = true)));
  });

  /** URL query sets motions, e.g. #/gallery/<type>?<motion>=<value> (for screenshots of a state). */
  function applyMotionQuery(query = {}) {
    if (!inst) return;
    for (const [name, raw] of Object.entries(query)) {
      const spec = inst.motions[name];
      if (!spec) continue;
      inst.set(name, spec.range ? Number(raw) : raw);
    }
    renderPanel(getDef(inst.type));
  }
  return {
    update(r) {
      if (!started) return; // the first build follows the asset preload
      if (r.sub !== inst?.type) select(r.sub, r.query);
      applyMotionQuery(r.query);
    },
    unmount() {
      inst?.dispose();
      viewer.dispose();
      disposeMaterials(materials);
      delete window.__screenshotPrepare;
      if (window.viewer === viewer) delete window.viewer;
      root.remove();
    },
  };
}

/** URL query sets start params as p.<param>=<value>, e.g. #/gallery/<type>?p.length=3 (screenshots). */
function paramsFromQuery(def, query) {
  const params = {};
  for (const f of paramFields(def.params)) {
    const raw = query[`p.${f.key}`];
    if (raw === undefined) continue;
    if (f.kind === 'boolean') params[f.key] = raw === 'true' || raw === '1';
    else if (f.kind === 'number' || f.kind === 'integer') params[f.key] = Number(raw);
    else if (f.kind === 'numberList') params[f.key] = parseList(raw);
    else params[f.key] = raw;
  }
  return params;
}

/** "0.1, -0.2 0.3" → [0.1, -0.2, 0.3] (the schema rejects anything that isn't a number). */
function parseList(text) {
  return String(text).split(/[\s,;]+/).filter(Boolean).map(Number);
}

/** Bounds of the visible meshes only (hidden parts of a product still sit somewhere). */
function visibleBounds(root) {
  root.updateMatrixWorld(true);
  const box = new Box3();
  root.traverse((o) => {
    if (!o.isMesh) return;
    for (let n = o; n; n = n.parent) if (!n.visible) return;
    box.union(new Box3().setFromObject(o, true));
  });
  return box;
}

function escapeAttr(v) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function fmt(v, f) {
  if (f.kind === 'integer') return String(v);
  const decimals = Math.max(0, -Math.floor(Math.log10(f.step)));
  return Number(v).toFixed(decimals);
}

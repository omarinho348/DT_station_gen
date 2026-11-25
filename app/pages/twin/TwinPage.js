// Twin page (dark theme): full-screen 3D view. Builder approvals, chat drawer and KPIs come later.
import { Viewer } from '../../viewer/Viewer.js';
import { icon } from '../../ui/icon.js';
import { href } from '../../router.js';
import { APP_NAME } from '../../brand.js';
import { Box3, Vector3 } from 'three';

/**
 * Points the camera at a built line from the walkway side, far enough to see all of it in the part of
 * the view not covered on the right (`inset` px: the Builder panel).
 */
function frameLine(viewer, object, { inset = 0 } = {}) {
  const box = new Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const size = box.getSize(new Vector3());
  const centre = box.getCenter(new Vector3());
  const width = viewer.renderer.domElement.clientWidth || 1;
  const free = Math.max(0.3, (width - inset) / width);
  const tanH = Math.tan((viewer.camera.fov * Math.PI) / 360) * viewer.camera.aspect;
  const span = Math.max(size.x, size.z * 1.4, size.y * 1.8, 3);
  // 1.5: room around it, and the near end of a line looks bigger than its middle.
  const distance = (span / 2) / (tanH * free) * 1.5;
  // Move the view so the line's centre sits in the middle of the free part.
  const shift = (1 - free) * distance * tanH;
  const target = new Vector3(centre.x + shift, Math.min(centre.y, 0.9), centre.z);
  viewer.controls.target.copy(target);
  viewer.camera.position.set(target.x, target.y + distance * 0.5, target.z + distance * 0.87);
  viewer.controls.update();
}

export function TwinPage(outlet, route) {
  document.title = `Twin · ${APP_NAME}`;
  const root = document.createElement('div');
  // ?golden=1: no HUD text, just the 3D view (visual comparisons, scripts/visual-compare.mjs).
  root.className = `twin theme-dark${route?.query?.golden === '1' ? ' is-golden' : ''}`;
  root.innerHTML = `
    <div class="viewport"></div>
    <header class="hud-brand">
      <a class="hud-back" href="${href('setup', 'build')}" title="Back to setup">${icon('ArrowLeft', { size: 16 })}</a>
      <span class="hud-brand__mark"></span>
      <span class="hud-brand__name">${APP_NAME}</span>
      <span class="hud-brand__sep">/</span>
      <span class="hud-brand__page">Twin</span>
    </header>
    <div class="hud-hint">Drag to orbit · Right-drag to pan · Scroll to zoom</div>
  `;
  outlet.appendChild(root);

  const viewer = new Viewer(root.querySelector('.viewport'), {
    onFirstFrame: () => {
      // A demo or a compiled line says it is ready itself, once it has been drawn.
      // So does the Builder panel (below), once its first state is drawn.
      if (!route?.query?.demo && !route?.query?.line && route?.query?.golden === '1') window.__appReady = true;
    },
  });
  if (import.meta.env.DEV) window.viewer = viewer;
  // Called by scripts/screenshot.js right before capturing: a running render loop makes
  // SwiftShader's screenshot capture very slow.
  window.__screenshotPrepare = () => viewer.pause();

  // Dev check scenes, e.g. #/twin?demo=core
  let demo = null;
  let alive = true;
  const hint = root.querySelector('.hud-hint');
  if (route?.query?.demo === 'ops') {
    import('../../dev/opsDemo.js').then(({ createDemo }) => {
      if (!alive) return;
      demo = createDemo({ scene: route.query.scene ?? 'basic', onStep: (text) => { hint.textContent = text; } });
      viewer.content.add(demo.root);
      // ?t=<seconds>: frozen at that moment (screenshots); otherwise it plays.
      if (route.query.t) demo.skip(Number(route.query.t));
      else viewer.onFrame(demo.update);
      const view = demo.camera ?? { position: [4.2, 3.4, 5.4], target: [0, 1.0, -0.2] };
      viewer.camera.position.fromArray(view.position);
      viewer.controls.target.fromArray(view.target);
      requestAnimationFrame(() => requestAnimationFrame(() => (window.__appReady = true)));
    });
  }
  if (route?.query?.demo === 'station') {
    import('../../dev/stationDemo.js').then(({ createStationDemo }) => {
      if (!alive) return;
      demo = createStationDemo({ station: route.query.station ?? 'frame', onStep: (text) => { hint.textContent = text; } });
      viewer.content.add(demo.root);
      // ?t=<seconds>: frozen at that moment (screenshots); otherwise it plays.
      if (route.query.t) demo.skip(Number(route.query.t));
      else viewer.onFrame(demo.update);
      const view = demo.camera ?? { position: [4.6, 3.3, 5.6], target: [0, 1.0, -0.2] };
      viewer.camera.position.fromArray(view.position);
      viewer.controls.target.fromArray(view.target);
      requestAnimationFrame(() => requestAnimationFrame(() => (window.__appReady = true)));
    });
  }
  // A playing line: the dev demo (IR played directly) or a compiled line (#/twin?line=printer-line).
  const showLine = (player) => {
    if (!alive) { player.dispose(); return; }
    demo = player;
    viewer.content.add(demo.root);
    // ?shift=x,y,z: the whole line moved (the visual tests stand our line where a reference line,
    // which must stay at its origin, stands). Stations are station-local, so nothing else changes.
    const shift = route.query.shift?.split(',').map(Number);
    if (shift?.length === 3 && shift.every(Number.isFinite)) {
      demo.root.position.fromArray(shift);
      demo.root.updateMatrixWorld(true);
    }
    // ?t=<seconds>: frozen at that moment (screenshots); otherwise it plays.
    if (route.query.t) demo.skip(Number(route.query.t));
    else viewer.onFrame(demo.update);
    const cam = route.query.cam?.split(',').map(Number);
    const view = cam?.length === 6 && cam.every(Number.isFinite)
      ? { position: cam.slice(0, 3), target: cam.slice(3) }
      : demo.camera ?? { position: [0.5, 9.5, 15.5], target: [0, 0.9, -0.3] };
    viewer.camera.position.fromArray(view.position);
    viewer.controls.target.fromArray(view.target);
    // Frozen pages (?t) can be moved on by scripts: __twinView({ t, cam: [x, y, z, tx, ty, tz] })
    // jumps forward to moment t (never back), sets the camera and draws one frame. Lets
    // scripts/visual-compare.mjs take many views from one page load.
    if (route.query.t) {
      let shownAt = Number(route.query.t);
      window.__twinView = async ({ t = shownAt, cam = null } = {}) => {
        if (t < shownAt - 1e-9) throw new Error(`__twinView: t ${t} is before the shown moment ${shownAt}`);
        demo.skip(t - shownAt);
        shownAt = t;
        if (cam) {
          viewer.camera.position.fromArray(cam.slice(0, 3));
          viewer.controls.target.fromArray(cam.slice(3));
        }
        viewer.controls.update();
        viewer.renderer.render(viewer.scene, viewer.camera);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return true;
      };
    }
    requestAnimationFrame(() => requestAnimationFrame(() => (window.__appReady = true)));
  };
  const lineOptions = { speed: Number(route?.query?.speed ?? 1), onStatus: (text) => { hint.textContent = text; } };
  if (route?.query?.demo === 'line') {
    import('../../dev/lineDemo.js').then(async ({ createLineDemo, preloadLineAssets }) => {
      await preloadLineAssets(route.query.line ?? 'printer');
      if (alive) showLine(createLineDemo({ line: route.query.line ?? 'printer', station: route.query.station, ...lineOptions }));
    });
  }
  // The hand-built reference lines, for the visual acceptance tests (dev only): the printer line
  // (app/dev/referenceLine.js, the default) or, with &line=lubricant-line, the lubricant factory
  // (app/dev/referenceLubricant.js).
  if (route?.query?.demo === 'reference') {
    const load = route.query.line === 'lubricant-line'
      ? import('../../dev/referenceLubricant.js').then(({ loadReferenceLubricant }) => loadReferenceLubricant(lineOptions))
      : import('../../dev/referenceLine.js').then(({ loadReferenceLine }) => loadReferenceLine(lineOptions));
    load
      .then(showLine)
      .catch((error) => {
        console.error(error);
        hint.textContent = error.message;
        window.__appReady = true;
      });
  }
  if (!route?.query?.demo && route?.query?.line) {
    // The KPI overlay (Phase 11) unless this is a golden screenshot; a compiled example line runs its
    // SimPy model as that example.
    if (route.query.golden !== '1' && !route.query.t) {
      import('./KpiOverlay.js').then(({ KpiOverlay }) => {
        if (alive) kpis = KpiOverlay(root, { getLine: () => demo?.line ?? null, folder: route.query.line, target: { example: route.query.line } });
      });
    }
    import('./compiledLines.js')
      .then(({ loadCompiledLine }) => loadCompiledLine(route.query.line, lineOptions))
      .then(showLine)
      .catch((error) => {
        console.error(error);
        hint.textContent = error.message;
        window.__appReady = true;
      });
  }
  // The app's own twin page (no demo, no compiled line asked for): the Builder's approval panel, its
  // drafts loaded into the 3D view as they come (step 8.5).
  let panel = null;
  let kpis = null;
  if (!route?.query?.demo && !route?.query?.line && route?.query?.golden !== '1') {
    root.classList.add('has-panel');
    let loading = Promise.resolve();
    let stationCount = -1;
    let unhook = null;
    // A Builder draft (by its URL) or, in edit mode, a stored line's compiled files (by folder).
    const loadDraft = (url, folder = null) => {
      loading = loading.then(async () => {
        if (!alive) return;
        unhook?.();
        unhook = null;
        demo?.dispose();
        demo = null;
        if (!url && !folder) { hint.textContent = 'Drag to orbit · Right-drag to pan · Scroll to zoom'; return; }
        try {
          const { loadDraftLine, loadStoredLine } = await import('./compiledLines.js');
          const player = folder ? await loadStoredLine(folder, lineOptions) : await loadDraftLine(url, lineOptions);
          if (!alive) { player.dispose(); return; }
          demo = player;
          viewer.content.add(player.root);
          unhook = viewer.onFrame(player.update);
          // A new station in the line: frame the whole line; otherwise keep the owner's view.
          const count = player.line.stations.length;
          if (count !== stationCount) {
            stationCount = count;
            frameLine(viewer, player.root, { inset: root.querySelector('.bp')?.offsetWidth ? root.querySelector('.bp').offsetWidth + 32 : 0 });
          }
        } catch (error) {
          console.error(error);
          hint.textContent = `The draft did not load: ${error.message}`;
        }
      });
      return loading;
    };
    const ready = () => requestAnimationFrame(() => requestAnimationFrame(() => (window.__appReady = true)));
    if (route?.query?.edit) {
      // Edit mode (step 10.4): the stored line lines/<id>/ in the 3D view, the Editor beside it.
      const id = route.query.edit;
      import('./EditorPanel.js').then(({ EditorPanel }) => {
        if (!alive) return;
        panel = EditorPanel(root, { id, onReady: () => {} });
        fetch(`/api/lines/${encodeURIComponent(id)}`).then((r) => r.json())
          .then((d) => {
            if (!d.line) { hint.textContent = d.error ?? 'no such line'; return null; }
            import('./KpiOverlay.js').then(({ KpiOverlay }) => {
              if (alive) kpis = KpiOverlay(root, { getLine: () => demo?.line ?? null, folder: d.line.folder, target: { line: id } });
            });
            return loadDraft(null, d.line.folder);
          })
          .catch((e) => { hint.textContent = e.message; })
          .then(ready);
      });
    } else {
      import('./BuilderPanel.js').then(({ BuilderPanel }) => {
        if (!alive) return;
        panel = BuilderPanel(root, { onDraft: (url) => loadDraft(url), onReady: ready });
      });
    }
  }

  if (route?.query?.demo === 'core') {
    import('../../dev/coreDemo.js').then(({ createCoreDemo }) => {
      if (!alive) return;
      demo = createCoreDemo();
      viewer.content.add(demo.root);
      viewer.onFrame(demo.update);
      viewer.camera.position.set(3.4, 2.5, 4.4);
      viewer.controls.target.set(0, 0.55, 0);
      // Ready only once the demo has been drawn (the screenshot script waits for this).
      requestAnimationFrame(() => requestAnimationFrame(() => (window.__appReady = true)));
    });
  }

  return {
    unmount() {
      alive = false;
      panel?.dispose();
      kpis?.dispose();
      demo?.dispose();
      viewer.dispose();
      delete window.__screenshotPrepare;
      delete window.__twinView;
      if (window.viewer === viewer) delete window.viewer;
      root.remove();
    },
  };
}

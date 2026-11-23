// Twin page (dark theme): full-screen 3D view. Builder approvals, chat drawer and KPIs come later.
import { Viewer } from '../../viewer/Viewer.js';
import { icon } from '../../ui/icon.js';
import { href } from '../../router.js';
import { APP_NAME } from '../../brand.js';

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
      if (!route?.query?.demo && !route?.query?.line) window.__appReady = true;
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
      await preloadLineAssets();
      if (alive) showLine(createLineDemo({ line: route.query.line ?? 'printer', ...lineOptions }));
    });
  }
  // The hand-built reference line, for the visual acceptance test (dev only; app/dev/referenceLine.js).
  if (route?.query?.demo === 'reference') {
    import('../../dev/referenceLine.js')
      .then(({ loadReferenceLine }) => loadReferenceLine(lineOptions))
      .then(showLine)
      .catch((error) => {
        console.error(error);
        hint.textContent = error.message;
        window.__appReady = true;
      });
  }
  if (!route?.query?.demo && route?.query?.line) {
    import('./compiledLines.js')
      .then(({ loadCompiledLine }) => loadCompiledLine(route.query.line, lineOptions))
      .then(showLine)
      .catch((error) => {
        console.error(error);
        hint.textContent = error.message;
        window.__appReady = true;
      });
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
      demo?.dispose();
      viewer.dispose();
      delete window.__screenshotPrepare;
      delete window.__twinView;
      if (window.viewer === viewer) delete window.viewer;
      root.remove();
    },
  };
}

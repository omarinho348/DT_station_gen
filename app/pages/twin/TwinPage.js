// Twin page (dark theme): full-screen 3D view. Builder approvals, chat drawer and KPIs come later.
import { Viewer } from '../../viewer/Viewer.js';
import { icon } from '../../ui/icon.js';
import { href } from '../../router.js';
import { APP_NAME } from '../../brand.js';

export function TwinPage(outlet, route) {
  document.title = `Twin · ${APP_NAME}`;
  const root = document.createElement('div');
  root.className = 'twin theme-dark';
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
      if (!route?.query?.demo) window.__appReady = true;
    },
  });
  if (import.meta.env.DEV) window.viewer = viewer;
  // Called by scripts/screenshot.js right before capturing: a running render loop makes
  // SwiftShader's screenshot capture very slow.
  window.__screenshotPrepare = () => viewer.pause();

  // Dev check scenes, e.g. #/twin?demo=core
  let demo = null;
  let alive = true;
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
      if (window.viewer === viewer) delete window.viewer;
      root.remove();
    },
  };
}

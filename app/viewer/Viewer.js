// Browser-only viewer: renderer, camera, orbit controls, environment map, resize and render loop.
import {
  WebGLRenderer,
  PerspectiveCamera,
  SRGBColorSpace,
  NeutralToneMapping,
  PCFShadowMap,
  Timer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { applyEnvironment, disposeEnvironment } from '../../lib/core/environment.js';
import { createStage } from './stage.js';

export class Viewer {
  constructor(container, { stage: stageOpts, onFirstFrame } = {}) {
    this.container = container;
    this.onFirstFrame = onFirstFrame;
    this.frameHooks = new Set();

    const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = NeutralToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap; // r186 removed PCFSoftShadowMap; PCF is soft-filtered now
    renderer.domElement.classList.add('viewer-canvas');
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    const stage = createStage(stageOpts);
    this.stage = stage;
    this.scene = stage.scene;
    this.content = stage.content;

    // Image-based lighting so metals and paints read correctly; background stays the flat stage colour.
    applyEnvironment(this.scene, renderer);

    const camera = new PerspectiveCamera(42, 1, 0.05, 400);
    camera.position.set(7.5, 5.5, 9.5);
    this.camera = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.85, 0); // belt height
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 1.0;
    controls.maxDistance = 120;
    controls.maxPolarAngle = Math.PI * 0.495; // never look from below the floor
    controls.update();
    this.controls = controls;

    this.timer = new Timer();
    this._resize = this._resize.bind(this);
    this._loop = this._loop.bind(this);
    this._ro = new ResizeObserver(this._resize);
    this._ro.observe(container);
    this._resize();
    renderer.setAnimationLoop(this._loop);
  }

  /** Register fn(dt, elapsed) to run every frame. Returns an unsubscribe function. */
  onFrame(fn) {
    this.frameHooks.add(fn);
    return () => this.frameHooks.delete(fn);
  }

  _resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _loop(time) {
    this.timer.update(time);
    const dt = Math.min(this.timer.getDelta(), 0.1);
    const elapsed = this.timer.getElapsed();
    for (const fn of this.frameHooks) fn(dt, elapsed);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    if (!this.ready) {
      this.ready = true;
      this.onFirstFrame?.();
    }
  }

  /** Stop the render loop; the last frame stays on screen. */
  pause() {
    this.renderer.setAnimationLoop(null);
  }

  resume() {
    this.renderer.setAnimationLoop(this._loop);
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    this._ro.disconnect();
    this.controls.dispose();
    disposeEnvironment(this.renderer);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

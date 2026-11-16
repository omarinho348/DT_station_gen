// Soft studio reflections (image-based lighting). Painted metal and plastic look flat without them.
// Browser only: needs a WebGL renderer.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export const ENVIRONMENT_INTENSITY = 0.55;

// One reflection map per renderer, shared by everything drawn with it.
const textures = new WeakMap();

export function roomEnvironment(renderer) {
  if (!textures.has(renderer)) {
    const generator = new THREE.PMREMGenerator(renderer);
    textures.set(renderer, generator.fromScene(new RoomEnvironment(), 0.04).texture);
    generator.dispose();
  }
  return textures.get(renderer);
}

/** Lights `scene` with the room reflections. Returns a function that puts back what was there. */
export function applyEnvironment(scene, renderer, intensity = ENVIRONMENT_INTENSITY) {
  const previous = { map: scene.environment, intensity: scene.environmentIntensity };
  scene.environment = roomEnvironment(renderer);
  scene.environmentIntensity = intensity;
  return () => {
    scene.environment = previous.map;
    scene.environmentIntensity = previous.intensity;
  };
}

/** Call when the renderer is disposed. */
export function disposeEnvironment(renderer) {
  textures.get(renderer)?.dispose();
  textures.delete(renderer);
}

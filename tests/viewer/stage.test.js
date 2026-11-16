import { describe, it, expect } from 'vitest';
import { Box3 } from 'three';
import { createStage } from '../../app/viewer/stage.js';

describe('viewer stage (headless)', () => {
  const stage = createStage();

  it('has a floor lying flat at y = 0 that receives shadows', () => {
    const box = new Box3().setFromObject(stage.floor);
    expect(box.min.y).toBeCloseTo(0, 6);
    expect(box.max.y).toBeCloseTo(0, 6);
    expect(stage.floor.receiveShadow).toBe(true);
  });

  it('has a shadow-casting key light plus fill lights', () => {
    expect(stage.lights.key.castShadow).toBe(true);
    expect(stage.lights.hemi.intensity).toBeGreaterThan(0);
    expect(stage.lights.rim.intensity).toBeGreaterThan(0);
  });

  it('has an empty content root for lines and components', () => {
    expect(stage.content.parent).toBe(stage.scene);
    expect(stage.content.children).toHaveLength(0);
  });

  it('names every object and has no NaN positions or anything below the floor', () => {
    stage.scene.updateMatrixWorld(true);
    stage.scene.traverse((o) => {
      expect(o.name, `unnamed ${o.type}`).toBeTruthy();
      for (const v of o.position.toArray()) expect(Number.isFinite(v)).toBe(true);
    });
    const meshes = [stage.grid, stage.origin];
    for (const m of meshes) expect(new Box3().setFromObject(m).min.y).toBeGreaterThanOrEqual(0);
  });
});

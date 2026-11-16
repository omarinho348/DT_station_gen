import { describe, it, expect } from 'vitest';
import { REVISION, Scene, Mesh, BoxGeometry, Box3 } from 'three';
import { z } from 'zod';

describe('toolchain smoke test', () => {
  it('loads three r186 and builds geometry headless in Node', () => {
    expect(REVISION).toBe('186');
    const scene = new Scene();
    scene.add(new Mesh(new BoxGeometry(1, 2, 3)));
    const box = new Box3().setFromObject(scene);
    expect(box.max.y - box.min.y).toBeCloseTo(2);
  });

  it('loads zod 4 with JSON Schema export', () => {
    const schema = z.object({ heads: z.number().int().min(1).max(8).default(4) });
    expect(schema.parse({})).toEqual({ heads: 4 });
    expect(typeof z.toJSONSchema).toBe('function');
    expect(z.toJSONSchema(schema).type).toBe('object');
  });
});

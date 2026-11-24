// /api/review (server/reviewApi.js, Phase 7 step 4): requests in, the reviewer's findings out, bad
// requests refused clearly. The handler is tested with the test's own modules as its loader; the
// Vite plugin around it only reads the body and writes the answer.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { registry } from '../../lib/components/index.js';
import '../../lib/products/index.js';
import '../../lib/ops/index.js';
import { preloadComponentAssets } from '../../lib/core/assets.js';
import { reviewAll } from '../../agents/reviewer/deterministic.js';
import { handleReview, reviewApi } from '../../server/reviewApi.js';

await preloadComponentAssets(registry);

const env = { root: resolve('.'), load: async () => ({ registry, reviewAll }) };
const bottling = JSON.parse(readFileSync('spec/examples/bottling-line.factory.json', 'utf8'));

describe('/api/review', () => {
  it('GET a factory.json in the project: 200 with ok, counts, findings, takt and the file', async () => {
    const r = await handleReview({ method: 'GET', url: '/?file=spec/examples/bottling-line.factory.json&play=0&geometry=0' }, env);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, counts: { error: 0, warning: 2, info: 1 }, file: 'spec/examples/bottling-line.factory.json' });
    expect(r.body.takt).toBeCloseTo(10.48, 2);
    expect(r.body.findings.map((f) => f.check)).toEqual(['placeholder', 'placeholder', 'compiled']);
  }, 60000);

  it('POST a factory.json: a line with errors is still a 200 (the review worked), ok false', async () => {
    const f = structuredClone(bottling);
    f.graph.edges[1].from = 'cap.side';
    const r = await handleReview({ method: 'POST', url: '/', body: JSON.stringify({ factory: f, play: false, geometry: 'no' }) }, env);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(false);
    expect(r.body.findings.filter((x) => x.severity === 'error').map((x) => [x.check, x.path])).toEqual([['edges', 'graph.edges[1].from']]);
    expect(r.body.takt).toBe(null);
    expect('file' in r.body).toBe(false);
  });

  it('bad requests are refused with a reason', async () => {
    const cases = [
      [{ method: 'GET', url: '/' }, 400, /give \?file=/],
      [{ method: 'GET', url: '/?file=../outside.factory.json' }, 400, /not a \.factory\.json inside the project/],
      [{ method: 'GET', url: '/?file=package.json' }, 400, /not a \.factory\.json inside the project/],
      [{ method: 'GET', url: '/?file=spec/examples/missing.factory.json' }, 404, /no file/],
      [{ method: 'POST', url: '/', body: '{not json' }, 400, /the body is not JSON/],
      [{ method: 'POST', url: '/', body: '{"nope":1}' }, 400, /needs \{ "factory"/],
      [{ method: 'PUT', url: '/' }, 405, /GET \?file=/],
    ];
    for (const [req, status, message] of cases) {
      const r = await handleReview(req, env);
      expect(r.status, req.url).toBe(status);
      expect(r.body.error).toMatch(message);
    }
  });

  it('a reviewer that fails: 500 with its message', async () => {
    const r = await handleReview({ method: 'POST', url: '/', body: JSON.stringify({ factory: bottling }) }, { ...env, load: async () => { throw new Error('catalog did not load'); } });
    expect(r).toEqual({ status: 500, body: { error: 'the reviewer failed: catalog did not load' } });
  });

  it('the plugin is for the dev server only and mounts /api/review', () => {
    const plugin = reviewApi();
    expect(plugin).toMatchObject({ name: 'review-api', apply: 'serve' });
    const mounted = [];
    plugin.configureServer({ config: { root: env.root }, middlewares: { use: (path) => mounted.push(path) } });
    expect(mounted).toEqual(['/api/review']);
  });
});

// /api/builder (server/builderApi.js, step 8.5): the routes the approval panel calls, on a temporary
// project root, with the bottling rehearsal ($0) and the real LLM layer in mock mode.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, readdirSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registry } from '../../lib/components/index.js';
import '../../lib/products/index.js';
import '../../lib/ops/index.js';
import { createBuilder } from '../../agents/builder/builder.js';
import { createBuildSession, SessionError } from '../../agents/builder/session.js';
import { loadRehearsal, REHEARSALS, RehearsalError } from '../../agents/builder/rehearsal.js';
import { createLlm, LlmError } from '../../agents/llm.js';
import { createBuilderService } from '../../server/builderApi.js';
import { projectLineStore } from '../../server/lineStore.js';
import { parseFactory } from '../../spec/factory.schema.js';
import { compileFactory } from '../../compiler/emit.js';
import { writeCompiled } from '../../compiler/write.js';

/** A project root with what a rehearsal reads (its example line). */
function tempRoot() {
  const dir = mkdtempSync(join(tmpdir(), 'builder-api-'));
  mkdirSync(join(dir, 'spec', 'examples'), { recursive: true });
  copyFileSync('spec/examples/bottling-line.factory.json', join(dir, 'spec', 'examples', 'bottling-line.factory.json'));
  return dir;
}

function service(root) {
  const lineStore = projectLineStore({ root, registry, parseFactory, compileFactory, writeCompiled });
  const load = async () => ({ registry, createBuilder, createBuildSession, SessionError, loadRehearsal, REHEARSALS, RehearsalError, LlmError, lineStore });
  let llm = null;
  return createBuilderService({ root, load, llm: () => (llm ??= createLlm({ env: { LLM_MODE: 'mock' }, root })) });
}

const post = (svc, path, body = {}) => svc.handle({ method: 'POST', path, body });

describe('/api/builder', () => {
  it('no session at first; the rehearsals listed; bad requests refused', async () => {
    const svc = service(tempRoot());
    expect(await svc.handle({ method: 'GET', path: '/' })).toEqual({ status: 200, body: { session: null, rehearsals: ['bottling'] } });
    expect((await post(svc, '/approve')).status).toBe(409);
    expect((await post(svc, '/start', { rehearsal: 'nowhere' })).body.error).toMatch(/no rehearsal "nowhere"/);
    expect((await post(svc, '/start', {})).status).toBe(400);
    expect((await post(svc, '/start', { line: { id: 'x', title: 'X' }, product: {}, plan: [{ id: 'a' }] })).body.error).toMatch(/transport/);
    expect((await svc.handle({ method: 'DELETE', path: '/' })).status).toBe(405);
    expect((await post(svc, '/nowhere')).status).toBe(409); // no session yet: that comes first
  });

  it('start → approve → reject (comment needed) → reset; drafts written per revision, old ones pruned; the approved line saved', async () => {
    const root = tempRoot();
    const svc = service(root);
    let r = await post(svc, '/start', { rehearsal: 'bottling' });
    expect(r.status).toBe(200);
    expect(r.body.session.gate).toMatchObject({ station: 'fill', phase: 'layout', ok: true });
    expect(r.body.session.source).toMatchObject({ kind: 'rehearsal', name: 'bottling' });
    const url = r.body.session.gate.url;
    expect(url).toMatch(/^\/generated\/_draft\/bottling-rehearsal\/r[a-z0-9]+-1\/line\.js$/);
    expect(existsSync(join(root, url))).toBe(true);

    r = await post(svc, '/approve'); // approves the layout and builds the machines draft
    expect(r.body.session.gate).toMatchObject({ station: 'fill', phase: 'machines', rev: 2 });
    const approved = JSON.parse(readFileSync(join(root, 'generated', '_draft', 'bottling-rehearsal', 'approved.factory.json'), 'utf8'));
    expect(approved.stations.map((s) => s.id)).toEqual(['fill']);

    r = await post(svc, '/reject', { comment: '' });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/needs a comment/);
    expect(r.body.session.gate.phase).toBe('machines'); // nothing lost
    r = await post(svc, '/reject', { comment: 'longer belt' });
    expect(r.body.session.gate).toMatchObject({ phase: 'machines', rev: 3 });
    expect(r.body.session.log.map((l) => l.action)).toEqual(['draft', 'approve', 'draft', 'reject', 'draft']);

    for (let i = 0; i < 6; i += 1) await post(svc, '/approve');
    const revs = readdirSync(join(root, 'generated', '_draft', 'bottling-rehearsal')).filter((n) => /^r/.test(n));
    expect(revs.length).toBeLessThanOrEqual(6); // the last revisions only
    expect((await post(svc, '/next')).status).toBe(409); // a draft is waiting

    r = await post(svc, '/reset');
    expect(r.body.session).toBe(null);
    expect(existsSync(join(root, '.agent-cache', 'builder', 'session.json'))).toBe(false);
  }, 120000);

  it('the session survives a dev-server restart (kept in .agent-cache/builder/session.json)', async () => {
    const root = tempRoot();
    await post(service(root), '/start', { rehearsal: 'bottling' });
    const restarted = service(root);
    const r = await restarted.handle({ method: 'GET', path: '/' });
    expect(r.body.session.gate).toMatchObject({ station: 'fill', phase: 'layout', rev: 1 });
    const next = await post(restarted, '/approve');
    expect(next.body.session.gate).toMatchObject({ phase: 'machines', rev: 2 });
  }, 60000);

  it('a real run in mock mode with nothing recorded: 409 with the mock error, the session kept for a retry', async () => {
    const root = tempRoot();
    const svc = service(root);
    const bottling = JSON.parse(readFileSync('spec/examples/bottling-line.factory.json', 'utf8'));
    const r = await post(svc, '/start', {
      line: { id: 'juice', title: 'Juice', transport: { type: 'beltConveyor' } },
      product: bottling.product,
      plan: [{ id: 'fill', title: 'Filling', does: 'Fills bottles', steps: ['in', 'fill', 'out'] }],
    });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('mock');
    expect(r.body.error).toMatch(/^mock mode: no recorded answer for this builder call \(stationLayout/);
    expect(r.body.session).toMatchObject({ source: { kind: 'llm', mode: 'mock' }, gate: null, phase: 'layout' });
    expect((await post(svc, '/next')).body.code).toBe('mock');
  });

  it('save: only a finished build; it becomes lines/<id>/ version 1, compiled to generated/', async () => {
    const root = tempRoot();
    const svc = service(root);
    await post(svc, '/start', { rehearsal: 'bottling' });
    expect((await post(svc, '/save')).body.error).toMatch(/not finished/);
    let r;
    for (let i = 0; i < 12; i += 1) r = await post(svc, '/approve');
    expect(r.body.session.finished).toBe(true);
    r = await post(svc, '/save');
    expect(r.body.saved).toEqual({ id: 'bottlingRehearsal', version: 1, folder: 'bottling-rehearsal' });
    expect(existsSync(join(root, 'lines', 'bottlingRehearsal', 'versions', 'v0001.json'))).toBe(true);
    expect(existsSync(join(root, 'generated', 'bottling-rehearsal', 'line.js'))).toBe(true);
    expect(JSON.parse(readFileSync(join(root, 'lines', 'bottlingRehearsal', 'versions', 'v0001.json'), 'utf8')).message).toBe('built by the Builder: 4 stations (rehearsal)');
    expect((await post(svc, '/save')).body.error).toMatch(/already a line/);
    expect((await post(svc, '/save', { id: 'juiceCopy' })).body.saved.id).toBe('juiceCopy');
  }, 180000);
});

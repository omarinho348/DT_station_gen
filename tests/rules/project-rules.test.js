// Guards for the always-on rules in Claude.md §3 that can be checked by reading the source.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function sourceFiles(dir) {
  const abs = join(ROOT, dir);
  let out = [];
  for (const name of readdirSync(abs)) {
    const path = join(abs, name);
    if (statSync(path).isDirectory()) out = out.concat(sourceFiles(join(dir, name)));
    else if (/\.(js|mjs)$/.test(name)) out.push(join(dir, name));
  }
  return out;
}

describe('rule 6: generic code', () => {
  it('only lib/components/** mentions a catalog component by name', async () => {
    const { registry } = await import('../../lib/components/index.js');
    const types = registry.components().map((d) => d.type);
    const files = ['lib', 'compiler', 'agents', 'app', 'spec', 'server']
      .filter((dir) => { try { return statSync(join(ROOT, dir)).isDirectory(); } catch { return false; } })
      .flatMap(sourceFiles)
      .filter((file) => !file.replace(/\\/g, '/').startsWith('lib/components/'));
    const offenders = [];
    for (const file of files) {
      const text = readFileSync(join(ROOT, file), 'utf8');
      for (const type of types) if (new RegExp(`\\b${type}\\b`).test(text)) offenders.push(`${file}: ${type}`);
    }
    expect(offenders).toEqual([]);
  });
});

describe('rule 5: deterministic behaviour', () => {
  it('no Math.random anywhere in the library, compiler, agents or app', () => {
    const offenders = ['lib', 'compiler', 'agents', 'app', 'spec']
      .flatMap(sourceFiles)
      .filter((file) => /Math\s*\.\s*random/.test(readFileSync(join(ROOT, file), 'utf8')));
    expect(offenders).toEqual([]);
  });
});

describe('source hygiene', () => {
  // A binding imported twice is a SyntaxError in the browser, but Vitest's transform lets it
  // through (it happened once in Phase 4 step 5). Caught here instead.
  it('no module imports the same binding twice', () => {
    const offenders = [];
    const dirs = ['lib', 'compiler', 'agents', 'app', 'spec', 'server', 'scripts']
      .filter((dir) => { try { return statSync(join(ROOT, dir)).isDirectory(); } catch { return false; } });
    for (const file of dirs.flatMap(sourceFiles)) {
      const text = readFileSync(join(ROOT, file), 'utf8');
      const seen = new Set();
      for (const m of text.matchAll(/^import\s+(?:\*\s+as\s+(\w+)|\{([^}]*)\}|(\w+))[^;]*from\s+['"][^'"]+['"];?/gm)) {
        const names = m[1] ? [m[1]] : m[3] ? [m[3]] : m[2].split(',').map((n) => n.trim().split(/\s+as\s+/).pop()).filter(Boolean);
        for (const name of names) {
          if (seen.has(name)) offenders.push(`${file}: ${name}`);
          seen.add(name);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

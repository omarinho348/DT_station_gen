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

describe('rule 5: deterministic behaviour', () => {
  it('no Math.random anywhere in the library, compiler, agents or app', () => {
    const offenders = ['lib', 'compiler', 'agents', 'app', 'spec']
      .flatMap(sourceFiles)
      .filter((file) => /Math\s*\.\s*random/.test(readFileSync(join(ROOT, file), 'utf8')));
    expect(offenders).toEqual([]);
  });
});

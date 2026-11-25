// Writes and runs a line's SimPy model (Phase 11): simpy/<folder>/model.py from compiler/simpy.js, run
// with Python on demand (Claude.md §5), its trace.jsonl and kpis.json read back. Node only.
//
//   writeModel({ root, registry, factory, source })  → { dir, file, data }
//   runModel(dir, { python })                        → { kpis, events (count), stdout, seconds }
//   readResults(dir)                                 → { kpis, trace (events) } or null
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { simData, emitSimPy } from '../compiler/simpy.js';
import { lineFolder } from '../compiler/emit.js';

export class SimpyError extends Error {}

export function writeModel({ root, registry, factory, source = 'factory.json' }) {
  const data = simData(registry, factory);
  const dir = join(root, 'simpy', lineFolder(data.line));
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'model.py');
  writeFileSync(file, emitSimPy(data, { source }));
  return { dir, file, data };
}

/** Runs model.py with Python (PYTHON env or "python"); resolves with the results it wrote. */
export function runModel(dir, { python = process.env.PYTHON || 'python', timeoutMs = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(python, ['model.py', '--out', dir], { cwd: dir, windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new SimpyError(`the SimPy run took over ${timeoutMs / 1000} s and was stopped`)); }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (error) => { clearTimeout(timer); reject(new SimpyError(`could not start Python ("${python}"): ${error.message}`)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const missing = /No module named ['"]?simpy/.test(stderr);
        reject(new SimpyError(missing ? 'Python has no simpy module: pip install simpy' : `model.py failed (exit ${code}): ${stderr.trim().split('\n').slice(-3).join(' ')}`));
        return;
      }
      const results = readResults(dir);
      resolve({ ...results, stdout: stdout.trim(), seconds: (Date.now() - started) / 1000 });
    });
  });
}

/** The results of the last run, or null. */
export function readResults(dir) {
  const kpisFile = join(dir, 'kpis.json');
  if (!existsSync(kpisFile)) return null;
  const trace = readFileSync(join(dir, 'trace.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return { kpis: JSON.parse(readFileSync(kpisFile, 'utf8')), trace };
}

// The zip download of a line (Claude.md §2 "a zip download of the generated files", Phase 11): its
// factory.json (the source of truth) and version history, the compiled Three.js files, the SimPy model
// with its last run, and the SDD documents when the line came from the Spec flow. Node only (fflate).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { zipSync, strToU8 } from 'fflate';

const filesIn = (dir, filter = () => true) => (existsSync(dir) ? readdirSync(dir).filter((n) => statSync(join(dir, n)).isFile() && filter(n)).sort() : []);

/**
 * @param {object} o
 * @param {string} o.root
 * @param {string} o.id        the line id (lines/<id>/)
 * @param {string} o.folder    its compiled / SimPy folder (generated/<folder>/, simpy/<folder>/)
 * @param {object[]} [o.history]  the line store's history (newest first)
 * @param {Date} [o.time]      the zip entries' time (tests pass a fixed one)
 * @returns {{ bytes: Uint8Array, files: string[] }}
 */
export function lineZip({ root, id, folder, history = [], time = new Date() }) {
  const entries = {};
  const add = (name, data) => { entries[`${id}/${name}`] = [typeof data === 'string' ? strToU8(data) : data, { mtime: time }]; };
  const lineDir = join(root, 'lines', id);
  if (!existsSync(join(lineDir, 'factory.json'))) throw new Error(`no line "${id}" in lines/`);
  add('factory.json', readFileSync(join(lineDir, 'factory.json')));
  add('history.json', `${JSON.stringify(history, null, 2)}\n`);
  for (const n of filesIn(join(root, 'generated', folder), (x) => x.endsWith('.js'))) add(`generated/${n}`, readFileSync(join(root, 'generated', folder, n)));
  for (const n of filesIn(join(root, 'simpy', folder), (x) => ['model.py', 'kpis.json', 'trace.jsonl'].includes(x))) add(`simpy/${n}`, readFileSync(join(root, 'simpy', folder, n)));
  if (existsSync(join(root, 'simpy', 'FORMAT.md'))) add('simpy/FORMAT.md', readFileSync(join(root, 'simpy', 'FORMAT.md')));
  for (const n of filesIn(join(root, 'sdd', id))) add(`sdd/${n}`, readFileSync(join(root, 'sdd', id, n)));
  const names = Object.keys(entries).map((k) => k.slice(id.length + 1));
  add('README.md', `# ${id}

Downloaded from the digital-twin line builder.

| Path | What |
|---|---|
| \`factory.json\` | the line as data: the single source of truth; every file below is made from it |
| \`history.json\` | its versions (who changed what, as JSON Patch op counts) |
| \`generated/\` | the compiled Three.js files (one per station plus \`line.js\`); they import the project's \`lib/\` (\`../../lib\`), so they run inside the project, under \`generated/${folder}/\` |
| \`simpy/model.py\` | the SimPy model (\`python model.py\`; needs \`simpy\`), and its last run's \`kpis.json\` / \`trace.jsonl\` when there was one; \`FORMAT.md\` describes them |
| \`sdd/\` | the approved SDD documents (constitution, factory brief, plan) when the line came from the Spec flow |

Files in this zip: ${names.length}.
`);
  return { bytes: zipSync(entries, { level: 6 }), files: Object.keys(entries) };
}

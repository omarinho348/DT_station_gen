// Writes spec/factory.schema.json from spec/factory.schema.js (zod is the source; the JSON file is
// for editors, docs and, later, Structured Outputs). A test fails when the file is out of date.
//   npm run schema
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { factoryJsonSchema } from '../spec/factory.schema.js';

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../spec/factory.schema.json');
writeFileSync(out, `${JSON.stringify(factoryJsonSchema(), null, 2)}\n`);
console.log(`written ${out}`);

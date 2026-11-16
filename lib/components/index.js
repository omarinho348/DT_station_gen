// Loads every component file under lib/components/** so each one registers itself.
// Adding a component = adding a file here; nothing else in the code base changes (rule 6).
import { registry } from '../registry.js';

import.meta.glob(['./**/*.js', '!./index.js'], { eager: true });

export { registry };

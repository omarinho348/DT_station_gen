// Loads every product (lib/products/<name>/index.js) so each one registers itself. Adding a
// product = adding a folder; nothing else in the code base changes (rule 6).
import { registry } from '../registry.js';

import.meta.glob('./*/index.js', { eager: true });

export { registry };

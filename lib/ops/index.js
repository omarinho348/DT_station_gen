// Loads every op (lib/ops/basic/*.js now, named ops later) so each one registers itself.
// Adding an op = adding a file; nothing else in the code base changes.
import { registry } from '../registry.js';

import.meta.glob(['./basic/*.js', './named/*.js'], { eager: true });

export { registry };
export { OpCycle, OpError, UNKNOWN, dryRun, wrapValue, wrapDelta } from './OpCycle.js';

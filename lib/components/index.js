// Loads every component file under lib/components/** (tuned, named components) and lib/basics/**
// (basic building blocks: frames, axes, tools, transport, buffers; Phase 6) so each one registers
// itself. Adding a component = adding a file there; nothing else in the code base changes (rule 6).
import { registry } from '../registry.js';

import.meta.glob(['./**/*.js', '!./index.js', '../basics/**/*.js'], { eager: true });

export { registry };

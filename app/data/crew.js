// The agent crew shown on the setup page. Static description only; behaviour lives in agents/.
// `llm: false` members are plain code ("direct") and never call a model.
import { z } from 'zod';

export const CrewMember = z.object({
  id: z.string().regex(/^[a-z][a-zA-Z]*$/),
  group: z.enum(['build', 'oversight']),
  name: z.string().min(1),
  role: z.string().min(1).max(90),
  icon: z.string().min(1),
  llm: z.boolean(),
  strongAllowed: z.boolean().default(false), // may use the stronger model (plan.md only, if enabled)
});

export const CREW = z.array(CrewMember).parse([
  {
    id: 'spec',
    group: 'build',
    name: 'Spec',
    role: 'Writes the constitution, factory brief and plan from your description',
    icon: 'ScrollText',
    llm: true,
    strongAllowed: true,
  },
  {
    id: 'builder',
    group: 'build',
    name: 'Builder',
    role: 'Turns the plan into factory.json, one station at a time',
    icon: 'Boxes',
    llm: true,
  },
  {
    id: 'reviewer',
    group: 'build',
    name: 'Reviewer',
    role: 'Critiques the line against the brief once the checks pass',
    icon: 'ShieldCheck',
    llm: true,
  },
  {
    id: 'editor',
    group: 'build',
    name: 'Editor',
    role: 'Turns your change requests into JSON Patch edits, with undo',
    icon: 'PencilRuler',
    llm: true,
  },
  {
    id: 'orchestrator',
    group: 'oversight',
    name: 'Orchestrator',
    role: 'Runs the crew step by step and stops for your approval',
    icon: 'Workflow',
    llm: false,
  },
  {
    id: 'checks',
    group: 'oversight',
    name: 'Deterministic checks',
    role: 'Schema, catalog, overlaps, ports, reach and takt. Free, always first',
    icon: 'ListChecks',
    llm: false,
  },
]);

export const SETUP_STEPS = [
  { id: 'crew', title: 'Meet the crew', short: 'Crew' },
  { id: 'brief', title: 'Describe the factory', short: 'Brief' },
  { id: 'docs', title: 'Review the documents', short: 'Documents' },
  { id: 'build', title: 'Build the line', short: 'Build' },
];

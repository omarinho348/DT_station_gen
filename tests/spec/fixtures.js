// Shared SDD test data: a small brief and plan for an apple-juice line (Phase 9).
export const juiceBrief = {
  id: 'juiceLine',
  title: 'Apple juice bottling',
  product: {
    name: 'Apple juice, 1 L glass bottle',
    description: 'A 1 litre glass bottle of cloudy apple juice with a red screw cap and a paper label.',
    model: { kind: 'parametric', params: { shape: 'bottle', length: 0.09, width: 0.09, height: 0.26, finish: 'glass', liquid: '#d9a21b', labelText: 'APPLE JUICE', rejectEvery: 4 } },
  },
  targetPerHour: 240,
  runSize: 8,
  steps: [
    { name: 'Fill', does: 'Fill each empty bottle with juice' },
    { name: 'Cap', does: 'Screw a cap on' },
    { name: 'Inspect', does: 'Check fill level and cap; reject bad bottles' },
  ],
  quality: 'A camera checks fill level and cap; rejects leave on a side lane.',
  constraints: ['Food grade: stainless frames'],
  assumptions: ['One bottle at a time'],
  questions: [],
};

export const juicePlan = {
  transport: 'beltConveyor',
  stations: [
    { id: 'filling', code: 'ST1', title: 'Filling', does: 'Fills each bottle', steps: ['bottle in', 'nozzle down', 'fill 6 s', 'nozzle up', 'bottle out'], seconds: 12, covers: ['Fill'], machines: ['beltConveyor'] },
    { id: 'capping', code: 'ST2', title: 'Capping', does: 'Screws the cap on', steps: ['bottle in', 'cap placed', 'cap screwed', 'bottle out'], seconds: 10, covers: ['Cap'], machines: [] },
    { id: 'inspection', code: 'ST3', title: 'Inspection', does: 'Checks the bottle', steps: ['bottle in', 'camera check', 'reject or pass'], seconds: 8, covers: ['Inspect'], machines: [] },
  ],
  notes: ['Filling is the slowest station'],
};

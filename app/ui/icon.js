// lucide icons as inline SVG strings, so they can go straight into template literals.
import * as lucide from 'lucide';

export function icon(name, { size = 18, stroke = 1.75, cls = '' } = {}) {
  const node = lucide[name];
  if (!node) throw new Error(`Unknown icon "${name}"`);
  const el = lucide.createElement(node, {
    width: size,
    height: size,
    'stroke-width': stroke,
    class: `icon ${cls}`.trim(),
    'aria-hidden': 'true',
  });
  return el.outerHTML;
}

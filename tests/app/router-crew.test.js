import { describe, it, expect } from 'vitest';
import { resolveRoute, href } from '../../app/router.js';
import { CREW, SETUP_STEPS } from '../../app/data/crew.js';
import { normalizeTheme, nextTheme, loadTheme } from '../../app/ui/theme.js';
import { APP_NAME } from '../../app/brand.js';

describe('hash router', () => {
  it('resolves pages and sub-steps', () => {
    expect(resolveRoute('')).toEqual({ page: 'setup', sub: null, query: {} });
    expect(resolveRoute('#/setup')).toMatchObject({ page: 'setup', sub: null });
    expect(resolveRoute('#/setup/brief')).toMatchObject({ page: 'setup', sub: 'brief' });
    expect(resolveRoute('#/twin')).toMatchObject({ page: 'twin', sub: null });
  });

  it('parses query parameters after the route', () => {
    expect(resolveRoute('#/twin?demo=core')).toEqual({ page: 'twin', sub: null, query: { demo: 'core' } });
    expect(resolveRoute('#/setup/crew?theme=dark')).toEqual({ page: 'setup', sub: 'crew', query: { theme: 'dark' } });
  });

  it('routes the component gallery', () => {
    expect(resolveRoute('#/gallery')).toMatchObject({ page: 'gallery', sub: null });
    expect(resolveRoute('#/gallery/someType?golden=1')).toEqual({ page: 'gallery', sub: 'someType', query: { golden: '1' } });
  });

  it('falls back to setup for unknown routes', () => {
    expect(resolveRoute('#/nope/brief')).toMatchObject({ page: 'setup', sub: null });
  });

  it('builds hrefs that resolve back', () => {
    expect(resolveRoute(href('setup', 'docs'))).toMatchObject({ page: 'setup', sub: 'docs' });
    expect(resolveRoute(href('twin'))).toMatchObject({ page: 'twin', sub: null });
  });
});

describe('theme and brand', () => {
  it('is named TwinGen', () => {
    expect(APP_NAME).toBe('TwinGen');
  });

  it('toggles between light and dark and rejects unknown values', () => {
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('dark')).toBe('light');
    expect(normalizeTheme('purple')).toBe('light');
  });

  it('defaults to light without storage, and lets a URL override win', () => {
    expect(loadTheme()).toBe('light'); // Node has no localStorage: must not throw
    expect(loadTheme('dark')).toBe('dark');
    expect(loadTheme('nonsense')).toBe('light');
  });
});

describe('crew and setup steps', () => {
  it('has the four LLM agents from the spec and only code-only oversight', () => {
    expect(CREW.filter((m) => m.llm).map((m) => m.id)).toEqual(['spec', 'builder', 'reviewer', 'editor']);
    expect(CREW.filter((m) => m.group === 'oversight').every((m) => !m.llm)).toBe(true);
  });

  it('only lets the Spec agent use the strong model', () => {
    expect(CREW.filter((m) => m.strongAllowed).map((m) => m.id)).toEqual(['spec']);
  });

  it('has unique ids and the agreed step order', () => {
    expect(new Set(CREW.map((m) => m.id)).size).toBe(CREW.length);
    expect(SETUP_STEPS.map((s) => s.id)).toEqual(['crew', 'brief', 'docs', 'build']);
  });
});

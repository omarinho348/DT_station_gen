import { describe, it, expect } from 'vitest';
import { parseArgs, nameFor } from '../../scripts/screenshot.js';

describe('screenshot script arguments', () => {
  it('defaults to the home page at 1600x900, waiting for __appReady', () => {
    const o = parseArgs([]);
    expect(o).toMatchObject({ path: '/', url: null, width: 1600, height: 900, settle: 3 });
    expect(o.ready).toBe('window.__appReady === true');
    expect(o.out.replace(/\\/g, '/')).toBe('screenshots/home.png');
  });

  it('parses path, size, out and ready', () => {
    const o = parseArgs(['gallery.html', '--size', '1280x720', '--out', 'x/y.png', '--ready', 'window.ok']);
    expect(o).toMatchObject({ path: '/gallery.html', width: 1280, height: 720, out: 'x/y.png', ready: 'window.ok' });
  });

  it('accepts hash routes and names the file after them', () => {
    expect(parseArgs(['#/twin']).path).toBe('/#/twin');
    expect(parseArgs(['#/setup/brief']).out.replace(/\\/g, '/')).toBe('screenshots/setup-brief.png');
    expect(parseArgs(['--url', 'http://localhost:5173/#/twin']).out.replace(/\\/g, '/')).toBe('screenshots/twin.png');
  });

  it('names the output after the page', () => {
    expect(nameFor('/')).toBe('home');
    expect(nameFor('/gallery.html')).toBe('gallery');
    expect(nameFor('/a/b/')).toBe('a-b');
    expect(nameFor('/#/setup/docs')).toBe('setup-docs');
  });

  it('rejects bad input clearly', () => {
    expect(() => parseArgs(['--size', 'big'])).toThrow(/1600x900/);
    expect(() => parseArgs(['--nope'])).toThrow(/Unknown option/);
    expect(() => parseArgs(['--out'])).toThrow(/Missing value/);
  });
});

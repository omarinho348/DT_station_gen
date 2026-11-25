// The app's small markdown renderer (app/ui/markdown.js), used for the SDD document previews.
import { describe, it, expect } from 'vitest';
import { markdownToHtml } from '../../app/ui/markdown.js';
import { renderPlan, renderBrief, renderConstitution } from '../../spec/sdd/render.js';
import { juiceBrief, juicePlan } from '../spec/fixtures.js';

describe('markdownToHtml', () => {
  it('headings, paragraphs, lists, tables and inline marks', () => {
    const html = markdownToHtml('# Title\n\nSome **bold** and _italic_ with `code`\nsame paragraph.\n\n- a\n- b\n\n1. one\n2. two\n\n| A | B |\n|---|---|\n| 1 | x \\| y |');
    expect(html).toBe([
      '<h1>Title</h1>',
      '<p>Some <strong>bold</strong> and <em>italic</em> with <code>code</code> same paragraph.</p>',
      '<ul><li>a</li><li>b</li></ul>',
      '<ol><li>one</li><li>two</li></ol>',
      '<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>x | y</td></tr></tbody></table>',
    ].join('\n'));
  });

  it('escapes everything: no HTML from a document reaches the page; snake_case words stay', () => {
    const html = markdownToHtml('Hi <img src=x onerror=alert(1)> & "q"\n\n- <script>x</script>\n\nsome_snake_case');
    expect(html).not.toMatch(/<img|<script/);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;q&quot;');
    expect(html).toContain('some_snake_case');
  });

  it('renders the three SDD documents (tables, lists, headings) without leftovers', () => {
    for (const md of [renderConstitution(), renderBrief(juiceBrief), renderPlan(juicePlan, juiceBrief)]) {
      const html = markdownToHtml(md);
      expect(html).toMatch(/^<h1>/);
      expect(html).not.toMatch(/\n\|/); // no raw table rows
      expect(html).not.toMatch(/\*\*/); // no raw bold
    }
    expect(markdownToHtml(renderPlan(juicePlan, juiceBrief))).toContain('<td>Filling (<code>filling</code>)</td>');
  });
});

import { describe, expect, it } from 'vitest';
import { parseObsidianNote } from '../src/obsidian/markdown';

describe('Obsidian Markdown parsing', () => {
  it('indexes prose, headings, tags and aliases without retaining code', () => {
    const note = parseObsidianNote({
      path: 'Research/AI evaluation.md',
      modifiedAt: 1_777_000_000_000,
      size: 900,
      markdown: `---
tags: [AI, evaluation]
---
# Production evaluation

## Representative benchmarks

Production AI evaluation needs representative benchmarks, explicit failure analysis, and clear decision thresholds. This is the part I want to remember.

It connects to [[Reliability|reliability engineering]] and #deployment, which makes the same release decision easier to explain and repeat.

\`\`\`ts
const secretImplementationDetail = 'must not be indexed';
\`\`\`
`,
    });

    expect(note.title).toBe('Production evaluation');
    expect(note.fragments).toHaveLength(2);
    expect(note.fragments[0]).toMatchObject({
      heading: 'Representative benchmarks',
      kind: 'own-note',
      tags: expect.arrayContaining(['AI', 'evaluation', 'deployment']),
      links: ['Reliability'],
    });
    expect(
      note.fragments.some((fragment) =>
        fragment.text.includes('reliability engineering'),
      ),
    ).toBe(true);
    expect(JSON.stringify(note)).not.toContain('secretImplementationDetail');
  });

  it('keeps quotes and imported notes weaker than own writing', () => {
    const quoted = parseObsidianNote({
      path: 'Quotes.md',
      modifiedAt: 1,
      size: 200,
      markdown:
        '> Production AI evaluation requires representative benchmarks and explicit failure analysis before deployment decisions can be trusted.',
    });
    const imported = parseObsidianNote({
      path: 'Imports/article.md',
      modifiedAt: 1,
      size: 300,
      markdown: `---
source_url: https://example.com/article
---
Production AI evaluation requires representative benchmarks and explicit failure analysis before deployment decisions can be trusted.
`,
    });

    expect(quoted.fragments[0]?.kind).toBe('quote');
    expect(imported.fragments[0]?.kind).toBe('imported');
    expect(imported.sourceUrl).toBe('https://example.com/article');
    expect(quoted.fragments[0]?.attentionStrength).toBeLessThan(0.6);
    expect(imported.fragments[0]?.attentionStrength).toBeLessThan(0.6);
  });
});

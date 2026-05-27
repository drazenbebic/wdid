import { describe, expect, it } from 'vitest';
import { renderTable } from './format.js';

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;
const stripAnsi = (s: string) => s.replace(ANSI, '');

describe('renderTable', () => {
  it('renders an em-dash when the commit has no ticket', () => {
    const output = stripAnsi(
      renderTable([
        { date: '2026-05-27', ticket: null, description: 'chore: bump deps' },
      ]),
    );
    expect(output).toContain('—');
    expect(output).toContain('chore: bump deps');
  });

  it('renders the ticket id when present', () => {
    const output = stripAnsi(
      renderTable([
        {
          date: '2026-05-27',
          ticket: 'ABC-123',
          description: 'feat(ABC-123): add login',
        },
      ]),
    );
    expect(output).toContain('ABC-123');
    expect(output).not.toContain('—');
  });
});

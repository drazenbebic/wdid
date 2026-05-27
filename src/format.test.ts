import { describe, expect, it } from 'vitest';
import { renderTable } from './format.js';

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;
const stripAnsi = (s: string) => s.replace(ANSI, '');

describe('renderTable', () => {
  it('renders an em-dash when the commit has no ticket', () => {
    const output = stripAnsi(
      renderTable([
        {
          date: '2026-05-27',
          time: '14:30',
          ticket: null,
          description: 'chore: bump deps',
        },
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
          time: '14:30',
          ticket: 'ABC-123',
          description: 'feat(ABC-123): add login',
        },
      ]),
    );
    expect(output).toContain('ABC-123');
    expect(output).not.toContain('—');
  });

  it('renders date and time together in the date column', () => {
    const output = stripAnsi(
      renderTable([
        {
          date: '2026-05-27',
          time: '14:30',
          ticket: null,
          description: 'chore: bump deps',
        },
      ]),
    );
    expect(output).toContain('2026-05-27 14:30');
  });

  it('uses the provided ticket column label', () => {
    const output = stripAnsi(
      renderTable(
        [
          {
            date: '2026-05-27',
            time: '14:30',
            ticket: 'feat(auth)',
            description: 'feat(auth): add login',
          },
        ],
        'Type',
      ),
    );
    expect(output).toContain('Type');
    expect(output).not.toContain('Ticket');
  });

  it('defaults the column label to "Ticket"', () => {
    const output = stripAnsi(
      renderTable([
        {
          date: '2026-05-27',
          time: '14:30',
          ticket: 'ABC-123',
          description: 'feat(ABC-123): add login',
        },
      ]),
    );
    expect(output).toContain('Ticket');
  });

  it('renders just the date when time is empty', () => {
    const output = stripAnsi(
      renderTable([
        {
          date: '2026-05-27',
          time: '',
          ticket: null,
          description: 'chore: bump deps',
        },
      ]),
    );
    expect(output).toContain('2026-05-27');
    expect(output).not.toMatch(/2026-05-27\s+\d/);
  });
});

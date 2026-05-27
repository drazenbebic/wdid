import { describe, expect, it } from 'vitest';
import {
  renderJson,
  renderTable,
  renderTableGroupedByDay,
  toJsonKey,
} from './format.js';

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
          branch: null,
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
          branch: null,
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
          branch: null,
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
            branch: null,
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
          branch: null,
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
          branch: null,
        },
      ]),
    );
    expect(output).toContain('2026-05-27');
    expect(output).not.toMatch(/2026-05-27\s+\d/);
  });

  it('appends the branch name in brackets when set', () => {
    const output = stripAnsi(
      renderTable([
        {
          date: '2026-05-27',
          time: '14:30',
          ticket: 'ABC-123',
          description: 'feat(ABC-123): add login',
          branch: 'feat/login',
        },
      ]),
    );
    expect(output).toContain('feat(ABC-123): add login');
    expect(output).toContain('[feat/login]');
  });

  it('renders day section headers in grouped mode', () => {
    const output = stripAnsi(
      renderTableGroupedByDay([
        {
          date: '2026-05-27',
          time: '17:44',
          ticket: null,
          description: 'feat: a',
          branch: null,
        },
        {
          date: '2026-05-27',
          time: '17:40',
          ticket: null,
          description: 'fix: b',
          branch: null,
        },
        {
          date: '2026-05-26',
          time: '11:08',
          ticket: null,
          description: 'chore: c',
          branch: null,
        },
      ]),
    );

    expect(output).toContain('Time');
    expect(output).not.toContain('Date');
    expect(output).toContain('2026-05-27');
    expect(output).toContain('2026-05-26');
    expect(output).toContain('17:44');
    expect(output).toContain('11:08');
  });

  it('does not repeat the date heading for consecutive same-day rows', () => {
    const output = stripAnsi(
      renderTableGroupedByDay([
        {
          date: '2026-05-27',
          time: '17:44',
          ticket: null,
          description: 'a',
          branch: null,
        },
        {
          date: '2026-05-27',
          time: '17:40',
          ticket: null,
          description: 'b',
          branch: null,
        },
        {
          date: '2026-05-27',
          time: '17:36',
          ticket: null,
          description: 'c',
          branch: null,
        },
      ]),
    );

    const matches = output.match(/2026-05-27/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it('renders a parseable JSON array of entries', () => {
    const entries = [
      {
        date: '2026-05-27',
        time: '14:30',
        ticket: 'ABC-123',
        description: 'feat(ABC-123): add login',
        branch: 'feat/login',
      },
      {
        date: '2026-05-27',
        time: '11:08',
        ticket: null,
        description: 'chore: bump deps',
        branch: null,
      },
    ];
    const parsed = JSON.parse(renderJson(entries));
    expect(parsed).toEqual(entries);
  });

  it('renders an empty array when there are no entries', () => {
    expect(JSON.parse(renderJson([]))).toEqual([]);
  });

  it('uses the column label as the JSON key for the ticket field', () => {
    const json = renderJson(
      [
        {
          date: '2026-05-27',
          time: '14:30',
          ticket: 'feat(auth)',
          description: 'feat(auth): add login',
          branch: null,
        },
      ],
      'Type',
    );
    const parsed = JSON.parse(json);

    expect(parsed[0].type).toBe('feat(auth)');
    expect(parsed[0]).not.toHaveProperty('ticket');
  });

  it('snake-cases multi-word column labels into JSON keys', () => {
    expect(toJsonKey('Ticket')).toBe('ticket');
    expect(toJsonKey('Type')).toBe('type');
    expect(toJsonKey('Pull Request')).toBe('pull_request');
    expect(toJsonKey('Linked  Issue')).toBe('linked_issue');
  });

  it('omits the branch suffix when null', () => {
    const output = stripAnsi(
      renderTable([
        {
          date: '2026-05-27',
          time: '14:30',
          ticket: null,
          description: 'chore: bump deps',
          branch: null,
        },
      ]),
    );
    expect(output).not.toMatch(/\[[^\]]+]/);
  });
});

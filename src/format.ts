import Table from 'cli-table3';
import chalk from 'chalk';
import type { CommitEntry } from './git.js';

function renderDateCell(entry: CommitEntry): string {
  if (!entry.time) {
    return entry.date;
  }

  return `${entry.date} ${chalk.dim(entry.time)}`;
}

function renderDescriptionCell(entry: CommitEntry): string {
  if (!entry.branch) {
    return entry.description;
  }

  return `${entry.description} ${chalk.magenta(`[${entry.branch}]`)}`;
}

export function renderTable(
  entries: CommitEntry[],
  ticketColumnLabel = 'Ticket',
): string {
  const table = new Table({
    head: [
      chalk.bold.cyan('Date'),
      chalk.bold.cyan(ticketColumnLabel),
      chalk.bold.cyan('Description'),
    ],
    style: { head: [], border: [] },
    wordWrap: true,
    colWidths: [18, 14, 80],
  });

  for (const entry of entries) {
    table.push([
      renderDateCell(entry),
      entry.ticket ? chalk.yellow(entry.ticket) : chalk.gray('—'),
      renderDescriptionCell(entry),
    ]);
  }

  return table.toString();
}

export function renderTableGroupedByDay(
  entries: CommitEntry[],
  ticketColumnLabel = 'Ticket',
): string {
  const table = new Table({
    head: [
      chalk.bold.cyan('Time'),
      chalk.bold.cyan(ticketColumnLabel),
      chalk.bold.cyan('Description'),
    ],
    style: { head: [], border: [] },
    wordWrap: true,
    colWidths: [8, 14, 90],
  });

  let currentDate = '';

  for (const entry of entries) {
    if (entry.date && entry.date !== currentDate) {
      table.push([
        {
          content: chalk.bold(entry.date),
          colSpan: 3,
          hAlign: 'left' as const,
        },
      ]);
      currentDate = entry.date;
    }

    table.push([
      entry.time ? chalk.dim(entry.time) : chalk.gray('—'),
      entry.ticket ? chalk.yellow(entry.ticket) : chalk.gray('—'),
      renderDescriptionCell(entry),
    ]);
  }

  return table.toString();
}

export function toJsonKey(label: string): string {
  return label.toLowerCase().replace(/\s+/g, '_');
}

export function renderJson(
  entries: CommitEntry[],
  ticketColumnLabel = 'Ticket',
): string {
  const key = toJsonKey(ticketColumnLabel);
  const transformed = entries.map(e => ({
    sha: e.sha,
    date: e.date,
    time: e.time,
    [key]: e.ticket,
    description: e.description,
    branch: e.branch,
  }));

  return JSON.stringify(transformed, null, 2);
}

export function renderEmpty(): string {
  return chalk.gray('No commits found for the given filters.');
}

export function renderError(message: string): string {
  return chalk.red(`error: ${message}`);
}

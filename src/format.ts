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

export function renderEmpty(): string {
  return chalk.gray('No commits found for the given filters.');
}

export function renderError(message: string): string {
  return chalk.red(`error: ${message}`);
}

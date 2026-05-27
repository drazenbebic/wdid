import Table from 'cli-table3';
import chalk from 'chalk';
import type { CommitEntry } from './git.js';

export function renderTable(entries: CommitEntry[]): string {
  const table = new Table({
    head: [
      chalk.bold.cyan('Date'),
      chalk.bold.cyan('Ticket'),
      chalk.bold.cyan('Description'),
    ],
    style: { head: [], border: [] },
    wordWrap: true,
    colWidths: [12, 14, 80],
  });

  for (const entry of entries) {
    table.push([
      chalk.dim(entry.date),
      entry.ticket ? chalk.yellow(entry.ticket) : chalk.gray('—'),
      entry.description,
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

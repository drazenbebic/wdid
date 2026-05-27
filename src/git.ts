import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface CommitEntry {
  date: string;
  time: string;
  ticket: string | null;
  description: string;
}

export interface GitLogOptions {
  author: string;
  pattern: RegExp;
  from?: string;
  to?: string;
  cwd: string;
}

const FIELD_SEP = '\x1f';
const RECORD_SEP = '\x1e';

const pad2 = (n: number): string => String(n).padStart(2, '0');

export function formatLocalDateTime(iso: string): {
  date: string;
  time: string;
} {
  const d = new Date(iso);

  if (Number.isNaN(d.getTime())) {
    return { date: '', time: '' };
  }

  const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

  return { date, time };
}

export function extractTicket(message: string, pattern: RegExp): string | null {
  const match = message.match(pattern);

  if (!match) {
    return null;
  }

  return match[1] ?? match[0];
}

export async function getGitUserName(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['config', 'user.name'], {
      cwd,
    });
    const name = stdout.trim();

    if (!name) {
      throw new Error('empty');
    }

    return name;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('git is not installed or not on PATH', { cause: err });
    }

    throw new Error(
      'could not read git user.name — set it with `git config user.name "Your Name"` or pass --author',
      { cause: err },
    );
  }
}

export async function getCommits(opts: GitLogOptions): Promise<CommitEntry[]> {
  const args = [
    'log',
    '--all',
    '--author-date-order',
    '--regexp-ignore-case',
    `--author=${opts.author}`,
    `--pretty=format:%cI${FIELD_SEP}%s${RECORD_SEP}`,
  ];

  if (opts.from) {
    args.push(`--after=${opts.from} 00:00`);
  }

  if (opts.to) {
    args.push(`--before=${opts.to} 23:59`);
  }

  const { stdout } = await execFileAsync('git', args, {
    cwd: opts.cwd,
    maxBuffer: 32 * 1024 * 1024,
  });

  return stdout
    .split(RECORD_SEP)
    .map(r => r.trim())
    .filter(r => r.length > 0)
    .map(record => {
      const [iso = '', subject = ''] = record.split(FIELD_SEP);
      const { date, time } = formatLocalDateTime(iso);

      return {
        date,
        time,
        ticket: extractTicket(subject, opts.pattern),
        description: subject,
      };
    });
}

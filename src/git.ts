import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface CommitEntry {
  date: string;
  time: string;
  ticket: string | null;
  description: string;
  branch: string | null;
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

const TRUNK_BRANCHES = new Set(['main', 'master']);

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

export function normalizeBranchName(rawName: string): string | null {
  const clean = rawName.replace(/[~^].*$/, '').trim();

  if (!clean || clean === 'undefined' || TRUNK_BRANCHES.has(clean)) {
    return null;
  }

  return clean;
}

async function runGitWithStdin(
  cwd: string,
  args: string[],
  input: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, { cwd });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', chunk => {
      stdout += chunk.toString();
    });
    proc.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });
    proc.on('error', reject);
    proc.on('close', code => {
      if (code !== 0) {
        reject(new Error(`git ${args.join(' ')} failed: ${stderr.trim()}`));

        return;
      }

      resolve(stdout);
    });

    proc.stdin.write(input);
    proc.stdin.end();
  });
}

export async function getBranchMap(
  cwd: string,
  shas: string[],
): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();

  if (shas.length === 0) {
    return map;
  }

  let stdout: string;
  try {
    stdout = await runGitWithStdin(
      cwd,
      ['name-rev', '--stdin', '--refs=refs/heads/*'],
      shas.join('\n') + '\n',
    );
  } catch {
    // If name-rev fails (e.g. detached HEAD with no matching refs), just skip annotations.
    return map;
  }

  for (const line of stdout.split('\n')) {
    const m = line.match(/^([0-9a-fA-F]+)\s+\((.+)\)\s*$/);

    if (!m) {
      continue;
    }

    const sha = m[1];
    const rawName = m[2];

    if (!sha || !rawName) {
      continue;
    }

    map.set(sha, normalizeBranchName(rawName));
  }

  return map;
}

export async function assertGitRepo(cwd: string): Promise<void> {
  try {
    await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd,
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('git is not installed or not on PATH', { cause: err });
    }

    throw new Error(
      `not inside a git repository: ${cwd} — cd into a repo or pass --repo <path>`,
      { cause: err },
    );
  }
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
  await assertGitRepo(opts.cwd);

  const args = [
    'log',
    '--all',
    '--author-date-order',
    '--regexp-ignore-case',
    `--author=${opts.author}`,
    `--pretty=format:%H${FIELD_SEP}%cI${FIELD_SEP}%s${RECORD_SEP}`,
  ];

  if (opts.from) {
    args.push(`--after=${opts.from} 00:00`);
  }

  if (opts.to) {
    args.push(`--before=${opts.to} 23:59`);
  }

  let stdout: string;
  try {
    const result = await execFileAsync('git', args, {
      cwd: opts.cwd,
      maxBuffer: 32 * 1024 * 1024,
    });
    stdout = result.stdout;
  } catch (err) {
    const stderr = String((err as { stderr?: string }).stderr ?? '');

    // Empty repo (no commits yet) — return an empty list rather than erroring.
    if (
      stderr.includes('does not have any commits') ||
      stderr.includes('bad default revision') ||
      stderr.includes('unknown revision')
    ) {
      return [];
    }

    throw err;
  }

  const parsed = stdout
    .split(RECORD_SEP)
    .map(r => r.trim())
    .filter(r => r.length > 0)
    .map(record => {
      const [sha = '', iso = '', subject = ''] = record.split(FIELD_SEP);
      const { date, time } = formatLocalDateTime(iso);

      return {
        sha,
        date,
        time,
        ticket: extractTicket(subject, opts.pattern),
        description: subject,
      };
    });

  const branchMap = await getBranchMap(
    opts.cwd,
    parsed.map(p => p.sha).filter(s => s.length > 0),
  );

  return parsed.map(p => ({
    date: p.date,
    time: p.time,
    ticket: p.ticket,
    description: p.description,
    branch: branchMap.get(p.sha) ?? null,
  }));
}

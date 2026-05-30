import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ConfigModule from '../config.js';

// Mocks must come BEFORE the imports of the modules they replace. vitest
// hoists vi.mock() calls so the order written here is fine.
vi.mock('./gcal.js', () => ({
  runGcalSync: vi.fn(),
  registerGcalCommand: vi.fn(),
}));

vi.mock('./git.js', () => ({
  runGitSync: vi.fn(),
  registerGitCommand: vi.fn(),
}));

vi.mock('../config.js', async () => {
  const actual = await vi.importActual<typeof ConfigModule>('../config.js');

  return { ...actual, loadConfig: vi.fn() };
});

import { runGcalSync } from './gcal.js';
import { runGitSync } from './git.js';
import { loadConfig } from '../config.js';
import { runSync } from './sync.js';

const runGcalSyncMock = vi.mocked(runGcalSync);
const runGitSyncMock = vi.mocked(runGitSync);
const loadConfigMock = vi.mocked(loadConfig);

describe('runSync', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
    // Silence the orchestration's stdout/stderr writes during tests; assert
    // on them via spy state when relevant.
    stdoutSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    process.exitCode = undefined;
  });

  it('runs both sources by default and in gcal-first order', async () => {
    loadConfigMock.mockResolvedValue({ gcalRefreshToken: 'tok' });

    const callOrder: string[] = [];
    runGcalSyncMock.mockImplementation(async () => {
      callOrder.push('gcal');
    });
    runGitSyncMock.mockImplementation(async () => {
      callOrder.push('git');
    });

    await runSync('today', {});

    expect(runGcalSyncMock).toHaveBeenCalledOnce();
    expect(runGitSyncMock).toHaveBeenCalledOnce();
    expect(callOrder).toEqual(['gcal', 'git']);
  });

  it('skips gcal when --no-gcal is passed', async () => {
    await runSync('today', { gcal: false });

    expect(runGcalSyncMock).not.toHaveBeenCalled();
    expect(runGitSyncMock).toHaveBeenCalledOnce();
  });

  it('skips git when --no-git is passed', async () => {
    loadConfigMock.mockResolvedValue({ gcalRefreshToken: 'tok' });

    await runSync('today', { git: false });

    expect(runGcalSyncMock).toHaveBeenCalledOnce();
    expect(runGitSyncMock).not.toHaveBeenCalled();
  });

  it('throws when both --no-git and --no-gcal are passed', async () => {
    await expect(runSync('today', { git: false, gcal: false })).rejects.toThrow(
      /nothing to sync/,
    );

    expect(runGcalSyncMock).not.toHaveBeenCalled();
    expect(runGitSyncMock).not.toHaveBeenCalled();
  });

  it('skips gcal with a notice when no refresh token is configured, and still runs git', async () => {
    loadConfigMock.mockResolvedValue({}); // no gcalRefreshToken

    await runSync('today', {});

    expect(runGcalSyncMock).not.toHaveBeenCalled();
    expect(runGitSyncMock).toHaveBeenCalledOnce();

    const noticed = stdoutSpy.mock.calls.some((call: readonly unknown[]) =>
      String(call[0]).includes('Skipping gcal: not authorized'),
    );
    expect(noticed).toBe(true);
  });

  it('continues to git when gcal throws, and sets exitCode=1', async () => {
    loadConfigMock.mockResolvedValue({ gcalRefreshToken: 'tok' });
    runGcalSyncMock.mockRejectedValueOnce(new Error('gcal API down'));

    await runSync('today', {});

    expect(runGitSyncMock).toHaveBeenCalledOnce();
    expect(process.exitCode).toBe(1);

    const errored = stderrSpy.mock.calls.some((call: readonly unknown[]) =>
      String(call[0]).includes('gcal: gcal API down'),
    );
    expect(errored).toBe(true);
  });

  it('propagates --dry-run, --workspace, --from, --to to both sources', async () => {
    loadConfigMock.mockResolvedValue({ gcalRefreshToken: 'tok' });

    await runSync(undefined, {
      dryRun: true,
      workspace: '99',
      from: '2026-05-25',
      to: '2026-05-27',
    });

    const expectedSub = {
      dryRun: true,
      workspace: '99',
      from: '2026-05-25',
      to: '2026-05-27',
    };
    expect(runGcalSyncMock).toHaveBeenCalledWith(undefined, expectedSub);
    expect(runGitSyncMock).toHaveBeenCalledWith(undefined, expectedSub);
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FIELDS,
  getConfigValue,
  maskSecret,
  parseKey,
  parseValue,
  readGlobalConfig,
  renderConfigList,
  renderSingleValue,
  setConfigValue,
  writeGlobalConfig,
} from './config-cli.js';

describe('parseKey', () => {
  it('returns the field for a plain key', () => {
    expect(parseKey('togglApiToken')).toEqual({
      field: 'togglApiToken',
      subKey: undefined,
    });
  });

  it('returns the field + subKey for a dotted key', () => {
    expect(parseKey('togglProjects.ABC-')).toEqual({
      field: 'togglProjects',
      subKey: 'ABC-',
    });
  });

  it('rejects unknown fields', () => {
    expect(() => parseKey('somethingElse')).toThrow(/unknown config key/);
  });

  it('rejects dotted access on non-nested fields', () => {
    expect(() => parseKey('togglApiToken.foo')).toThrow(/does not support/);
  });

  it('rejects an empty sub-key', () => {
    expect(() => parseKey('togglProjects.')).toThrow(/empty sub-key/);
  });
});

describe('parseValue', () => {
  it('parses strings', () => {
    expect(parseValue('defaultAuthor', 'Jane Doe')).toBe('Jane Doe');
  });

  it('parses numbers', () => {
    expect(parseValue('togglWorkspaceId', '12345')).toBe(12345);
  });

  it('rejects non-numeric input for number fields', () => {
    expect(() => parseValue('togglWorkspaceId', 'not-a-number')).toThrow(
      /not a valid number/,
    );
  });

  it('parses booleans', () => {
    expect(parseValue('togglOneEntryPerTicket', 'true')).toBe(true);
    expect(parseValue('togglOneEntryPerTicket', 'false')).toBe(false);
  });

  it('rejects non-boolean input for boolean fields', () => {
    expect(() => parseValue('togglOneEntryPerTicket', 'yes')).toThrow(
      /use "true" or "false"/,
    );
  });

  it('parses enum values', () => {
    expect(parseValue('format', 'github')).toBe('github');
  });

  it('rejects invalid enum values', () => {
    expect(() => parseValue('format', 'mystery')).toThrow(/not a valid value/);
  });

  it('parses the number value of a record field', () => {
    expect(parseValue('togglProjects', '12345')).toBe(12345);
  });

  it('rejects array fields with a clear message', () => {
    expect(() => parseValue('defaultRepos', '/tmp')).toThrow(
      /edit the config file/,
    );
  });
});

describe('setConfigValue', () => {
  it('sets a scalar field', () => {
    const next = setConfigValue({}, 'togglWorkspaceId', '12345');
    expect(next.togglWorkspaceId).toBe(12345);
  });

  it('replaces an existing scalar value', () => {
    const next = setConfigValue(
      { togglWorkspaceId: 1 },
      'togglWorkspaceId',
      '99',
    );
    expect(next.togglWorkspaceId).toBe(99);
  });

  it('sets a nested record entry without dropping siblings', () => {
    const next = setConfigValue(
      { togglProjects: { 'ABC-': 100 } },
      'togglProjects.DEF-',
      '200',
    );
    expect(next.togglProjects).toEqual({ 'ABC-': 100, 'DEF-': 200 });
  });

  it('updates an existing nested entry', () => {
    const next = setConfigValue(
      { togglProjects: { 'ABC-': 100 } },
      'togglProjects.ABC-',
      '999',
    );
    expect(next.togglProjects).toEqual({ 'ABC-': 999 });
  });

  it('runs the schema validator on the merged config', () => {
    expect(() => setConfigValue({}, 'togglDayStartHour', '99')).toThrow(
      /between 0 and 23/,
    );
  });

  it('rejects unknown keys', () => {
    expect(() => setConfigValue({}, 'mystery', '42')).toThrow(/unknown config/);
  });
});

describe('getConfigValue', () => {
  it('reads a scalar field', () => {
    expect(getConfigValue({ togglWorkspaceId: 1 }, 'togglWorkspaceId')).toBe(1);
  });

  it('reads a nested record entry', () => {
    expect(
      getConfigValue({ togglProjects: { 'ABC-': 100 } }, 'togglProjects.ABC-'),
    ).toBe(100);
  });

  it('returns undefined for missing scalar fields', () => {
    expect(getConfigValue({}, 'togglWorkspaceId')).toBeUndefined();
  });

  it('returns undefined for missing nested entries', () => {
    expect(
      getConfigValue({ togglProjects: {} }, 'togglProjects.ABC-'),
    ).toBeUndefined();
  });
});

describe('maskSecret', () => {
  it('shows first 4 and last 6 chars for long values', () => {
    expect(maskSecret('1234567890abcdef')).toBe('1234…abcdef');
  });

  it('returns *** for short values', () => {
    expect(maskSecret('short')).toBe('***');
  });
});

describe('renderConfigList', () => {
  it('returns a placeholder when nothing is set', () => {
    expect(renderConfigList({})).toBe('(no values set)');
  });

  it('aligns keys and masks secrets by default', () => {
    const out = renderConfigList({
      defaultAuthor: 'Jane Doe',
      togglApiToken: '1234567890abcdef',
    });
    expect(out).toContain('defaultAuthor');
    expect(out).toContain('Jane Doe');
    expect(out).toContain('1234…abcdef');
    expect(out).not.toContain('1234567890abcdef');
  });

  it('reveals secrets when --show-secrets is on', () => {
    const out = renderConfigList(
      { togglApiToken: '1234567890abcdef' },
      { showSecrets: true },
    );
    expect(out).toContain('1234567890abcdef');
  });

  it('skips unset fields', () => {
    const out = renderConfigList({ defaultAuthor: 'Jane Doe' });
    expect(out.split('\n')).toHaveLength(1);
  });
});

describe('renderSingleValue', () => {
  it('shows (not set) for undefined', () => {
    expect(renderSingleValue(undefined, 'togglWorkspaceId', false)).toBe(
      '(not set)',
    );
  });

  it('masks secret strings by default', () => {
    expect(renderSingleValue('1234567890abcdef', 'togglApiToken', false)).toBe(
      '1234…abcdef',
    );
  });

  it('reveals secret strings when asked', () => {
    expect(renderSingleValue('1234567890abcdef', 'togglApiToken', true)).toBe(
      '1234567890abcdef',
    );
  });

  it('JSON-formats non-string values', () => {
    expect(renderSingleValue(12345, 'togglWorkspaceId', false)).toBe('12345');
    expect(renderSingleValue(true, 'togglOneEntryPerTicket', false)).toBe(
      'true',
    );
  });
});

describe('FIELDS registry', () => {
  it('marks togglApiToken as a secret', () => {
    expect(FIELDS.togglApiToken?.secret).toBe(true);
  });

  it('marks defaultRepos as not settable from CLI', () => {
    expect(FIELDS.defaultRepos?.settable).toBe(false);
  });

  it('marks togglProjects as nested', () => {
    expect(FIELDS.togglProjects?.nested).toBe(true);
  });
});

describe('readGlobalConfig / writeGlobalConfig — round trip in temp dir', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'wdid-cfg-test-'));
    process.env.XDG_CONFIG_HOME = testDir;
  });

  afterEach(async () => {
    delete process.env.XDG_CONFIG_HOME;
    await rm(testDir, { recursive: true, force: true });
  });

  it('returns an empty config when no file exists', async () => {
    expect(await readGlobalConfig()).toEqual({});
  });

  it('writes a config and reads it back', async () => {
    const cfg = { defaultAuthor: 'Jane Doe', togglWorkspaceId: 12345 };
    await writeGlobalConfig(cfg);
    expect(await readGlobalConfig()).toEqual(cfg);
  });

  it('creates the wdid directory if missing', async () => {
    await writeGlobalConfig({ togglWorkspaceId: 1 });
    const written = await readFile(
      join(testDir, 'wdid', 'config.json'),
      'utf-8',
    );
    expect(JSON.parse(written)).toEqual({ togglWorkspaceId: 1 });
  });
});

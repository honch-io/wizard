import * as os from 'node:os';
import * as fs from 'node:fs';
import { join } from 'node:path';

import {
  readSavedToken,
  saveToken,
  clearToken,
  getConfigPath,
  getConfigDir,
} from './credentials-store';

describe('credentials-store', () => {
  let tmp: string;
  const prevOverride = process.env.HONCH_WIZARD_CONFIG_DIR;

  beforeEach(() => {
    tmp = fs.mkdtempSync(join(os.tmpdir(), 'honch-cfg-'));
    process.env.HONCH_WIZARD_CONFIG_DIR = join(tmp, '.honch');
  });

  afterEach(() => {
    if (prevOverride === undefined) delete process.env.HONCH_WIZARD_CONFIG_DIR;
    else process.env.HONCH_WIZARD_CONFIG_DIR = prevOverride;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('returns null when nothing is saved', () => {
    expect(readSavedToken('https://app.honch.io')).toBeNull();
  });

  it('saves and reads back a token, normalizing a trailing slash', () => {
    saveToken('https://app.honch.io', 'tok_abc');
    expect(readSavedToken('https://app.honch.io')).toBe('tok_abc');
    expect(readSavedToken('https://app.honch.io/')).toBe('tok_abc');
  });

  it('keeps separate tokens per platform url', () => {
    saveToken('https://app.honch.io', 'prod');
    saveToken('http://localhost:3000', 'dev');
    expect(readSavedToken('https://app.honch.io')).toBe('prod');
    expect(readSavedToken('http://localhost:3000')).toBe('dev');
  });

  it('writes the config file with 0600 permissions', () => {
    saveToken('https://app.honch.io', 'tok');
    const mode = fs.statSync(getConfigPath()).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('clears a single platform token without touching others', () => {
    saveToken('https://app.honch.io', 'prod');
    saveToken('http://localhost:3000', 'dev');
    expect(clearToken('https://app.honch.io')).toBe(true);
    expect(readSavedToken('https://app.honch.io')).toBeNull();
    expect(readSavedToken('http://localhost:3000')).toBe('dev');
  });

  it('clears all tokens when no url is given', () => {
    saveToken('https://app.honch.io', 'prod');
    saveToken('http://localhost:3000', 'dev');
    expect(clearToken()).toBe(true);
    expect(readSavedToken('https://app.honch.io')).toBeNull();
    expect(readSavedToken('http://localhost:3000')).toBeNull();
  });

  it('reports false when clearing a url that was never saved', () => {
    expect(clearToken('https://app.honch.io')).toBe(false);
  });

  it('treats a corrupt config file as empty', () => {
    fs.mkdirSync(getConfigDir(), { recursive: true });
    fs.writeFileSync(getConfigPath(), 'not json{');
    expect(readSavedToken('https://app.honch.io')).toBeNull();
  });
});

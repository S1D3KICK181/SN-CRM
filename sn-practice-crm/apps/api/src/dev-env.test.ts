import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { configureDevEnvironment } from './dev-env';

const expectedDefaultEnvPath = resolve(fileURLToPath(new URL('..', import.meta.url)), '.env');
const EXPECTED_FATAL_MESSAGE =
  'FATAL CONFIGURATION ERROR: Cannot run dev entrypoint when NODE_ENV or ENVIRONMENT is production.';

describe('dev-env: configureDevEnvironment', () => {
  it('fails closed before file loading if pre-existing NODE_ENV is production across casing/whitespace', () => {
    for (const variant of ['production', 'Production', ' PRODUCTION ', '  production  \t']) {
      const mockEnv: NodeJS.ProcessEnv = { NODE_ENV: variant };
      const loadEnvFn = vi.fn();
      expect(() => configureDevEnvironment({ env: mockEnv, loadEnvFn })).toThrow(EXPECTED_FATAL_MESSAGE);
      expect(loadEnvFn).not.toHaveBeenCalled();
      expect(mockEnv['ALLOW_DEV_ACTOR_HEADER']).toBeUndefined();
    }
  });

  it('fails closed before file loading if pre-existing ENVIRONMENT is production across casing/whitespace', () => {
    for (const variant of ['production', 'Production', ' PRODUCTION ']) {
      const mockEnv: NodeJS.ProcessEnv = { ENVIRONMENT: variant };
      const loadEnvFn = vi.fn();
      expect(() => configureDevEnvironment({ env: mockEnv, loadEnvFn })).toThrow(EXPECTED_FATAL_MESSAGE);
      expect(loadEnvFn).not.toHaveBeenCalled();
      expect(mockEnv['ALLOW_DEV_ACTOR_HEADER']).toBeUndefined();
    }
  });

  it('fails closed after file loading if .env file injects NODE_ENV=production', () => {
    const mockEnv: NodeJS.ProcessEnv = { NODE_ENV: 'development' };
    const loadEnvFn = vi.fn((_path: string) => {
      mockEnv['NODE_ENV'] = 'production';
    });
    const existsFn = vi.fn(() => true);

    expect(() =>
      configureDevEnvironment({
        env: mockEnv,
        loadEnvFn,
        existsFn,
        envPath: '/fake/.env',
      })
    ).toThrow(EXPECTED_FATAL_MESSAGE);

    expect(loadEnvFn).toHaveBeenCalledWith('/fake/.env');
    expect(mockEnv['ALLOW_DEV_ACTOR_HEADER']).toBeUndefined();
  });

  it('fails closed after file loading if .env file injects ENVIRONMENT=production', () => {
    const mockEnv: NodeJS.ProcessEnv = {};
    const loadEnvFn = vi.fn((_path: string) => {
      mockEnv['ENVIRONMENT'] = 'PRODUCTION';
    });
    const existsFn = vi.fn(() => true);

    expect(() =>
      configureDevEnvironment({
        env: mockEnv,
        loadEnvFn,
        existsFn,
        envPath: '/fake/.env',
      })
    ).toThrow(EXPECTED_FATAL_MESSAGE);

    expect(loadEnvFn).toHaveBeenCalledWith('/fake/.env');
    expect(mockEnv['ALLOW_DEV_ACTOR_HEADER']).toBeUndefined();
  });

  it('resolves default envPath to apps/api/.env when omitted, independent of cwd', () => {
    const mockEnv: NodeJS.ProcessEnv = {};
    const existsFn = vi.fn((_path: string) => true);
    const loadEnvFn = vi.fn((_path: string) => {});

    configureDevEnvironment({ env: mockEnv, existsFn, loadEnvFn });

    expect(existsFn).toHaveBeenCalledTimes(1);
    expect(existsFn).toHaveBeenCalledWith(expectedDefaultEnvPath);
    expect(loadEnvFn).toHaveBeenCalledTimes(1);
    expect(loadEnvFn).toHaveBeenCalledWith(expectedDefaultEnvPath);
    expect(mockEnv['ALLOW_DEV_ACTOR_HEADER']).toBe('true');
  });

  it('preserves pre-existing environment variables over conflicting file values', () => {
    const mockEnv: NodeJS.ProcessEnv = {
      CRM_STORAGE: 'postgres',
      DATABASE_URL: 'postgresql://custom:5432/db',
    };
    const existsFn = vi.fn(() => true);
    // Simulate native Node default-only merge behavior with conflicting file candidate values
    const simulatedFileEntries: Record<string, string> = {
      CRM_STORAGE: 'memory',
      DATABASE_URL: 'postgresql://file-override:5432/wrong',
      PORT: '8888',
    };
    const loadEnvFn = vi.fn((_path: string) => {
      for (const [key, value] of Object.entries(simulatedFileEntries)) {
        if (mockEnv[key] === undefined) {
          mockEnv[key] = value;
        }
      }
    });

    configureDevEnvironment({ env: mockEnv, loadEnvFn, existsFn, envPath: '/fake/.env' });

    expect(loadEnvFn).toHaveBeenCalledWith('/fake/.env');
    // Pre-existing values must survive conflicting file values
    expect(mockEnv['CRM_STORAGE']).toBe('postgres');
    expect(mockEnv['DATABASE_URL']).toBe('postgresql://custom:5432/db');
    // Non-conflicting file values are merged
    expect(mockEnv['PORT']).toBe('8888');
    expect(mockEnv['ALLOW_DEV_ACTOR_HEADER']).toBe('true');
  });

  it('populates default local Postgres DATABASE_URL when CRM_STORAGE=postgres and URL is unset or empty', () => {
    const mockEnvUnset: NodeJS.ProcessEnv = { CRM_STORAGE: 'postgres' };
    const existsFn = vi.fn(() => false);

    configureDevEnvironment({ env: mockEnvUnset, existsFn });

    expect(mockEnvUnset['DATABASE_URL']).toBe('postgresql://postgres:postgres@127.0.0.1:54322/postgres');
    expect(mockEnvUnset['ALLOW_DEV_ACTOR_HEADER']).toBe('true');

    const mockEnvEmpty: NodeJS.ProcessEnv = { CRM_STORAGE: ' POSTGRES ', DATABASE_URL: '   ' };
    configureDevEnvironment({ env: mockEnvEmpty, existsFn });
    expect(mockEnvEmpty['DATABASE_URL']).toBe('postgresql://postgres:postgres@127.0.0.1:54322/postgres');
  });

  it('does not populate DATABASE_URL when CRM_STORAGE is memory', () => {
    const mockEnv: NodeJS.ProcessEnv = { CRM_STORAGE: 'memory' };
    const existsFn = vi.fn(() => false);

    configureDevEnvironment({ env: mockEnv, existsFn });

    expect(mockEnv['DATABASE_URL']).toBeUndefined();
    expect(mockEnv['ALLOW_DEV_ACTOR_HEADER']).toBe('true');
  });

  it('runs safely as a no-op when the .env file does not exist', () => {
    const mockEnv: NodeJS.ProcessEnv = {};
    const existsFn = vi.fn(() => false);
    const loadEnvFn = vi.fn();

    configureDevEnvironment({ env: mockEnv, existsFn, loadEnvFn, envPath: '/nonexistent/.env' });

    expect(loadEnvFn).not.toHaveBeenCalled();
    expect(mockEnv['ALLOW_DEV_ACTOR_HEADER']).toBe('true');
  });
});

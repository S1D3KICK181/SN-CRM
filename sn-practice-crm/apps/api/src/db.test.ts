import { describe, expect, it, vi } from 'vitest';
import { PostgresTransactionRunner } from './db';

describe('PostgresTransactionRunner', () => {
  it('calls begin on root client and executes GUC statements in strict sequential order', async () => {
    const executedQueries: string[] = [];
    const txMock = Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        const query = strings.reduce((acc, str, i) => acc + str + (values[i] !== undefined ? String(values[i]) : ''), '');
        executedQueries.push(query.trim());
        return Promise.resolve([]);
      },
      {},
    );

    const clientMock = {
      begin: vi.fn(async (cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock)),
    };

    const runner = new PostgresTransactionRunner(clientMock as any);
    const result = await runner.withUserContext(
      { actorId: '00000000-0000-4000-a000-000000000001' },
      async (tx) => {
        executedQueries.push('SELECT 1 FROM tenant_data');
        return 'success';
      },
    );

    expect(result).toBe('success');
    expect(clientMock.begin).toHaveBeenCalledOnce();

    expect(executedQueries).toEqual([
      "SELECT set_config('request.jwt.claim.sub', 00000000-0000-4000-a000-000000000001, true)",
      "SELECT set_config('request.jwt.claim.role', 'authenticated', true)",
      "SELECT set_config('role', 'authenticated', true)",
      'SELECT 1 FROM tenant_data',
    ]);
  });

  it('detects nested transaction and calls savepoint without throwing TypeError', async () => {
    const executedQueries: string[] = [];
    const nestedTxMock = Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        const query = strings.reduce((acc, str, i) => acc + str + (values[i] !== undefined ? String(values[i]) : ''), '');
        executedQueries.push(query.trim());
        return Promise.resolve([]);
      },
      {},
    );

    const clientWithSavepoint = {
      savepoint: vi.fn(async (cb: (tx: typeof nestedTxMock) => Promise<unknown>) => cb(nestedTxMock)),
    };

    const runner = new PostgresTransactionRunner(clientWithSavepoint as any);
    const result = await runner.withUserContext(
      { actorId: '00000000-0000-4000-a000-000000000005' },
      async () => 'savepoint-ok',
    );

    expect(result).toBe('savepoint-ok');
    expect(clientWithSavepoint.savepoint).toHaveBeenCalledOnce();
    expect(executedQueries[0]).toContain("request.jwt.claim.sub");
    expect(executedQueries[1]).toContain("request.jwt.claim.role");
    expect(executedQueries[2]).toContain("'role'");
  });

  it('propagates errors from operation', async () => {
    const clientMock = {
      begin: vi.fn(async (cb: (tx: any) => Promise<unknown>) => cb(async () => [])),
    };

    const runner = new PostgresTransactionRunner(clientMock as any);
    await expect(
      runner.withUserContext({ actorId: '00000000-0000-4000-a000-000000000001' }, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });
});

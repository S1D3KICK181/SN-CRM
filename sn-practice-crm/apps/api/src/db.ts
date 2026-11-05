import postgres from 'postgres';

export interface UserContext {
  readonly actorId: string;
}

export type SqlClient = postgres.Sql | postgres.TransactionSql;

export class PostgresTransactionRunner {
  constructor(private readonly client: SqlClient) {}

  async withUserContext<T>(
    context: UserContext,
    operation: (tx: postgres.TransactionSql) => Promise<T>,
  ): Promise<T> {
    const runInTx = async (tx: postgres.TransactionSql): Promise<T> => {
      // Deterministic Sequential Statement Ordering:
      // 1. Establish claim.sub
      // 2. Establish claim.role
      // 3. Demote privilege to unprivileged 'authenticated' (RLS enforced)
      await tx`SELECT set_config('request.jwt.claim.sub', ${context.actorId}, true)`;
      await tx`SELECT set_config('request.jwt.claim.role', 'authenticated', true)`;
      await tx`SELECT set_config('role', 'authenticated', true)`;
      return operation(tx);
    };

    if ('savepoint' in this.client && typeof (this.client as postgres.TransactionSql).savepoint === 'function') {
      return (this.client as postgres.TransactionSql).savepoint(runInTx as any) as Promise<T>;
    }
    return (this.client as postgres.Sql).begin(runInTx as any) as Promise<T>;
  }
}

export function createDatabaseClient(
  connectionString: string,
  options?: postgres.Options<{}>,
): postgres.Sql {
  return postgres(connectionString, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    ...options,
  });
}

export async function probeDatabase(client: postgres.Sql): Promise<{
  database: string;
  user: string;
  version: string;
}> {
  const rows = await client`SELECT current_database() as database, current_user as "user", version() as version`;
  const row = rows[0];
  if (!row) {
    throw new Error('Database preflight probe returned no rows.');
  }
  return {
    database: String(row['database']),
    user: String(row['user']),
    version: String(row['version']),
  };
}

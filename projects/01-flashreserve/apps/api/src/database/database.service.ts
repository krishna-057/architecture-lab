import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor(config: ConfigService) {
    this.pool = new Pool({
      connectionString: buildDatabaseUrl(config)
    });
  }

  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values: unknown[] = []
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, values);
  }

  transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    return this.pool.connect().then(async (client) => {
      try {
        await client.query("BEGIN");
        const result = await work(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    });
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}

function buildDatabaseUrl(config: ConfigService): string {
  const explicitUrl = config.get<string>("DATABASE_URL");

  if (explicitUrl) {
    return explicitUrl;
  }

  const user = config.get<string>("FLASHRESERVE_POSTGRES_USER") ?? "flashreserve";
  const password = config.get<string>("FLASHRESERVE_POSTGRES_PASSWORD") ?? "flashreserve";
  const database = config.get<string>("FLASHRESERVE_POSTGRES_DB") ?? "flashreserve";
  const port = config.get<string>("FLASHRESERVE_POSTGRES_PORT") ?? "5432";

  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@localhost:${port}/${encodeURIComponent(database)}`;
}

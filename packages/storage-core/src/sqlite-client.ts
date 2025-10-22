import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { DatabaseError, DatabaseRecord, TransactionContext } from './types';

export class Logger {
  constructor(private component: string) {}

  info(message: string, meta?: any): void {
    console.log(`[${new Date().toISOString()}] INFO [${this.component}]: ${message}`, meta || '');
  }

  error(message: string, meta?: any): void {
    console.error(
      `[${new Date().toISOString()}] ERROR [${this.component}]: ${message}`,
      meta || ''
    );
  }

  warn(message: string, meta?: any): void {
    console.warn(`[${new Date().toISOString()}] WARN [${this.component}]: ${message}`, meta || '');
  }
}

export class SQLiteTransaction implements TransactionContext {
  constructor(
    private db: Database.Database,
    private logger: Logger
  ) {}

  async commit(): Promise<void> {
    try {
      this.db.exec('COMMIT');
      this.logger.info('Transaction committed');
    } catch (error) {
      this.logger.error('Failed to commit transaction', { error: (error as Error).message });
      throw new DatabaseError(`Failed to commit transaction: ${(error as Error).message}`);
    }
  }

  async rollback(): Promise<void> {
    try {
      this.db.exec('ROLLBACK');
      this.logger.info('Transaction rolled back');
    } catch (error) {
      this.logger.error('Failed to rollback transaction', { error: (error as Error).message });
      throw new DatabaseError(`Failed to rollback transaction: ${(error as Error).message}`);
    }
  }
}

export class SQLiteClient {
  private db?: Database.Database;
  private logger: Logger;
  private preparedStatements = new Map<string, Database.Statement>();

  constructor(
    private dbPath: string,
    logger?: Logger
  ) {
    this.logger = logger || new Logger('SQLiteClient');
  }

  async initialize(): Promise<void> {
    try {
      this.logger.info(`Initializing SQLite database at ${this.dbPath}`);

      // Ensure directory exists
      const dbDir = path.dirname(this.dbPath);
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }

      // Initialize database connection
      this.db = new Database(this.dbPath);

      // Configure SQLite for better performance
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = NORMAL');
      this.db.pragma('cache_size = 10000');
      this.db.pragma('temp_store = memory');
      this.db.pragma('mmap_size = 268435456'); // 256MB

      // Run migrations
      await this.runMigrations();

      this.logger.info('SQLite database initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize SQLite database', {
        error: (error as Error).message,
        dbPath: this.dbPath,
      });
      throw new DatabaseError(`Failed to initialize database: ${(error as Error).message}`);
    }
  }

  async get<T extends DatabaseRecord>(sql: string, params: any[] = []): Promise<T | null> {
    if (!this.db) {
      throw new DatabaseError('Database not initialized');
    }

    try {
      const stmt = this.getOrCreateStatement(sql);
      const result = stmt.get(...params) as T | undefined;
      return result || null;
    } catch (error) {
      this.logger.error('SQLite get error', { sql, params, error: (error as Error).message });
      throw new DatabaseError(`Query failed: ${(error as Error).message}`);
    }
  }

  async all<T extends DatabaseRecord>(sql: string, params: any[] = []): Promise<T[]> {
    if (!this.db) {
      throw new DatabaseError('Database not initialized');
    }

    try {
      const stmt = this.getOrCreateStatement(sql);
      return stmt.all(...params) as T[];
    } catch (error) {
      this.logger.error('SQLite all error', { sql, params, error: (error as Error).message });
      throw new DatabaseError(`Query failed: ${(error as Error).message}`);
    }
  }

  async run(sql: string, params: any[] = []): Promise<Database.RunResult> {
    if (!this.db) {
      throw new DatabaseError('Database not initialized');
    }

    try {
      const stmt = this.getOrCreateStatement(sql);
      return stmt.run(...params);
    } catch (error) {
      this.logger.error('SQLite run error', { sql, params, error: (error as Error).message });
      throw new DatabaseError(`Query failed: ${(error as Error).message}`);
    }
  }

  async insert(table: string, data: DatabaseRecord): Promise<void> {
    if (!data || Object.keys(data).length === 0) {
      throw new DatabaseError('No data provided for insert');
    }

    const columns = Object.keys(data).join(', ');
    const placeholders = Object.keys(data)
      .map(() => '?')
      .join(', ');
    const values = Object.values(data);

    const sql = `INSERT INTO ${table} (${columns}) VALUES (${placeholders})`;

    try {
      await this.run(sql, values);
      this.logger.info(`Record inserted into ${table}`, { table, recordId: data.id });
    } catch (error) {
      this.logger.error(`Failed to insert record into ${table}`, {
        table,
        error: (error as Error).message,
        data,
      });
      throw error;
    }
  }

  async update(
    table: string,
    data: Partial<DatabaseRecord>,
    whereClause: string,
    whereParams: any[] = []
  ): Promise<void> {
    if (!data || Object.keys(data).length === 0) {
      throw new DatabaseError('No data provided for update');
    }

    const updates = Object.keys(data)
      .map(key => `${key} = ?`)
      .join(', ');
    const values = [...Object.values(data), ...whereParams];

    const sql = `UPDATE ${table} SET ${updates} WHERE ${whereClause}`;

    try {
      const result = await this.run(sql, values);
      this.logger.info(`Record updated in ${table}`, {
        table,
        changes: result.changes,
        whereClause,
      });
    } catch (error) {
      this.logger.error(`Failed to update record in ${table}`, {
        table,
        error: (error as Error).message,
        whereClause,
      });
      throw error;
    }
  }

  async delete(table: string, whereClause: string, whereParams: any[] = []): Promise<void> {
    const sql = `DELETE FROM ${table} WHERE ${whereClause}`;

    try {
      const result = await this.run(sql, whereParams);
      this.logger.info(`Record deleted from ${table}`, {
        table,
        changes: result.changes,
        whereClause,
      });
    } catch (error) {
      this.logger.error(`Failed to delete record from ${table}`, {
        table,
        error: (error as Error).message,
        whereClause,
      });
      throw error;
    }
  }

  async beginTransaction(): Promise<SQLiteTransaction> {
    if (!this.db) {
      throw new DatabaseError('Database not initialized');
    }

    try {
      this.db.exec('BEGIN TRANSACTION');
      this.logger.info('Transaction started');
      return new SQLiteTransaction(this.db, this.logger);
    } catch (error) {
      this.logger.error('Failed to begin transaction', { error: (error as Error).message });
      throw new DatabaseError(`Failed to begin transaction: ${(error as Error).message}`);
    }
  }

  async healthCheck(): Promise<boolean> {
    if (!this.db) {
      return false;
    }

    try {
      const result = this.db.prepare('SELECT 1 as health').get();
      return !!(result && (result as any).health === 1);
    } catch (error) {
      this.logger.error('Database health check failed', { error: (error as Error).message });
      return false;
    }
  }

  async close(): Promise<void> {
    try {
      // Close all prepared statements
      for (const stmt of this.preparedStatements.values()) {
        (stmt as any).finalize();
      }
      this.preparedStatements.clear();

      // Close database connection
      if (this.db) {
        this.db.close();
        this.db = undefined;
      }

      this.logger.info('SQLite database connection closed');
    } catch (error) {
      this.logger.error('Error closing SQLite database', { error: (error as Error).message });
      throw new DatabaseError(`Failed to close database: ${(error as Error).message}`);
    }
  }

  private getOrCreateStatement(sql: string): Database.Statement {
    if (!this.db) {
      throw new DatabaseError('Database not initialized');
    }

    let stmt = this.preparedStatements.get(sql);
    if (!stmt) {
      stmt = this.db.prepare(sql);
      this.preparedStatements.set(sql, stmt);
    }
    return stmt;
  }

  private async runMigrations(): Promise<void> {
    if (!this.db) {
      throw new DatabaseError('Database not initialized');
    }

    try {
      this.logger.info('Running database migrations...');

      // Create migrations table to track applied migrations
      this.db!.exec(`
        CREATE TABLE IF NOT EXISTS migrations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          filename TEXT NOT NULL UNIQUE,
          applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);

      // Find migration files
      const migrationsPath = path.join(__dirname, '../migrations');

      if (!fs.existsSync(migrationsPath)) {
        this.logger.warn('Migrations directory not found', { migrationsPath });
        return;
      }

      const files = fs
        .readdirSync(migrationsPath)
        .filter(file => file.endsWith('.sql'))
        .sort();

      // Get already applied migrations
      const appliedMigrations = this.db!.prepare(
        'SELECT filename FROM migrations ORDER BY filename'
      ).all() as { filename: string }[];

      const appliedSet = new Set(appliedMigrations.map(m => m.filename));

      // Apply new migrations
      let appliedCount = 0;
      for (const file of files) {
        if (!appliedSet.has(file)) {
          const migrationPath = path.join(migrationsPath, file);
          const migration = fs.readFileSync(migrationPath, 'utf8');

          // Execute migration in a transaction
          const transaction = this.db!.transaction(() => {
            this.db!.exec(migration);
            this.db!.prepare('INSERT INTO migrations (filename) VALUES (?)').run(file);
          });

          transaction();
          appliedCount++;
          this.logger.info(`Applied migration: ${file}`);
        }
      }

      this.logger.info(`Database migrations completed. Applied ${appliedCount} new migrations.`);
    } catch (error) {
      this.logger.error('Migration failed', { error: (error as Error).message });
      throw new DatabaseError(`Migration failed: ${(error as Error).message}`);
    }
  }
}

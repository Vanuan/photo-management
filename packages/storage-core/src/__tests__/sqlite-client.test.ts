import { SQLiteClient, SQLiteTransaction, Logger } from '../sqlite-client';
import { DatabaseError } from '../types';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

// Mock the better-sqlite3 library
jest.mock('better-sqlite3');
jest.mock('fs');
jest.mock('path');

const MockedDatabase = Database as jest.MockedClass<typeof Database>;
const mockedFs = fs as jest.Mocked<typeof fs>;
const mockedPath = path as jest.Mocked<typeof path>;

describe('Logger', () => {
  let logger: Logger;

  beforeEach(() => {
    logger = new Logger('TestComponent');
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should log info messages', () => {
    logger.info('Test message', { key: 'value' });

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('INFO [TestComponent]: Test message'),
      { key: 'value' }
    );
  });

  it('should log error messages', () => {
    logger.error('Test error', { error: 'details' });

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('ERROR [TestComponent]: Test error'),
      { error: 'details' }
    );
  });

  it('should log warn messages', () => {
    logger.warn('Test warning');

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('WARN [TestComponent]: Test warning'),
      ''
    );
  });
});

describe('SQLiteTransaction', () => {
  let transaction: SQLiteTransaction;
  let mockDb: jest.Mocked<Database.Database>;
  let logger: Logger;

  beforeEach(() => {
    logger = new Logger('TestTransaction');
    mockDb = {
      exec: jest.fn(),
    } as any;

    transaction = new SQLiteTransaction(mockDb, logger);
  });

  describe('commit', () => {
    it('should commit transaction successfully', async () => {
      mockDb.exec.mockReturnValue(mockDb);

      await transaction.commit();

      expect(mockDb.exec).toHaveBeenCalledWith('COMMIT');
    });

    it('should throw DatabaseError on commit failure', async () => {
      const error = new Error('Commit failed');
      mockDb.exec.mockImplementation(() => {
        throw error;
      });

      await expect(transaction.commit()).rejects.toThrow(DatabaseError);
      await expect(transaction.commit()).rejects.toThrow('Failed to commit transaction');
    });
  });

  describe('rollback', () => {
    it('should rollback transaction successfully', async () => {
      mockDb.exec.mockReturnValue(mockDb);

      await transaction.rollback();

      expect(mockDb.exec).toHaveBeenCalledWith('ROLLBACK');
    });

    it('should throw DatabaseError on rollback failure', async () => {
      const error = new Error('Rollback failed');
      mockDb.exec.mockImplementation(() => {
        throw error;
      });

      await expect(transaction.rollback()).rejects.toThrow(DatabaseError);
      await expect(transaction.rollback()).rejects.toThrow('Failed to rollback transaction');
    });
  });
});

describe('SQLiteClient', () => {
  let client: SQLiteClient;
  let mockDb: jest.Mocked<Database.Database>;
  let mockStatement: jest.Mocked<Database.Statement>;
  let logger: Logger;

  beforeEach(() => {
    jest.clearAllMocks();

    logger = new Logger('TestSQLiteClient');

    mockStatement = {
      get: jest.fn(),
      all: jest.fn(),
      run: jest.fn(),
      finalize: jest.fn().mockReturnValue(undefined),
    } as any;

    mockDb = {
      pragma: jest.fn(),
      exec: jest.fn(),
      prepare: jest.fn().mockReturnValue(mockStatement),
      close: jest.fn(),
      transaction: jest.fn(),
    } as any;

    MockedDatabase.mockImplementation(() => mockDb);

    // Setup default mocks
    mockedPath.dirname.mockReturnValue('/test/dir');
    mockedPath.join.mockImplementation((...args) => args.join('/'));
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.mkdirSync.mockReturnValue(undefined);
    mockedFs.readdirSync.mockReturnValue([]);

    client = new SQLiteClient(':memory:', logger);
  });

  describe('initialize', () => {
    it('should initialize successfully', async () => {
      mockedFs.existsSync.mockReturnValueOnce(false).mockReturnValueOnce(false);
      mockedFs.mkdirSync.mockReturnValue(undefined);

      await client.initialize();

      expect(MockedDatabase).toHaveBeenCalledWith(':memory:');
      expect(mockDb.pragma).toHaveBeenCalledWith('journal_mode = WAL');
      expect(mockDb.pragma).toHaveBeenCalledWith('synchronous = NORMAL');
      expect(mockDb.pragma).toHaveBeenCalledWith('cache_size = 10000');
      expect(mockDb.pragma).toHaveBeenCalledWith('temp_store = memory');
      expect(mockDb.pragma).toHaveBeenCalledWith('mmap_size = 268435456');
    });

    it('should create directory if it does not exist', async () => {
      client = new SQLiteClient('/test/dir/db.sqlite', logger);
      mockedFs.existsSync.mockReturnValueOnce(false).mockReturnValueOnce(false);

      await client.initialize();

      expect(mockedFs.mkdirSync).toHaveBeenCalledWith('/test/dir', { recursive: true });
    });

    it('should run migrations after initialization', async () => {
      const migrationContent = 'CREATE TABLE test (id INTEGER);';
      mockedFs.existsSync.mockReturnValueOnce(true).mockReturnValueOnce(true);
      mockedFs.readdirSync.mockReturnValue(['001_initial.sql'] as any);
      mockedFs.readFileSync.mockReturnValue(migrationContent);

      mockStatement.all.mockReturnValue([]);
      const mockTransactionFn = jest.fn();
      mockDb.transaction.mockReturnValue(mockTransactionFn as any);

      await client.initialize();

      expect(mockDb.exec).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS migrations')
      );
      expect(mockedFs.readFileSync).toHaveBeenCalledWith(
        expect.stringContaining('migrations/001_initial.sql'),
        'utf8'
      );
    });

    it('should handle missing migrations directory', async () => {
      mockedFs.existsSync.mockReturnValueOnce(true).mockReturnValueOnce(false);

      await client.initialize();

      expect(mockDb.exec).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS migrations')
      );
    });

    it('should throw DatabaseError on initialization failure', async () => {
      const error = new Error('Database initialization failed');
      MockedDatabase.mockImplementation(() => {
        throw error;
      });

      await expect(client.initialize()).rejects.toThrow(DatabaseError);
      await expect(client.initialize()).rejects.toThrow('Failed to initialize database');
    });
  });

  describe('get', () => {
    beforeEach(async () => {
      mockedFs.existsSync.mockReturnValue(false);
      await client.initialize();
    });

    it('should get single record', async () => {
      const expectedResult = { id: 1, name: 'test' };
      mockStatement.get.mockReturnValue(expectedResult);

      const result = await client.get('SELECT * FROM users WHERE id = ?', [1]);

      expect(result).toEqual(expectedResult);
      expect(mockDb.prepare).toHaveBeenCalledWith('SELECT * FROM users WHERE id = ?');
      expect(mockStatement.get).toHaveBeenCalledWith(1);
    });

    it('should return null when no record found', async () => {
      mockStatement.get.mockReturnValue(undefined);

      const result = await client.get('SELECT * FROM users WHERE id = ?', [999]);

      expect(result).toBeNull();
    });

    it('should throw DatabaseError when database not initialized', async () => {
      const uninitializedClient = new SQLiteClient(':memory:', logger);

      await expect(uninitializedClient.get('SELECT 1')).rejects.toThrow(DatabaseError);
      await expect(uninitializedClient.get('SELECT 1')).rejects.toThrow('Database not initialized');
    });

    it('should throw DatabaseError on query failure', async () => {
      const error = new Error('Query failed');
      mockStatement.get.mockImplementation(() => {
        throw error;
      });

      await expect(client.get('SELECT * FROM invalid_table')).rejects.toThrow(DatabaseError);
      await expect(client.get('SELECT * FROM invalid_table')).rejects.toThrow('Query failed');
    });

    it('should reuse prepared statements', async () => {
      mockStatement.get.mockReturnValue({ id: 1 }).mockReturnValue({ id: 2 });

      await client.get('SELECT * FROM users WHERE id = ?', [1]);
      await client.get('SELECT * FROM users WHERE id = ?', [2]);

      expect(mockDb.prepare).toHaveBeenCalledTimes(1);
      expect(mockStatement.get).toHaveBeenCalledTimes(2);
    });
  });

  describe('all', () => {
    beforeEach(async () => {
      mockedFs.existsSync.mockReturnValue(false);
      await client.initialize();
    });

    it('should get all records', async () => {
      const expectedResults = [
        { id: 1, name: 'test1' },
        { id: 2, name: 'test2' },
      ];
      mockStatement.all.mockReturnValue(expectedResults);

      const result = await client.all('SELECT * FROM users');

      expect(result).toEqual(expectedResults);
      expect(mockDb.prepare).toHaveBeenCalledWith('SELECT * FROM users');
      expect(mockStatement.all).toHaveBeenCalledWith();
    });

    it('should return empty array when no records found', async () => {
      mockStatement.all.mockReturnValue([]);

      const result = await client.all('SELECT * FROM empty_table');

      expect(result).toEqual([]);
    });

    it('should throw DatabaseError when database not initialized', async () => {
      const uninitializedClient = new SQLiteClient(':memory:', logger);

      await expect(uninitializedClient.all('SELECT 1')).rejects.toThrow(DatabaseError);
    });

    it('should throw DatabaseError on query failure', async () => {
      const error = new Error('Query failed');
      mockStatement.all.mockImplementation(() => {
        throw error;
      });

      await expect(client.all('SELECT * FROM invalid_table')).rejects.toThrow(DatabaseError);
    });
  });

  describe('run', () => {
    beforeEach(async () => {
      mockedFs.existsSync.mockReturnValue(false);
      await client.initialize();
    });

    it('should run statement successfully', async () => {
      const expectedResult = { changes: 1, lastInsertRowid: 1 };
      mockStatement.run.mockReturnValue(expectedResult);

      const result = await client.run('INSERT INTO users (name) VALUES (?)', ['test']);

      expect(result).toEqual(expectedResult);
      expect(mockDb.prepare).toHaveBeenCalledWith('INSERT INTO users (name) VALUES (?)');
      expect(mockStatement.run).toHaveBeenCalledWith('test');
    });

    it('should throw DatabaseError when database not initialized', async () => {
      const uninitializedClient = new SQLiteClient(':memory:', logger);

      await expect(uninitializedClient.run('INSERT INTO users VALUES (1)')).rejects.toThrow(
        DatabaseError
      );
    });

    it('should throw DatabaseError on query failure', async () => {
      const error = new Error('Query failed');
      mockStatement.run.mockImplementation(() => {
        throw error;
      });

      await expect(client.run('INVALID SQL')).rejects.toThrow(DatabaseError);
    });
  });

  describe('insert', () => {
    beforeEach(async () => {
      mockedFs.existsSync.mockReturnValue(false);
      await client.initialize();
    });

    it('should insert record successfully', async () => {
      const runResult = { changes: 1, lastInsertRowid: 1 };
      mockStatement.run.mockReturnValue(runResult);

      const data = { id: '1', name: 'test', email: 'test@example.com' };
      await client.insert('users', data);

      expect(mockDb.prepare).toHaveBeenCalledWith(
        'INSERT INTO users (id, name, email) VALUES (?, ?, ?)'
      );
      expect(mockStatement.run).toHaveBeenCalledWith('1', 'test', 'test@example.com');
    });

    it('should throw DatabaseError for empty data', async () => {
      await expect(client.insert('users', {})).rejects.toThrow(DatabaseError);
      await expect(client.insert('users', {})).rejects.toThrow('No data provided for insert');
    });

    it('should throw DatabaseError for null data', async () => {
      await expect(client.insert('users', null as any)).rejects.toThrow(DatabaseError);
    });

    it('should handle insert errors', async () => {
      const error = new Error('Constraint violation');
      mockStatement.run.mockImplementation(() => {
        throw error;
      });

      const data = { id: '1', name: 'test' };
      await expect(client.insert('users', data)).rejects.toThrow(DatabaseError);
    });
  });

  describe('update', () => {
    beforeEach(async () => {
      mockedFs.existsSync.mockReturnValue(false);
      await client.initialize();
    });

    it('should update record successfully', async () => {
      const runResult = { changes: 1, lastInsertRowid: 0 };
      mockStatement.run.mockReturnValue(runResult);

      const data = { name: 'updated', email: 'updated@example.com' };
      await client.update('users', data, 'id = ?', ['1']);

      expect(mockDb.prepare).toHaveBeenCalledWith(
        'UPDATE users SET name = ?, email = ? WHERE id = ?'
      );
      expect(mockStatement.run).toHaveBeenCalledWith('updated', 'updated@example.com', '1');
    });

    it('should throw DatabaseError for empty data', async () => {
      await expect(client.update('users', {}, 'id = ?', ['1'])).rejects.toThrow(DatabaseError);
      await expect(client.update('users', {}, 'id = ?', ['1'])).rejects.toThrow(
        'No data provided for update'
      );
    });

    it('should handle update with no where params', async () => {
      const runResult = { changes: 1, lastInsertRowid: 0 };
      mockStatement.run.mockReturnValue(runResult);

      await client.update('users', { name: 'updated' }, '1=1');

      expect(mockDb.prepare).toHaveBeenCalledWith('UPDATE users SET name = ? WHERE 1=1');
      expect(mockStatement.run).toHaveBeenCalledWith('updated');
    });

    it('should handle update errors', async () => {
      const error = new Error('Update failed');
      mockStatement.run.mockImplementation(() => {
        throw error;
      });

      await expect(client.update('users', { name: 'test' }, 'id = ?', ['1'])).rejects.toThrow(
        DatabaseError
      );
    });
  });

  describe('delete', () => {
    beforeEach(async () => {
      mockedFs.existsSync.mockReturnValue(false);
      await client.initialize();
    });

    it('should delete record successfully', async () => {
      const runResult = { changes: 1, lastInsertRowid: 0 };
      mockStatement.run.mockReturnValue(runResult);

      await client.delete('users', 'id = ?', ['1']);

      expect(mockDb.prepare).toHaveBeenCalledWith('DELETE FROM users WHERE id = ?');
      expect(mockStatement.run).toHaveBeenCalledWith('1');
    });

    it('should handle delete with no where params', async () => {
      const runResult = { changes: 10, lastInsertRowid: 0 };
      mockStatement.run.mockReturnValue(runResult);

      await client.delete('users', '1=1');

      expect(mockDb.prepare).toHaveBeenCalledWith('DELETE FROM users WHERE 1=1');
      expect(mockStatement.run).toHaveBeenCalledWith();
    });

    it('should handle delete errors', async () => {
      const error = new Error('Delete failed');
      mockStatement.run.mockImplementation(() => {
        throw error;
      });

      await expect(client.delete('users', 'id = ?', ['1'])).rejects.toThrow(DatabaseError);
    });
  });

  describe('beginTransaction', () => {
    beforeEach(async () => {
      mockedFs.existsSync.mockReturnValue(false);
      await client.initialize();
    });

    it('should begin transaction successfully', async () => {
      mockDb.exec.mockReturnValue(mockDb);

      const transaction = await client.beginTransaction();

      expect(transaction).toBeInstanceOf(SQLiteTransaction);
      expect(mockDb.exec).toHaveBeenCalledWith('BEGIN TRANSACTION');
    });

    it('should throw DatabaseError when database not initialized', async () => {
      const uninitializedClient = new SQLiteClient(':memory:', logger);

      await expect(uninitializedClient.beginTransaction()).rejects.toThrow(DatabaseError);
      await expect(uninitializedClient.beginTransaction()).rejects.toThrow(
        'Database not initialized'
      );
    });

    it('should throw DatabaseError on begin failure', async () => {
      const error = new Error('Begin failed');
      mockDb.exec.mockImplementation(() => {
        throw error;
      });

      await expect(client.beginTransaction()).rejects.toThrow(DatabaseError);
      await expect(client.beginTransaction()).rejects.toThrow('Failed to begin transaction');
    });
  });

  describe('healthCheck', () => {
    beforeEach(async () => {
      mockedFs.existsSync.mockReturnValue(false);
      await client.initialize();
    });

    it('should return true when database is healthy', async () => {
      mockStatement.get.mockReturnValue({ health: 1 });

      const result = await client.healthCheck();

      expect(result).toBe(true);
      expect(mockDb.prepare).toHaveBeenCalledWith('SELECT 1 as health');
    });

    it('should return false when database is not initialized', async () => {
      const uninitializedClient = new SQLiteClient(':memory:', logger);

      const result = await uninitializedClient.healthCheck();

      expect(result).toBe(false);
    });

    it('should return false on health check failure', async () => {
      const error = new Error('Health check failed');
      mockStatement.get.mockImplementation(() => {
        throw error;
      });

      const result = await client.healthCheck();

      expect(result).toBe(false);
    });

    it('should return false when health query returns invalid result', async () => {
      mockStatement.get.mockReturnValue({ health: 0 });

      const result = await client.healthCheck();

      expect(result).toBe(false);
    });
  });

  describe('close', () => {
    beforeEach(async () => {
      mockedFs.existsSync.mockReturnValue(false);
      await client.initialize();
    });

    it('should close successfully', async () => {
      // Create some prepared statements first
      await client.get('SELECT 1', []);
      await client.get('SELECT 2', []);

      mockDb.close.mockReturnValue(mockDb);

      await client.close();

      expect(mockDb.close).toHaveBeenCalledTimes(1);
      expect(mockDb.close).toHaveBeenCalled();
    });

    it('should handle close errors gracefully', async () => {
      const error = new Error('Close failed');
      mockDb.close.mockImplementation(() => {
        throw error;
      });

      await expect(client.close()).rejects.toThrow(DatabaseError);
      await expect(client.close()).rejects.toThrow('Failed to close database');
    });

    it('should handle finalize errors gracefully', async () => {
      // Create a prepared statement first
      await client.get('SELECT 1', []);

      const error = new Error('Close failed');
      mockDb.close.mockImplementation(() => {
        throw error;
      });

      // Should throw DatabaseError on close failure
      await expect(client.close()).rejects.toThrow(DatabaseError);
    });
  });
});

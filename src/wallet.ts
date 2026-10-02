const BUSY_TIMEOUT_MS = 5000;

type TStatement = {
  run: (...params: Array<string | number | null>) => {
    changes: number | bigint;
  };
  get: (...params: Array<string | number | null>) => unknown;
  all: (...params: Array<string | number | null>) => unknown[];
};

export type TSqliteDatabase = {
  exec: (sql: string) => void;
  prepare: (sql: string) => TStatement;
  close: () => void;
  isTransaction: boolean;
};

/**
 * Opens a SQLite database with the `node:sqlite` built-in (Node 22.5+).
 *
 * The module is taken from `process.getBuiltinModule` because bundlers and the
 * test runner do not resolve the `node:sqlite` specifier (it has no bare
 * counterpart) and the installed `@types/node` predates it.
 *
 * @param dbPath Path to the database file.
 * @returns An open database handle that the caller must close.
 */
export const openDatabase = (dbPath: string): TSqliteDatabase => {
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as {
    DatabaseSync: new (
      path: string,
      options: { timeout: number },
    ) => TSqliteDatabase;
  };
  return new DatabaseSync(dbPath, { timeout: BUSY_TIMEOUT_MS });
};

export type TSpendResult = {
  success: boolean;
  balance: number;
};

/**
 * Atomically withdraws coins from a player's wallet in the website database.
 *
 * Mirrors `economy.spend` of the site bot: the `wallets` row is decremented
 * only when the balance covers the amount, and the operation is written to
 * `eco_log` so it shows up in the player's wallet history on the site.
 * The database runs in WAL mode, so the write coexists with the bot process.
 *
 * @param dbPath Path to the site's SQLite database file.
 * @param steamID Wallet owner.
 * @param amount Coins to withdraw (positive integer).
 * @param reason Text shown in the wallet history.
 * @returns Whether the withdrawal happened and the balance afterwards.
 * @throws If the database file is missing or cannot be locked in time.
 */
export const spendCoins = (
  dbPath: string,
  steamID: string,
  amount: number,
  reason: string,
): TSpendResult => {
  const db = openDatabase(dbPath);

  try {
    db.exec('BEGIN IMMEDIATE');
    const { changes } = db
      .prepare(
        'UPDATE wallets SET balance = balance - ?, spent = spent + ? WHERE steam_id = ? AND balance >= ?',
      )
      .run(amount, amount, steamID, amount);
    const success = Number(changes) === 1;

    if (success) {
      db.prepare(
        'INSERT INTO eco_log (ts, steam_id, amount, reason, actor_id) VALUES (?, ?, ?, ?, NULL)',
      ).run(
        new Date().toISOString().slice(0, 19).replace('T', ' '),
        steamID,
        -amount,
        reason,
      );
    }
    db.exec('COMMIT');

    const row = db
      .prepare('SELECT balance FROM wallets WHERE steam_id = ?')
      .get(steamID) as { balance: number } | undefined;

    return { success, balance: row?.balance ?? 0 };
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  } finally {
    db.close();
  }
};

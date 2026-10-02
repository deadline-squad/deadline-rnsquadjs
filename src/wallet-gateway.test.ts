import { mkdtempSync, rmSync } from 'node:fs';
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from './wallet';
import { spendCoinsRemote } from './wallet-client';
import { createWalletGateway } from './wallet-gateway';

const TOKEN = 'secret-token';
const STEAM_ID = '76561198000000001';

describe('wallet gateway', () => {
  let dir: string;
  let dbPath: string;
  let server: ReturnType<typeof createWalletGateway>;
  let url: string;

  const readWallet = () => {
    const db = openDatabase(dbPath);
    const wallet = db
      .prepare('SELECT balance, spent FROM wallets WHERE steam_id = ?')
      .get(STEAM_ID) as { balance: number; spent: number };
    const log = db
      .prepare('SELECT amount, reason FROM eco_log WHERE steam_id = ?')
      .all(STEAM_ID);
    db.close();
    return { wallet, log };
  };

  const post = (body: unknown, token: string | null = TOKEN, path = '/spend') =>
    fetch(`${url}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'wallet-gateway-'));
    dbPath = join(dir, 'database.db');
    const db = openDatabase(dbPath);
    db.exec(`CREATE TABLE wallets (steam_id TEXT PRIMARY KEY, balance INTEGER NOT NULL DEFAULT 0, earned INTEGER NOT NULL DEFAULT 0, spent INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE eco_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, steam_id TEXT, amount INTEGER, reason TEXT, actor_id INTEGER);
      INSERT INTO wallets (steam_id, balance) VALUES ('${STEAM_ID}', 500);`);
    db.close();

    server = createWalletGateway({ dbPath, token: TOKEN });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  });

  it('withdraws coins and logs the operation', async () => {
    const response = await post({
      steamID: STEAM_ID,
      amount: 400,
      reason: 'Игра: открытие точек',
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, balance: 100 });
    expect(readWallet()).toEqual({
      wallet: { balance: 100, spent: 400 },
      log: [{ amount: -400, reason: 'Игра: открытие точек' }],
    });
  });

  it('refuses to overdraw the wallet', async () => {
    const response = await post({
      steamID: STEAM_ID,
      amount: 600,
      reason: 'test',
    });

    expect(await response.json()).toEqual({ success: false, balance: 500 });
    expect(readWallet().wallet.balance).toBe(500);
  });

  it('rejects a missing or wrong token', async () => {
    const body = { steamID: STEAM_ID, amount: 400, reason: 'test' };

    expect((await post(body, null)).status).toBe(401);
    expect((await post(body, 'wrong')).status).toBe(401);
    expect(readWallet().wallet.balance).toBe(500);
  });

  it.each([
    { steamID: 'abc', amount: 400, reason: 'test' },
    { steamID: STEAM_ID, amount: -5, reason: 'test' },
    { steamID: STEAM_ID, amount: 1.5, reason: 'test' },
    { steamID: STEAM_ID, amount: 400, reason: '' },
  ])('rejects an invalid body %j', async (body) => {
    expect((await post(body)).status).toBe(400);
    expect(readWallet().wallet.balance).toBe(500);
  });

  it('answers 404 for other routes', async () => {
    expect((await post({}, TOKEN, '/other')).status).toBe(404);
  });

  it('works through the client', async () => {
    expect(await spendCoinsRemote(url, TOKEN, STEAM_ID, 400, 'client')).toEqual(
      { success: true, balance: 100 },
    );
    await expect(
      spendCoinsRemote(url, 'wrong', STEAM_ID, 400, 'client'),
    ).rejects.toThrow('401');
  });
});

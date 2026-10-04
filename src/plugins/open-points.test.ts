import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EVENTS } from '../constants';
import { createFakeState, makePlayer } from '../test/fakes';
import { TState } from '../types';
import { openDatabase } from '../wallet';
import openPoints from './open-points';

const players = [
  makePlayer({ steamID: 'p1', name: 'P1' }),
  makePlayer({ steamID: 'p2', name: 'P2' }),
  makePlayer({ steamID: 'p3', name: 'P3' }),
  makePlayer({ steamID: 'p4', name: 'P4' }),
];

const RAAS = { level: 'Mutaha', layer: 'Mutaha_RAAS_v1' };
const AAS = { level: 'Mutaha', layer: 'Mutaha_AAS_v1' };

describe('openPoints', () => {
  let dir: string;
  let dbPath: string;

  const readWallet = (steamID: string) => {
    const db = openDatabase(dbPath);
    const wallet = db
      .prepare('SELECT balance, spent FROM wallets WHERE steam_id = ?')
      .get(steamID) as { balance: number; spent: number };
    const log = db
      .prepare('SELECT amount, reason FROM eco_log WHERE steam_id = ?')
      .all(steamID);
    db.close();
    return { wallet, log };
  };

  const run = (state: TState, over: Record<string, unknown> = {}) =>
    openPoints.setup({
      state,
      options: {
        walletDbPath: dbPath,
        cost: 400,
        needVotes: 2,
        successChance: 1,
        voteDuration: 2000,
        voteTick: 1000,
        ...over,
      },
      logger: state.logger,
      registerDisposable: () => {},
    });

  const start = (listener: { emit: (e: string, d: unknown) => void }) =>
    listener.emit(EVENTS.CHAT_COMMAND_OPEN_POINTS, {
      steamID: 'p1',
      message: '',
    });

  const vote = (
    listener: { emit: (e: string, d: unknown) => void },
    steamID: string,
    message: string,
  ) => listener.emit(EVENTS.CHAT_MESSAGE, { steamID, message });

  beforeEach(() => {
    vi.useFakeTimers();
    dir = mkdtempSync(join(tmpdir(), 'open-points-'));
    dbPath = join(dir, 'database.db');
    const db = openDatabase(dbPath);
    db.exec(`CREATE TABLE wallets (steam_id TEXT PRIMARY KEY, balance INTEGER NOT NULL DEFAULT 0, earned INTEGER NOT NULL DEFAULT 0, spent INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE eco_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, steam_id TEXT, amount INTEGER, reason TEXT, actor_id INTEGER);
      INSERT INTO wallets (steam_id, balance) VALUES ('p1', 1000), ('poor', 100);`);
    db.close();
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(dir, { recursive: true, force: true });
  });

  it('charges the initiator and opens the points when enough votes are cast', async () => {
    const { state, listener, commands } = createFakeState({
      players,
      currentMap: RAAS,
    });
    run(state);

    start(listener);
    await vi.advanceTimersByTimeAsync(0);
    vote(listener, 'p2', '+');
    vote(listener, 'p3', '+');
    await vi.advanceTimersByTimeAsync(0);

    expect(commands).toContain('AdminSetFogOfWar 0');
    expect(commands.join('\n')).toContain('ТОЧКИ ВИДНЫ ВСЕМ');
    expect(readWallet('p1').wallet).toEqual({ balance: 600, spent: 400 });
    expect(readWallet('p1').log).toEqual([
      { amount: -400, reason: 'Игра: открытие точек' },
    ]);
    expect(state.votingActive).toBeFalsy();
  });

  it('lets a minus cancel a plus', async () => {
    const { state, listener, commands } = createFakeState({
      players,
      currentMap: RAAS,
    });
    run(state);

    start(listener);
    await vi.advanceTimersByTimeAsync(0);
    vote(listener, 'p4', '-');
    vote(listener, 'p2', '+');
    vote(listener, 'p3', '+');
    await vi.advanceTimersByTimeAsync(2000);

    expect(commands).not.toContain('AdminSetFogOfWar 0');
    expect(commands.join('\n')).toContain('ТОЧКИ ЗАКРЫТЫ');
  });

  it('keeps the coins spent and blocks a second attempt after a failed vote', async () => {
    const { state, listener, commands } = createFakeState({
      players,
      currentMap: RAAS,
    });
    run(state);

    start(listener);
    await vi.advanceTimersByTimeAsync(2000);
    expect(commands.join('\n')).toContain('ТОЧКИ ЗАКРЫТЫ');

    start(listener);
    await vi.advanceTimersByTimeAsync(0);

    expect(commands.join('\n')).toContain(
      'Открытие точек невозможно до следующего раунда',
    );
    expect(readWallet('p1').wallet.balance).toBe(600);
  });

  it('allows a new attempt after the next game starts and restores the fog', async () => {
    const { state, listener, commands } = createFakeState({
      players,
      currentMap: RAAS,
    });
    run(state);

    start(listener);
    await vi.advanceTimersByTimeAsync(0);
    vote(listener, 'p2', '+');
    vote(listener, 'p3', '+');
    await vi.advanceTimersByTimeAsync(0);

    listener.emit(EVENTS.NEW_GAME, {});
    await vi.advanceTimersByTimeAsync(0);
    expect(commands).toContain('AdminSetFogOfWar 1');

    start(listener);
    await vi.advanceTimersByTimeAsync(0);
    expect(readWallet('p1').wallet.balance).toBe(200);
  });

  it('warns and does not start the vote when coins are not enough', async () => {
    const { state, listener, commands } = createFakeState({
      players: [...players, makePlayer({ steamID: 'poor', name: 'Poor' })],
      currentMap: RAAS,
    });
    run(state);

    listener.emit(EVENTS.CHAT_COMMAND_OPEN_POINTS, {
      steamID: 'poor',
      message: '',
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(commands.join('\n')).toContain('Недостаточно коинов');
    expect(state.votingActive).toBeFalsy();
    expect(readWallet('poor').wallet.balance).toBe(100);

    start(listener);
    await vi.advanceTimersByTimeAsync(0);
    expect(readWallet('p1').wallet.balance).toBe(600);
  });

  it('ignores the command outside of RAAS', async () => {
    const { state, listener, commands } = createFakeState({
      players,
      currentMap: AAS,
    });
    run(state);

    start(listener);
    await vi.advanceTimersByTimeAsync(0);

    expect(commands).toEqual([]);
    expect(readWallet('p1').wallet.balance).toBe(1000);
  });

  it('does not start while another vote is running', async () => {
    const { state, listener, commands } = createFakeState({
      players,
      currentMap: RAAS,
    });
    state.votingActive = true;
    run(state);

    start(listener);
    await vi.advanceTimersByTimeAsync(0);

    expect(commands.join('\n')).toContain('голосование уже идет');
    expect(readWallet('p1').wallet.balance).toBe(1000);
  });

  it('reports unavailable coins when the wallet database cannot be opened', async () => {
    const { state, listener, commands } = createFakeState({
      players,
      currentMap: RAAS,
    });
    run(state, { walletDbPath: join(dir, 'missing', 'database.db') });

    start(listener);
    await vi.advanceTimersByTimeAsync(0);

    expect(commands.join('\n')).toContain('Коины сейчас недоступны');
    expect(state.votingActive).toBeFalsy();
  });

  describe('random start chance', () => {
    const giveCoins = (steamID: string, balance: number) => {
      const db = openDatabase(dbPath);
      db.exec(
        `INSERT INTO wallets (steam_id, balance) VALUES ('${steamID}', ${balance})`,
      );
      db.close();
    };

    const say = (
      listener: { emit: (e: string, d: unknown) => void },
      steamID: string,
    ) =>
      listener.emit(EVENTS.CHAT_COMMAND_OPEN_POINTS, { steamID, message: '' });

    it('uses a 40% chance and 15 votes by default', () => {
      const parsed = openPoints.optionsSchema!.parse({ walletDbPath: 'x' });

      expect(parsed.successChance).toBe(0.4);
      expect(parsed.needVotes).toBe(15);
    });

    it('warns without charging when the roll fails', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.9);
      const { state, listener, commands } = createFakeState({
        players,
        currentMap: RAAS,
      });
      run(state, { successChance: 0.4 });

      say(listener, 'p1');
      await vi.advanceTimersByTimeAsync(0);

      expect(commands.join('\n')).toContain('Не повезло');
      expect(commands.join('\n')).not.toContain('запустил голосование');
      expect(state.votingActive).toBeFalsy();
      expect(readWallet('p1').wallet).toEqual({ balance: 1000, spent: 0 });
    });

    it('starts the vote and charges when the roll succeeds', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.39);
      const { state, listener, commands } = createFakeState({
        players,
        currentMap: RAAS,
      });
      run(state, { successChance: 0.4 });

      say(listener, 'p1');
      await vi.advanceTimersByTimeAsync(0);

      expect(commands.join('\n')).toContain('запустил голосование');
      expect(state.votingActive).toBe(true);
      expect(readWallet('p1').wallet.balance).toBe(600);
    });

    it('treats a roll exactly on the threshold as a miss', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.4);
      const { state, listener } = createFakeState({
        players,
        currentMap: RAAS,
      });
      run(state, { successChance: 0.4 });

      say(listener, 'p1');
      await vi.advanceTimersByTimeAsync(0);

      expect(state.votingActive).toBeFalsy();
    });

    it('gives each player one roll per round', async () => {
      const random = vi.spyOn(Math, 'random').mockReturnValue(0.9);
      const { state, listener, commands } = createFakeState({
        players,
        currentMap: RAAS,
      });
      run(state, { successChance: 0.4 });

      say(listener, 'p1');
      await vi.advanceTimersByTimeAsync(0);
      random.mockReturnValue(0.1);
      say(listener, 'p1');
      await vi.advanceTimersByTimeAsync(0);

      expect(commands.join('\n')).toContain(
        'Открытие точек невозможно до следующего раунда',
      );
      expect(state.votingActive).toBeFalsy();
      expect(readWallet('p1').wallet.balance).toBe(1000);
    });

    it('lets another player try after someone else missed', async () => {
      giveCoins('p2', 500);
      const random = vi.spyOn(Math, 'random').mockReturnValue(0.9);
      const { state, listener } = createFakeState({
        players,
        currentMap: RAAS,
      });
      run(state, { successChance: 0.4 });

      say(listener, 'p1');
      await vi.advanceTimersByTimeAsync(0);
      random.mockReturnValue(0.1);
      say(listener, 'p2');
      await vi.advanceTimersByTimeAsync(0);

      expect(state.votingActive).toBe(true);
      expect(readWallet('p2').wallet.balance).toBe(100);
    });

    it('resets every roll when the next game starts', async () => {
      const random = vi.spyOn(Math, 'random').mockReturnValue(0.9);
      const { state, listener } = createFakeState({
        players,
        currentMap: RAAS,
      });
      run(state, { successChance: 0.4 });

      say(listener, 'p1');
      await vi.advanceTimersByTimeAsync(0);
      listener.emit(EVENTS.NEW_GAME, {});
      random.mockReturnValue(0.1);
      say(listener, 'p1');
      await vi.advanceTimersByTimeAsync(0);

      expect(state.votingActive).toBe(true);
    });

    it('keeps the roll spent when the player cannot pay', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.1);
      const { state, listener, commands } = createFakeState({
        players: [...players, makePlayer({ steamID: 'poor', name: 'Poor' })],
        currentMap: RAAS,
      });
      run(state, { successChance: 0.4 });

      say(listener, 'poor');
      await vi.advanceTimersByTimeAsync(0);
      say(listener, 'poor');
      await vi.advanceTimersByTimeAsync(0);

      expect(commands.join('\n')).toContain('Недостаточно коинов');
      expect(commands.join('\n')).toContain(
        'Открытие точек невозможно до следующего раунда',
      );
    });
  });
});

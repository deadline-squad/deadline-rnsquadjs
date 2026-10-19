import { TChatMessage } from 'squad-rcon';
import { z } from 'zod';
import { EVENTS } from '../constants';
import { adminBroadcast, adminSetFogOfWar, adminWarn } from '../core';
import { definePlugin } from '../core/plugin';
import { spendCoins } from '../wallet';
import { spendCoinsRemote } from '../wallet-client';
import { getPlayerBySteamID, getPlayers } from './helpers';

const FOG_OF_WAR_ON = 1;
const FOG_OF_WAR_OFF = 0;

const optionsSchema = z.object({
  walletDbPath: z.string().min(1).optional(),
  walletApiUrl: z.string().url().optional(),
  walletApiToken: z.string().min(1).optional(),
  cost: z.coerce.number().int().positive().default(400),
  needVotes: z.coerce.number().int().positive().default(15),
  successChance: z.coerce.number().min(0).max(1).default(0.4),
  voteDuration: z.coerce.number().int().positive().default(120000),
  voteTick: z.coerce.number().int().positive().default(30000),
});

const isRaas = (layer?: string | null) =>
  Boolean(layer?.toLowerCase().includes('raas'));

export default definePlugin({
  name: 'openPoints',
  description:
    'Платное голосование на отключение тумана войны (открытие точек) в RAAS: бросок с шансом, затем голосование.',
  optionsSchema,
  setup({ state, options, logger, registerDisposable }) {
    const { listener, execute } = state;
    const {
      walletDbPath,
      walletApiUrl,
      walletApiToken,
      cost,
      needVotes,
      successChance,
      voteDuration,
      voteTick,
    } = options;

    const spend = async (steamID: string) => {
      const reason = 'Игра: открытие точек';
      if (walletApiUrl && walletApiToken) {
        return spendCoinsRemote(
          walletApiUrl,
          walletApiToken,
          steamID,
          cost,
          reason,
        );
      }
      if (walletDbPath) return spendCoins(walletDbPath, steamID, cost, reason);
      throw new Error('не задан walletApiUrl/walletApiToken или walletDbPath');
    };

    let attemptUsed = false;
    const rolledPlayers = new Set<string>();
    let voteActive = false;
    let fogOpened = false;
    let secondsToEnd = voteDuration / 1000;
    let timer: NodeJS.Timeout | undefined;
    let votes: { '+': string[]; '-': string[] } = { '+': [], '-': [] };

    const tally = () => {
      const onlineIds = new Set(
        (getPlayers(state) ?? []).map((player) => player.steamID),
      );
      const positive = votes['+'].filter((id) => onlineIds.has(id)).length;
      const negative = votes['-'].filter((id) => onlineIds.has(id)).length;
      return { positive, negative, score: positive - negative };
    };

    const finishVote = () => {
      if (timer) clearInterval(timer);
      timer = undefined;
      voteActive = false;
      state.votingActive = false;
    };

    const openPoints = async () => {
      try {
        await adminSetFogOfWar(execute, FOG_OF_WAR_OFF);
        fogOpened = true;
        adminBroadcast(execute, 'Туман войны отключен(ТОЧКИ ВИДНЫ ВСЕМ)');
      } catch (error) {
        logger.error(`[openPoints] не удалось отключить туман: ${error}`);
      }
    };

    const concludeVote = async () => {
      const { positive, negative, score } = tally();
      finishVote();
      logger.log(
        `[openPoints] итог: за ${positive}, против ${negative}, набрано ${score} из ${needVotes}`,
      );

      if (score >= needVotes) {
        await openPoints();
        return;
      }
      adminBroadcast(execute, 'Туман войны остается включенным(ТОЧКИ ЗАКРЫТЫ)');
    };

    const broadcastProgress = () => {
      const { positive, negative, score } = tally();
      adminBroadcast(
        execute,
        `Голосование за открытие точек!\nЗа: ${positive} Против: ${negative} Набрано: ${Math.max(score, 0)} из ${needVotes} голос(ов)`,
      );
      adminBroadcast(
        execute,
        'Используйте +(За) или -(Против) для голосования',
      );
    };

    const chatCommand = async ({ steamID }: TChatMessage) => {
      if (!isRaas(state.currentMap?.layer)) return;

      if (attemptUsed || rolledPlayers.has(steamID)) {
        adminWarn(
          execute,
          steamID,
          'Открытие точек невозможно до следующего раунда',
        );
        return;
      }
      if (state.votingActive) {
        adminWarn(execute, steamID, 'В данный момент голосование уже идет!');
        return;
      }

      rolledPlayers.add(steamID);
      if (Math.random() >= successChance) {
        logger.log(`[openPoints] ${steamID}: бросок не выпал`);
        adminWarn(
          execute,
          steamID,
          'Не повезло: голосование за открытие точек не запустилось. Коины не списаны.',
        );
        return;
      }

      attemptUsed = true;
      let balance: number;
      try {
        const result = await spend(steamID);
        if (!result.success) {
          attemptUsed = false;
          adminWarn(
            execute,
            steamID,
            `Недостаточно коинов: нужно ${cost}, у вас ${result.balance}`,
          );
          return;
        }
        balance = result.balance;
      } catch (error) {
        attemptUsed = false;
        rolledPlayers.delete(steamID);
        logger.error(`[openPoints] ошибка списания коинов: ${error}`);
        adminWarn(
          execute,
          steamID,
          'Коины сейчас недоступны, попробуйте позже',
        );
        return;
      }

      const initiator = getPlayerBySteamID(state, steamID);
      logger.log(
        `[openPoints] ${steamID} запустил голосование (списано ${cost}, остаток ${balance})`,
      );
      adminWarn(
        execute,
        steamID,
        `Повезло: голосование за открытие точек запущено. Списано ${cost} коинов, остаток ${balance}`,
      );
      adminBroadcast(
        execute,
        `${initiator?.name ?? steamID} запустил голосование на открытие точек для всех игроков!`,
      );

      votes = { '+': [], '-': [] };
      voteActive = true;
      state.votingActive = true;
      secondsToEnd = voteDuration / 1000;

      timer = setInterval(() => {
        secondsToEnd -= voteTick / 1000;
        if (secondsToEnd <= 0) void concludeVote();
        else broadcastProgress();
      }, voteTick);
    };

    const chatMessage = ({ steamID, message }: TChatMessage) => {
      if (!voteActive) return;
      const vote = message.trim();
      if (vote !== '+' && vote !== '-') return;

      votes['+'] = votes['+'].filter((id) => id !== steamID);
      votes['-'] = votes['-'].filter((id) => id !== steamID);
      votes[vote].push(steamID);
      adminWarn(execute, steamID, 'Твой голос принят!');

      if (tally().score >= needVotes) void concludeVote();
    };

    const newGame = () => {
      finishVote();
      attemptUsed = false;
      rolledPlayers.clear();
      votes = { '+': [], '-': [] };

      if (!fogOpened) return;
      fogOpened = false;
      adminSetFogOfWar(execute, FOG_OF_WAR_ON).catch((error) =>
        logger.error(`[openPoints] не удалось вернуть туман: ${error}`),
      );
    };

    listener.on(EVENTS.CHAT_COMMAND_OPEN_POINTS, chatCommand);
    listener.on(EVENTS.CHAT_MESSAGE, chatMessage);
    listener.on(EVENTS.NEW_GAME, newGame);

    registerDisposable(() => {
      listener.off(EVENTS.CHAT_COMMAND_OPEN_POINTS, chatCommand);
      listener.off(EVENTS.CHAT_MESSAGE, chatMessage);
      listener.off(EVENTS.NEW_GAME, newGame);
      finishVote();
    });
  },
});

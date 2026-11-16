import EventEmitter from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EVENTS } from '../constants';
import { createFakeState, makePlayer } from '../test/fakes';
import chatCommands from './chat-commands';

const players = [
  makePlayer({
    steamID: 'requester',
    name: 'Requester',
    teamID: '1',
    squadID: '1',
  }),
  makePlayer({
    steamID: 'leader3',
    name: 'Leader',
    teamID: '1',
    squadID: '3',
    isLeader: true,
  }),
  makePlayer({
    steamID: 'enemyLeader4',
    name: 'Enemy',
    teamID: '2',
    squadID: '4',
    isLeader: true,
  }),
];

const setupInv = () => {
  const fake = createFakeState({ players });
  chatCommands.setup({
    state: fake.state,
    options: chatCommands.optionsSchema!.parse({ invEnable: true }),
    logger: fake.state.logger,
    registerDisposable: () => {},
  });
  return fake;
};

const say = (listener: EventEmitter, message: string) =>
  listener.emit(EVENTS.CHAT_MESSAGE, {
    steamID: 'requester',
    name: 'Requester',
    message,
  });

const warnsTo = (commands: string[], steamID: string) =>
  commands.filter((c) => c.startsWith('AdminWarn') && c.includes(steamID));

describe('chatCommands !inv', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it.each(['!inv 3', '!inv3', '!INV3', '!Inv 3', '  !iNv   3  '])(
    'notifies the squad leader for "%s"',
    (message) => {
      const { listener, commands } = setupInv();
      say(listener, message);

      const toLeader = warnsTo(commands, 'leader3');
      expect(toLeader).toHaveLength(1);
      expect(toLeader[0]).toContain('Игрок Requester хочет зайти в ваш отряд.');
      expect(warnsTo(commands, 'requester')[0]).toContain(
        'Запрос отправлен лидеру отряда 3.',
      );
    },
  );

  it('asks for a squad number when none is given', () => {
    const { listener, commands } = setupInv();
    say(listener, '!inv');

    expect(warnsTo(commands, 'requester')[0]).toContain('Укажите номер отряда');
  });

  it.each(['!invite 3', 'inv 3', 'привет !inv 3'])(
    'ignores "%s"',
    (message) => {
      const { listener, commands } = setupInv();
      say(listener, message);

      expect(commands).toHaveLength(0);
    },
  );

  it('does not reach a squad of the other team', () => {
    const { listener, commands } = setupInv();
    say(listener, '!inv4');

    expect(warnsTo(commands, 'enemyLeader4')).toHaveLength(0);
    expect(warnsTo(commands, 'requester')[0]).toContain('Отряд 4 не найден.');
  });

  it('rate-limits repeated requests until invTimeout passes', () => {
    const { listener, commands } = setupInv();
    say(listener, '!inv3');
    commands.length = 0;

    say(listener, '!inv3');
    expect(warnsTo(commands, 'leader3')).toHaveLength(0);
    expect(warnsTo(commands, 'requester')[0]).toContain(
      'не чаще раза в минуту',
    );

    vi.advanceTimersByTime(60000);
    commands.length = 0;
    say(listener, '!INV 3');
    expect(warnsTo(commands, 'leader3')).toHaveLength(1);
  });
});

describe('chatCommands !sw', () => {
  const setupSwap = () => {
    const fake = createFakeState({ players });
    chatCommands.setup({
      state: fake.state,
      options: chatCommands.optionsSchema!.parse({ swapEnable: true }),
      logger: fake.state.logger,
      registerDisposable: () => {},
    });
    return fake;
  };

  const swapAs = (listener: EventEmitter, steamID: string) =>
    listener.emit(EVENTS.CHAT_COMMAND_SW, { steamID, name: steamID });

  const teamChanges = (commands: string[]) =>
    commands.filter((c) => c.startsWith('AdminForceTeamChange'));

  it('changes the team on the first use', () => {
    const { listener, commands } = setupSwap();
    swapAs(listener, 'requester');

    expect(teamChanges(commands)).toHaveLength(1);
  });

  it('refuses a second use in the same game', () => {
    const { listener, commands } = setupSwap();
    swapAs(listener, 'requester');
    swapAs(listener, 'requester');

    expect(teamChanges(commands)).toHaveLength(1);
    expect(warnsTo(commands, 'requester').at(-1)).toContain('1 раз за игру');
  });

  it('refuses a second use through any alias', () => {
    const { listener, commands } = setupSwap();
    swapAs(listener, 'requester');
    listener.emit(EVENTS.CHAT_COMMAND_SWAP, { steamID: 'requester' });
    listener.emit(EVENTS.CHAT_COMMAND_SWITCH, { steamID: 'requester' });

    expect(teamChanges(commands)).toHaveLength(1);
  });

  it('keeps the limit per player', () => {
    const { listener, commands } = setupSwap();
    swapAs(listener, 'requester');
    swapAs(listener, 'leader3');

    expect(teamChanges(commands)).toHaveLength(2);
  });

  it('allows a new swap after a new game starts', () => {
    const { listener, commands } = setupSwap();
    swapAs(listener, 'requester');
    listener.emit(EVENTS.NEW_GAME, {});
    swapAs(listener, 'requester');

    expect(teamChanges(commands)).toHaveLength(2);
  });
});

describe('chatCommands !ствол', () => {
  it('is no longer a command: no broadcast and no entry in !help', () => {
    const fake = createFakeState({ players });
    chatCommands.setup({
      state: fake.state,
      options: chatCommands.optionsSchema!.parse({
        rollEnable: true,
        stvolEnable: true,
      }),
      logger: fake.state.logger,
      registerDisposable: () => {},
    });
    const data = { steamID: 'requester', name: 'Requester', message: '' };

    fake.listener.emit('CHAT_COMMAND:ствол', data);
    fake.listener.emit(EVENTS.CHAT_COMMAND_HELP, data);

    expect(fake.commands.filter((c) => c.includes('ствол'))).toHaveLength(0);
  });
});

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

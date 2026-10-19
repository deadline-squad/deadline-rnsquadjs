import { afterEach, describe, expect, it } from 'vitest';
import { EVENTS } from '../constants';
import { PluginManager } from '../core/plugin/manager';
import { createFakeState, makePlayer } from '../test/fakes';
import killerNotify from './killer-notify';

describe('killerNotify', () => {
  let manager: PluginManager | null = null;

  afterEach(async () => {
    await manager?.destroyAll();
    manager = null;
  });

  const setup = async (rawOptions: Record<string, unknown> = {}) => {
    const fake = createFakeState({
      players: [
        makePlayer({ steamID: 'victim', name: 'Жертва', teamID: '1' }),
        makePlayer({ steamID: 'enemy', name: 'Враг', teamID: '2' }),
        makePlayer({ steamID: 'ally', name: 'Свой', teamID: '1' }),
      ],
    });
    manager = new PluginManager(fake.state, fake.state.logger);
    await manager.init([
      { descriptor: killerNotify, enabled: true, rawOptions },
    ]);
    return fake;
  };

  const wound = (
    listener: { emit: (event: string, data: unknown) => unknown },
    victimName: string,
    attackerSteamID: string,
  ) =>
    listener.emit(EVENTS.PLAYER_WOUNDED, {
      victimName,
      attackerSteamID,
      weapon: 'AK74',
    });

  it('tells the victim an enemy killed them', async () => {
    const { listener, commands } = await setup();

    wound(listener, 'Жертва', 'enemy');

    expect(commands).toEqual(['AdminWarn victim Вас убил враг Враг']);
  });

  it('tells the victim a teammate killed them', async () => {
    const { listener, commands } = await setup();

    wound(listener, 'Жертва', 'ally');

    expect(commands).toEqual(['AdminWarn victim Вас убил союзник Свой']);
  });

  it('stays silent on suicide and unknown attackers or victims', async () => {
    const { listener, commands } = await setup();

    wound(listener, 'Жертва', 'victim');
    wound(listener, 'Жертва', 'nobody');
    wound(listener, 'Неизвестный', 'enemy');

    expect(commands).toEqual([]);
  });

  it('uses custom message templates', async () => {
    const { listener, commands } = await setup({
      enemyMessage: 'Убит врагом: {attacker}',
    });

    wound(listener, 'Жертва', 'enemy');

    expect(commands).toEqual(['AdminWarn victim Убит врагом: Враг']);
  });
});

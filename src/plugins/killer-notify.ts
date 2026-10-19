import { TPlayerWounded } from 'squad-logs';
import { z } from 'zod';
import { EVENTS } from '../constants';
import { adminWarn } from '../core';
import { definePlugin } from '../core/plugin';
import { getPlayerByName, getPlayerBySteamID } from './helpers';

const optionsSchema = z.object({
  enemyMessage: z.string().default('Вас убил враг {attacker}'),
  allyMessage: z.string().default('Вас убил союзник {attacker}'),
});

export default definePlugin({
  name: 'killerNotify',
  description: 'Предупреждение убитому игроку: кто его убил, враг или союзник.',
  optionsSchema,
  setup({ state, options, registerDisposable }) {
    const { listener, execute } = state;
    const { enemyMessage, allyMessage } = options;

    const onPlayerWounded = ({
      victimName,
      attackerSteamID,
    }: TPlayerWounded) => {
      if (!victimName) return;

      const victim = getPlayerByName(state, victimName);
      const attacker = getPlayerBySteamID(state, attackerSteamID);
      if (!victim?.steamID || !attacker?.name) return;
      if (victim.steamID === attacker.steamID) return;

      const template =
        victim.teamID === attacker.teamID ? allyMessage : enemyMessage;
      adminWarn(
        execute,
        victim.steamID,
        template.replace('{attacker}', attacker.name),
      );
    };

    listener.on(EVENTS.PLAYER_WOUNDED, onPlayerWounded);
    registerDisposable(() =>
      listener.off(EVENTS.PLAYER_WOUNDED, onPlayerWounded),
    );
  },
});

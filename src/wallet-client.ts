import { TSpendResult } from './wallet';

const REQUEST_TIMEOUT_MS = 5000;

/**
 * Withdraws coins through the wallet gateway running next to the site.
 *
 * @param apiUrl Base URL of the gateway, e.g. `http://host:8791`.
 * @param token Shared bearer token of the gateway.
 * @param steamID Wallet owner.
 * @param amount Coins to withdraw (positive integer).
 * @param reason Text shown in the wallet history.
 * @returns Whether the withdrawal happened and the balance afterwards.
 * @throws If the gateway is unreachable, times out or answers with an error.
 */
export const spendCoinsRemote = async (
  apiUrl: string,
  token: string,
  steamID: string,
  amount: number,
  reason: string,
): Promise<TSpendResult> => {
  const response = await fetch(new URL('/spend', apiUrl), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ steamID, amount, reason }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`шлюз коинов ответил ${response.status}`);
  }
  return (await response.json()) as TSpendResult;
};

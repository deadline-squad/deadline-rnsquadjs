import { timingSafeEqual } from 'node:crypto';
import { createServer, IncomingMessage, Server } from 'node:http';
import { spendCoins } from './wallet';

const MAX_BODY_BYTES = 1024;
const MAX_AMOUNT = 100000;
const MAX_REASON_LENGTH = 100;
const STEAM_ID_PATTERN = /^\d{17}$/;

export type TWalletGatewayOptions = {
  dbPath: string;
  token: string;
};

const isAuthorized = (request: IncomingMessage, token: string) => {
  const expected = Buffer.from(`Bearer ${token}`);
  const received = Buffer.from(request.headers.authorization ?? '');
  return (
    received.length === expected.length && timingSafeEqual(received, expected)
  );
};

const readBody = (request: IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('payload too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });

/**
 * Creates the HTTP gateway that lets game servers on other hosts withdraw
 * coins from the website wallet database.
 *
 * `POST /spend` with `Authorization: Bearer <token>` and a JSON body
 * `{ steamID, amount, reason }` answers `{ success, balance }`. Anything
 * else is rejected: 401 for a wrong token, 400 for an invalid body,
 * 404 for other routes, 500 when the database is unavailable.
 *
 * @param options Path to the site's SQLite database and the shared token.
 * @returns A not yet listening HTTP server.
 */
export const createWalletGateway = ({
  dbPath,
  token,
}: TWalletGatewayOptions): Server =>
  createServer(async (request, response) => {
    const reply = (status: number, body: object) => {
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(body));
    };

    if (request.method !== 'POST' || request.url !== '/spend') {
      return reply(404, { error: 'not found' });
    }
    if (!isAuthorized(request, token)) {
      return reply(401, { error: 'unauthorized' });
    }

    let payload: { steamID?: unknown; amount?: unknown; reason?: unknown };
    try {
      payload = JSON.parse(await readBody(request));
    } catch {
      return reply(400, { error: 'invalid body' });
    }

    const { steamID, amount, reason } = payload;
    if (
      typeof steamID !== 'string' ||
      !STEAM_ID_PATTERN.test(steamID) ||
      !Number.isInteger(amount) ||
      (amount as number) < 1 ||
      (amount as number) > MAX_AMOUNT ||
      typeof reason !== 'string' ||
      reason.length === 0 ||
      reason.length > MAX_REASON_LENGTH
    ) {
      return reply(400, { error: 'invalid body' });
    }

    try {
      const result = spendCoins(dbPath, steamID, amount as number, reason);
      console.log(
        `[wallet-gateway] ${steamID} -${amount} "${reason}" success=${result.success}`,
      );
      return reply(200, result);
    } catch (error) {
      console.error(`[wallet-gateway] ошибка списания: ${error}`);
      return reply(500, { error: 'wallet unavailable' });
    }
  });

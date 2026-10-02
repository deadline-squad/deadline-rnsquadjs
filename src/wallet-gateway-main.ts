import { createWalletGateway } from './wallet-gateway';

const {
  WALLET_DB_PATH,
  WALLET_GATEWAY_TOKEN,
  WALLET_GATEWAY_HOST,
  WALLET_GATEWAY_PORT,
} = process.env;

if (!WALLET_DB_PATH || !WALLET_GATEWAY_TOKEN) {
  console.error('Нужны переменные WALLET_DB_PATH и WALLET_GATEWAY_TOKEN');
  process.exit(1);
}

const host = WALLET_GATEWAY_HOST ?? '0.0.0.0';
const port = Number(WALLET_GATEWAY_PORT ?? 8791);

createWalletGateway({
  dbPath: WALLET_DB_PATH,
  token: WALLET_GATEWAY_TOKEN,
}).listen(port, host, () =>
  console.log(`[wallet-gateway] слушает ${host}:${port}`),
);

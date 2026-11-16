# Production deployment

What runs on the game host (`/home/RNSquadJS`) and which part of it lives in this repository.

| On the host | In this repository |
|---|---|
| Sources of `/home/RNSquadJS` (git, branch `deadline-local`) | Everything tracked; tag `prod-2026-10-27` marks the commit whose tree is identical to the host |
| Built `lib/` (`yarn build`; `index.js`, `wallet-gateway-main.js`, `heli.json`, `vanilla.json`) | Reproducible: `yarn install --frozen-lockfile && yarn build` gives the same SHA-256 as the host |
| `/etc/systemd/system/rnsquadjs.service`, `wallet-gateway.service` | `deploy/systemd/` (copies; the host unit files are the ones that run) |
| `config.json` (servers, passwords, per-plugin settings) | Not here: it holds secrets. `config.example.json` shows the shape |
| `.env`, `/etc/wallet-gateway.env` | Not here: secrets |
| Mongo data (stats, wallet) | Not here: data |

The host checkout has no local commits of its own beyond what is in this repository's history: its HEAD (`6528a0a`) is a different commit with the same tree as `dev` at `f1552a5`.

## Checking that the host matches

```bash
yarn install --frozen-lockfile --ignore-scripts && yarn build
scripts/verify-prod.sh <ssh-user>@<game-host> prod-2026-10-27
```

The script only reads: it compares the git tree, counts modified tracked files on the host and compares the SHA-256 of the four built files with the local build. Exit code 0 means identical.

Recorded on 2026-10-27, tree `e2fa7ee8ad2e030723c92beefc9fef3e37c6434b`, 127 tracked files, Node 24 on the host:

```
f21120f7cbeaddb156f70a00ab0743bc9cd4ab40f5581f3a341dca6cade5f67c  lib/index.js
dc32b2f2fae26ec1cc4e04e4fcae2ff0f16aeba782f0d15fdccc547483ca6d0a  lib/wallet-gateway-main.js
6f610ac3f5a356afcadb0df3c69abeba8b0005e39ce4d4c1e7c148315b375653  lib/heli.json
650ff42cc26622f23a1bf272df6bfae906d3c8b575e795f290a88624d3bd2177  lib/vanilla.json
```

## Changing production

Edit and merge here first, then update the host checkout and build there, then restart `rnsquadjs`. After the change, tag the deployed commit `prod-<date>` and run the check above.

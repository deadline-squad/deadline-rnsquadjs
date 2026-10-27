#!/usr/bin/env bash
# Read-only check that a host runs exactly the code of this checkout.
#
# Compares the git tree of the host checkout (/home/RNSquadJS), whether any
# tracked file there is modified, and the SHA-256 of the built lib/ files with
# this checkout. Run `yarn build` first so the local lib/ exists. Changes
# nothing on either side.
#
# Usage: scripts/verify-prod.sh <ssh-target> [git-ref]   (git-ref defaults to HEAD)
set -euo pipefail

target=${1:?usage: scripts/verify-prod.sh <ssh-target> [git-ref]}
ref=${2:-HEAD}
artifacts="lib/index.js lib/wallet-gateway-main.js lib/heli.json lib/vanilla.json"

want_tree=$(git rev-parse "${ref}^{tree}")
want_hashes=$(sha256sum $artifacts)

remote='cd /home/RNSquadJS
g="git -c safe.directory=* --no-optional-locks"
$g rev-parse HEAD^{tree}
$g status --porcelain --untracked-files=no | wc -l
sha256sum '"$artifacts"
host_output=$(ssh -o BatchMode=yes "$target" "$remote")

got_tree=$(sed -n 1p <<<"$host_output")
modified_files=$(sed -n 2p <<<"$host_output")
got_hashes=$(sed -n '3,$p' <<<"$host_output")

status=0
if [[ "$got_tree" == "$want_tree" ]]; then
  echo "OK       tree $got_tree"
else
  echo "MISMATCH tree host=$got_tree repo=$want_tree"
  status=1
fi
if [[ "$modified_files" == "0" ]]; then
  echo "OK       no modified tracked files on the host"
else
  echo "MISMATCH $modified_files tracked file(s) modified on the host"
  status=1
fi
if [[ "$got_hashes" == "$want_hashes" ]]; then
  echo "OK       built files identical"
else
  echo "MISMATCH built files differ:"
  diff <(echo "$want_hashes") <(echo "$got_hashes") || true
  status=1
fi
exit "$status"

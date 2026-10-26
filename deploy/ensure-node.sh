#!/usr/bin/env bash
# Installs a private copy of Node.js for this system, and leaves the server's own Node alone.
# Other systems on the same server can keep running their old Node; this one gets its own, under /opt/recruit/node.
#   deploy/ensure-node.sh [major]        prints the path to the private "bin" folder when done
# It first checks whether the private copy already has the version we need, and only downloads if it does not.
set -Eeuo pipefail

ROOT="${RECRUIT_ROOT:-/opt/recruit}"
MAJOR="${1:-${NODE_MAJOR:-24}}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -f "$HERE/node-version" ] && [ -z "${1:-}" ] && [ -z "${NODE_MAJOR:-}" ] && MAJOR="$(tr -d '[:space:]' < "$HERE/node-version")"

say() { printf '%s\n' "$*" >&2; }
current_major() { [ -x "$ROOT/node/current/bin/node" ] && "$ROOT/node/current/bin/node" -p 'process.versions.node.split(".")[0]' 2>/dev/null || true; }

have="$(current_major)"
if [ "$have" = "$MAJOR" ]; then
  say "Node.js $("$ROOT/node/current/bin/node" -v) is already installed for this system, nothing to do."
  echo "$ROOT/node/current/bin"; exit 0
fi

case "$(uname -m)" in x86_64|amd64) ARCH=x64 ;; aarch64|arm64) ARCH=arm64 ;; armv7l) ARCH=armv7l ;; *) say "Unsupported processor: $(uname -m)"; exit 1 ;; esac
if ldd --version 2>&1 | grep -qi musl; then say "This server uses musl (for example Alpine). Node.js needs a glibc system such as Ubuntu or Debian."; exit 1; fi
command -v curl >/dev/null || { say "curl is required."; exit 1; }
command -v xz >/dev/null || { say "xz is required (apt install xz-utils)."; exit 1; }

BASE="https://nodejs.org/dist/latest-v${MAJOR}.x"
say "Looking up the latest Node.js ${MAJOR} ..."
SUMS="$(curl -fsSL "$BASE/SHASUMS256.txt")" || { say "Could not reach nodejs.org."; exit 1; }
FILE="$(printf '%s\n' "$SUMS" | awk -v a="linux-$ARCH.tar.xz" '$2 ~ a"$" {print $2; exit}')"
[ -n "$FILE" ] || { say "No Node.js ${MAJOR} download found for $ARCH."; exit 1; }
WANT="$(printf '%s\n' "$SUMS" | awk -v f="$FILE" '$2==f {print $1}')"
VER="${FILE#node-}"; VER="${VER%%-linux*}"

DEST="$ROOT/node/$VER"
if [ ! -x "$DEST/bin/node" ]; then
  TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
  say "Downloading $FILE ..."
  curl -fsSL "$BASE/$FILE" -o "$TMP/$FILE"
  GOT="$(sha256sum "$TMP/$FILE" | awk '{print $1}')"
  [ "$GOT" = "$WANT" ] || { say "The download is damaged (checksum does not match). Try again."; exit 1; }
  mkdir -p "$ROOT/node"
  tar -xJf "$TMP/$FILE" -C "$TMP"
  rm -rf "$DEST"; mv "$TMP/${FILE%.tar.xz}" "$DEST"
fi
ln -sfn "$DEST" "$ROOT/node/current"
say "Node.js $VER is ready at $ROOT/node/current (the server's own Node was not touched)."
echo "$ROOT/node/current/bin"

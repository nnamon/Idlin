#!/bin/sh
# Puts a capture's showcase set on the `media` branch, which the README's
# images point at. Run on the host, from the repo root, after a review capture:
#
#   tools/publish-media.sh captures/<folder>
set -eu

src="${1:?usage: tools/publish-media.sh <capture folder>}/showcase"
[ -d "$src" ] || { echo "no showcase folder in $1" >&2; exit 1; }

from=$(git rev-parse --short HEAD)
tree=$(mktemp -d)
trap 'git worktree remove --force "$tree" 2>/dev/null || true; rm -rf "$tree"' EXIT

git fetch -q origin media
git worktree add -q --detach "$tree" origin/media
mkdir -p "$tree/showcase"
cp "$src"/* "$tree/showcase/"
git -C "$tree" add showcase
if git -C "$tree" diff --cached --quiet; then
  echo "media already has these files"
else
  TZ=UTC git -C "$tree" commit -q -m "Showcase, published from $from"
  git -C "$tree" push -q origin HEAD:media
  echo "pushed the showcase from $from to media"
fi

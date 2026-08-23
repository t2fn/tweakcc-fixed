#!/usr/bin/env bash
# downloadVersions.sh — Download cli.js from Claude Code releases for fixture testing.
#
# Usage:
#   tools/downloadVersions.sh [v235 v234 ...]  (defaults to latest release)
#
# Downloads extract cli.js and saves as /tmp/cli-<version>.js

set -euo pipefail

VERSIONS="${@:-$(curl -s https://api.github.com/repos/anthropics/claude-code/releases/latest | jq -r '.tag_name')}"

for ver in $VERSIONS; do
  url="https://github.com/anthropics/claude-code/releases/download/${ver}/claude-code-${ver}-linux-x64.tar.gz"
  out="/tmp/cli-${ver#v}.js"
  echo "Downloading ${ver}..." >&2

  curl -sL "$url" | tar xz --strip-components=2 'package/cli.js' -O > "$out"
  size=$(wc -c < "$out")
  echo "  -> $out ($size bytes)" >&2
done

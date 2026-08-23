#!/usr/bin/env bash
# install.sh — Apply tweakcc-fixed patches with the three key toggles enabled.
#
# Usage:
#   npx tweakcc-fixed@latest install    # via npx (recommended)
#   curl -sL https://raw.githubusercontent.com/skrabe/tweakcc-fixed/main/install.sh | bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- Resolve the tweakcc binary / entrypoint ---------------------------------
TWEAKCC="${TWEAKCC_BIN:-tweakcc-fixed}"
if ! command -v "$TWEAKCC" &>/dev/null; then
  # Fallback to npx if locally installed (monorepo checkout)
  TWEAKCC="npx tweakcc-fixed"
fi

# --- Determine config directory ----------------------------------------------
# Matches what tweakcc reads: prefers TWEAKCC_CONFIG_DIR, falls back to the
# XDG / ~/.tweakcc resolution in src/config.ts.
if [ -n "${TWEAKCC_CONFIG_DIR:-}" ]; then
  CONFIG_DIR="$TWEAKCC_CONFIG_DIR"
elif [ -n "${XDG_CONFIG_HOME:-}" ]; then
  CONFIG_DIR="$XDG_CONFIG_HOME/tweakcc"
else
  CONFIG_DIR="$HOME/.tweakcc"
fi

mkdir -p "$CONFIG_DIR"

# --- Flip the three toggles on in the config ---------------------------------
# Uses Node.js to read-modify-write JSON. This avoids depending on jq and
# handles deep merge + normalization correctly when run via --apply later.
node -e '
const fs = require("fs");
const path = require("path");

const configDir = process.argv[1];
const configFile = path.join(configDir, "config.json");

let cfg = {};
try {
  const raw = fs.readFileSync(configFile, "utf8");
  cfg = JSON.parse(raw);
} catch {
  // No existing config — start fresh with defaults structure.
}

// Ensure settings.misc exists (normalizeConfig will fill in real defaults later).
if (!cfg.settings) cfg.settings = {};
if (!cfg.settings.misc) cfg.settings.misc = {};

const toggles = [
  "enableContextLimitOverride",
  "enableIgnoreWhitespaceEdit",
  "enableThinkingTextTransition"
];

toggles.forEach(t => {
  cfg.settings.misc[t] = true;
});

fs.writeFileSync(configFile, JSON.stringify(cfg, null, 2) + "\n");
console.log("config.json updated — toggles enabled.");
' "$CONFIG_DIR"

# --- Apply patches to Claude Code --------------------------------------------
echo ""
echo "Applying tweakcc-fixed patches to Claude Code..."
echo "(This reads your existing Claude Code installation and applies overrides.)"
echo ""

$TWEAKCC --apply

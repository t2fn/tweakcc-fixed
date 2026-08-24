# Dockerfile.win — Claude Code Native Binary Extraction Testing

This container provides a Linux-based environment for testing tweakcc-fixed against Claude Code's native Windows binaries (ELF/PE/Mach-O formats). It mirrors the pattern from `docker_captvty` but uses Node.js execution instead of Wine.

## Purpose

- Test native binary extraction workflows without needing Windows
- Debug "claude module not found" errors across CC versions
- Verify Bun filesystem module naming patterns (e.g., `/cli`, `/$bunfs/root/cli`)
- Iterate on version-gating logic in `isClaudeModule()`

## Build

```bash
# Default: latest CC version
docker build -f Dockerfile.win -t tweakcc-win .

# Specific CC version for testing
docker build --build-arg CLAUDE_VERSION=2.1.229 -f Dockerfile.win -t tweakcc-win .

# Specific tweakcc commit
docker build --build-arg TWEAKCC_SHA=eb07715 -f Dockerfile.win -t tweakcc-win .
```

## Run (Interactive Shell)

```bash
# Mount CC binaries read-only for testing extraction
docker run -it --rm \
  -v ~/.local/share/claude/versions:/home/claudeuser/.local/share/claude/versions:ro \
  tweakcc-win bash

# Or mount workspace and config directories
docker run -it --rm \
  -v /workspace:/home/claudeuser/workspace \
  -v ~/.tweakcc:/home/claudeuser/.tweakcc \
  -v ~/.local/share/claude/versions:/home/claudeuser/.local/share/claude/versions:ro \
  tweakcc-win bash
```

## Testing Workflows

### 1. Extract JS from a native binary

```bash
# Inside the container
node /home/claudeuser/dev/tweakcc-fixed/dist/index.mjs unpack /tmp/test.js /home/claudeuser/.local/share/claude/versions/2.1.229
```

### 2. Analyze module names in a binary

```bash
# Use the helper script (if node-lief is available)
analyze_modules.sh /home/claudeuser/.local/share/claude/versions/2.1.229 2.1.229

# Or use tweakcc's built-in debug logging
node dist/index.mjs unpack /tmp/test.js /path/to/binary -d
```

### 3. Test extraction with version gating

```bash
# Verify isClaudeModule() recognizes the CLI entrypoint
node -e "
import('/home/claudeuser/dev/tweakcc-fixed/dist/nativeInstallation-B3dQ--mN.mjs').then(m => {
  console.log('Is /cli a Claude module?', m.isClaudeModule('/cli', '2.1.229'));
  console.log('Is cli.js a Claude module?', m.isClaudeModule('cli.js', '2.1.229'));
  console.log('Is /$bunfs/root/cli a Claude module?', m.isClaudeModule('/\$bunfs/root/cli', '2.1.229'));
});
"
```

### 4. Apply patches to a specific CC version

```bash
# Copy binary to workspace, then apply patches
cp /home/claudeuser/.local/share/claude/versions/2.1.229 /workspace/
cd /home/claudeuser/dev/tweakcc-fixed
node dist/index.mjs --apply --patches all 2>&1 | grep -E 'extractClaudeJs|Found claude module|Repacking'
```

## Helper Scripts

### `analyze_modules.sh <binary-path> [version]`

Extracts and displays all Bun module names from a native binary. Useful for:
- Identifying which module name is used for the CLI entrypoint in a given CC version
- Verifying that new patterns are recognized by `isClaudeModule()`
- Debugging extraction failures

**Example:**
```bash
analyze_modules.sh /home/claudeuser/.local/share/claude/versions/2.1.230 2.1.230
# Output:
# Analyzing modules in: /home/claudeuser/.local/share/claude/versions/2.1.230
# CC Version: 2.1.230
# ---
# Binary format: ELF
# File size: 745.8 MB
# Modules list: offset=123456, length=789012
# Entry point ID: 42
# Found 1523 modules:
#   [0] /cli
#   [1] cli.js
#   ...
```

## Debugging Extraction Failures

When `node dist/index.mjs unpack` fails with "claude module not found":

1. **Check if the binary is a native installation:**
   ```bash
   file /path/to/binary
   # Should say: ELF 64-bit LSB executable, or Mach-O, or PE32+ executable
   ```

2. **Verify Bun data exists in the binary:**
   ```bash
   objdump -h /path/to/binary | grep -i bun
   # Should show a .bun section or overlay data
   ```

3. **Use debug logging to see all module names:**
   ```bash
   node dist/index.mjs unpack /tmp/test.js /path/to/binary -d 2>&1 | grep 'Module [0-9]'
   # Shows every module name scanned during extraction
   ```

4. **Test isClaudeModule() directly:**
   ```bash
   node -e "import('./dist/nativeInstallation-B3dQ--mN.mjs').then(m => console.log(m.isClaudeModule('/cli', '2.1.229')))"
   # Should return true if the pattern is recognized for that version
   ```

## Common Issues & Solutions

### Issue: "claude module not found in any of the binary modules"

**Cause:** The CLI entrypoint uses a new Bun filesystem path (e.g., `/cli`, `/$bunfs/root/cli`) that isn't recognized by `isClaudeModule()`.

**Solution:** Update `isClaudeModule()` to recognize the pattern, then add version gating:
```typescript
// In src/nativeInstallation.ts
export function isClaudeModule(moduleName: string, ccVersion?: string): boolean {
  // ... existing patterns ...

  // Bun filesystem paths - only for CC 2.1.229+ (tested and verified)
  if (ccVersion && compareVersions(ccVersion, '2.1.229') >= 0) {
    if (moduleName === '/cli' || moduleName.endsWith('/$bunfs/root/cli')) {
      return true;
    }
  }

  return false;
}
```

### Issue: Version gate doesn't activate for CLI flows

**Cause:** `readContent()` and `writeContent()` in `src/lib/content.ts` don't pass the version to extraction/repack functions.

**Solution:** Thread `installation.version` through:
```typescript
// In src/lib/content.ts
const { data } = await extractClaudeJsFromNativeInstallation(
  installation.path,
  installation.version || undefined  // <-- Add this
);

await repackNativeInstallation(
  installation.path,
  modifiedBuffer,
  installation.path,
  clearBytecode,
  installation.version || undefined  // <-- Add this
);
```

## Testing Against New CC Versions

When a new CC version is released:

1. **Download the native binary:**
   ```bash
   npm install -g @anthropic-ai/claude-code@<new-version>
   # Binary location varies by OS:
   # Linux: ~/.local/share/claude/versions/<version>
   # macOS: ~/Library/Application Support/Claude Code/versions/<version>
   # Windows: %LOCALAPPDATA%\Anthropic\Claude Code\versions\<version>
   ```

2. **Analyze module names:**
   ```bash
   analyze_modules.sh ~/.local/share/claude/versions/<new-version> <new-version>
   ```

3. **Test extraction:**
   ```bash
   node dist/index.mjs unpack /tmp/test.js ~/.local/share/claude/versions/<new-version>
   ```

4. **If extraction fails, check if new patterns need to be added to `isClaudeModule()`.**

## Cleanup

```bash
# Remove container and images
docker rm $(docker ps -a -q) 2>/dev/null
docker rmi tweakcc-win 2>/dev/null

# Clean up downloaded binaries (if mounted into workspace)
rm -rf /workspace/*
```

## License

This Dockerfile is for testing purposes only. Claude Code is proprietary software from Anthropic.

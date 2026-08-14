import fs from 'node:fs/promises';

import {
  CLIJS_BACKUP_FILE,
  ensureConfigDir,
  NATIVE_BINARY_BACKUP_FILE,
  updateConfigFile,
} from './config';
import { clearAllAppliedHashes } from './systemPromptHashIndex';
import { fileLooksPatched } from './patchMarkers';
import {
  debug,
  replaceFileFromSourceBreakingHardLinks,
  doesFileExist,
} from './utils';
import { ClaudeCodeInstallationInfo } from './types';

/**
 * Thrown instead of writing a backup that would not be pristine. The backup is
 * the only route back to an unpatched Claude Code, so overwriting a good one
 * with an already-patched binary is unrecoverable: `--restore` then restores a
 * patched binary forever, the next `--apply` extracts anchors from it and
 * misses, and only reinstalling Claude Code fixes it.
 */
export class NonPristineBackupError extends Error {
  constructor(sourcePath: string) {
    super(
      `Refusing to back up ${sourcePath}: it carries tweakcc markers, so it is ` +
        'already patched. Backing it up would overwrite the only pristine copy ' +
        'with a patched one. Run `tweakcc --restore` first, or reinstall Claude ' +
        'Code, then try again.'
    );
    this.name = 'NonPristineBackupError';
  }
}

/**
 * Guard for every backup write. `ccVersion` is NOT evidence of pristine-ness:
 * it lives in config.json, and a missing or corrupt config.json resolves to the
 * default `ccVersion: ''`, which reads as "the user updated Claude Code" and
 * triggers a re-backup of whatever is installed — including a binary tweakcc
 * itself patched moments earlier. Ask the bytes instead.
 */
const assertPristineSource = async (sourcePath: string): Promise<void> => {
  if (await fileLooksPatched(sourcePath)) {
    throw new NonPristineBackupError(sourcePath);
  }
};

// Copy a file into place atomically: copy to a sibling temp, then rename onto
// the destination. rename(2) is atomic within a filesystem, so a crash mid-copy
// leaves only a temp file — never a truncated backup that would later be trusted
// and restored as if it were pristine (F-72).
const atomicCopyFile = async (src: string, dest: string): Promise<void> => {
  const tmp = `${dest}.tmp-${process.pid}`;
  try {
    await fs.copyFile(src, tmp);
    await fs.rename(tmp, dest);
  } catch (error) {
    try {
      await fs.unlink(tmp);
    } catch {
      // best-effort temp cleanup; ignore
    }
    throw error;
  }
};

export const backupClijs = async (ccInstInfo: ClaudeCodeInstallationInfo) => {
  // Only backup cli.js for NPM installs (when cliPath is set)
  if (!ccInstInfo.cliPath) {
    debug('backupClijs: Skipping for native installation (no cliPath)');
    return;
  }

  await assertPristineSource(ccInstInfo.cliPath);
  await ensureConfigDir();
  debug(`Backing up cli.js to ${CLIJS_BACKUP_FILE}`);
  await atomicCopyFile(ccInstInfo.cliPath, CLIJS_BACKUP_FILE);
  await updateConfigFile(config => {
    config.changesApplied = false;
    config.ccVersion = ccInstInfo.version;
  });
};

/**
 * Backs up the native installation binary to the config directory.
 */
export const backupNativeBinary = async (
  ccInstInfo: ClaudeCodeInstallationInfo
) => {
  if (!ccInstInfo.nativeInstallationPath) {
    return;
  }

  await assertPristineSource(ccInstInfo.nativeInstallationPath);
  await ensureConfigDir();
  debug(`Backing up native binary to ${NATIVE_BINARY_BACKUP_FILE}`);
  await atomicCopyFile(
    ccInstInfo.nativeInstallationPath,
    NATIVE_BINARY_BACKUP_FILE
  );
  await updateConfigFile(config => {
    config.changesApplied = false;
    config.ccVersion = ccInstInfo.version;
  });
};

/**
 * Restores the original cli.js file from the backup.
 * Only applies to NPM installs. For native installs, this is a no-op.
 */
export const restoreClijsFromBackup = async (
  ccInstInfo: ClaudeCodeInstallationInfo
): Promise<boolean> => {
  // Only restore cli.js for NPM installs (when cliPath is set)
  if (!ccInstInfo.cliPath) {
    debug(
      'restoreClijsFromBackup: Skipping for native installation (no cliPath)'
    );
    return false;
  }

  if (!(await doesFileExist(CLIJS_BACKUP_FILE))) {
    debug('restoreClijsFromBackup: No backup file exists, skipping');
    return false;
  }

  debug(`Restoring cli.js from backup to ${ccInstInfo.cliPath}`);

  // Staged sibling + rename, breaking hard links and preserving permissions.
  await replaceFileFromSourceBreakingHardLinks(
    ccInstInfo.cliPath,
    CLIJS_BACKUP_FILE,
    'restore'
  );

  // Clear all applied hashes since we're restoring to defaults
  await clearAllAppliedHashes();

  await updateConfigFile(config => {
    config.changesApplied = false;
  });

  return true;
};

/**
 * Restores the native installation binary from backup.
 * This function restores the original native binary and clears changesApplied,
 * so patches can be re-applied from a clean state.
 */
export const restoreNativeBinaryFromBackup = async (
  ccInstInfo: ClaudeCodeInstallationInfo
): Promise<boolean> => {
  if (!ccInstInfo.nativeInstallationPath) {
    debug(
      'restoreNativeBinaryFromBackup: No native installation path, skipping'
    );
    return false;
  }

  if (!(await doesFileExist(NATIVE_BINARY_BACKUP_FILE))) {
    debug('restoreNativeBinaryFromBackup: No backup file exists, skipping');
    return false;
  }

  debug(
    `Restoring native binary from backup to ${ccInstInfo.nativeInstallationPath}`
  );

  // Staged sibling + rename, breaking hard links and preserving permissions.
  // Never buffered: the native binary is 300-750 MB.
  await replaceFileFromSourceBreakingHardLinks(
    ccInstInfo.nativeInstallationPath,
    NATIVE_BINARY_BACKUP_FILE,
    'restore'
  );

  // The binary is back to vanilla, so no prompt override is applied any more.
  // Without this the hash index keeps claiming every override is live against a
  // pristine binary: no "unapplied changes" banner, and the user believes their
  // prompts are in effect when they are not. The cli.js sibling has always done
  // this; the native path silently did not.
  await clearAllAppliedHashes();

  await updateConfigFile(config => {
    config.changesApplied = false;
  });

  return true;
};

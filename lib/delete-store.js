/**
 * Filesystem-only session cleanup, kept free of Harness imports so it can be
 * exercised directly. `index.js` maps {@link SessionStorageError} to a Remote
 * failure and supplies the account home.
 */
import { lstat, readdir, rm, rmdir } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join } from 'node:path'

/** Current and retained JSONL generation names, plus the advisory writer lock. */
export const SESSION_FILE = /^session(?:\.[a-z0-9-]+)?\.jsonl(?:\.zstd)?$/i
/** Session ids used as a file name; anything else skips the projection-cache cleanup. */
const SAFE_SESSION_ID = /^[A-Za-z0-9._-]{1,200}$/

/** A storage location this bundle refuses to touch. */
export class SessionStorageError extends Error {
  /**
   * @param message - diagnostic naming the refused path or artifact.
   */
  constructor(message) {
    super(message)
    this.name = 'SessionStorageError'
  }
}

/**
 * Remove one session's JSONL artifacts, leaving unrelated files in place.
 *
 * The directory comes from the persistence backend's selected location, so the
 * only paths removed are the log generations and the writer lock. Unknown files
 * stay, and a non-empty directory after cleanup is left as-is; the log is gone
 * and the session no longer lists.
 * @param location - absolute path of the selected session log.
 * @returns when every recognized artifact is removed.
 */
export async function removeSessionArtifacts(location) {
  if (typeof location !== 'string' || !isAbsolute(location)) {
    throw new SessionStorageError(`refusing a non-absolute session location: ${String(location)}`)
  }
  const dir = dirname(location)
  const file = basename(location)
  if (!SESSION_FILE.test(file)) {
    throw new SessionStorageError(`refusing an unrecognized session artifact name: ${file}`)
  }
  const info = await lstat(dir)
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new SessionStorageError(`refusing a session directory that is a link or not a directory: ${dir}`)
  }
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (entry.name !== 'session.lock' && !SESSION_FILE.test(entry.name)) continue
    await rm(join(dir, entry.name), { force: true })
  }
  try {
    await rmdir(dir)
  } catch {
    // Unknown files or a concurrent recreation keep the directory; the log is gone.
  }
}

/**
 * Drop the session's durable projection checkpoint and any invalid-record backup.
 * @param home - DeepSeek Harness account home.
 * @param sessionId - session whose cache records are removed.
 * @returns when matching cache files are gone or the cache directory is absent.
 */
export async function removeProjectionCache(home, sessionId) {
  if (typeof home !== 'string' || !isAbsolute(home)) return
  if (!SAFE_SESSION_ID.test(sessionId)) return
  const cacheDir = join(home, 'storages', 'session_projcache', 'sessions')
  let entries
  try {
    entries = await readdir(cacheDir)
  } catch {
    return
  }
  for (const name of entries) {
    if (name !== `${sessionId}.json` && !name.startsWith(`${sessionId}.json.bak.`)) continue
    await rm(join(cacheDir, name), { force: true })
  }
}

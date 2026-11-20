/**
 * Storage-level support for moving one JSONL session to another project.
 *
 * Moving changes the SessionHeader's immutable `cwd`, so this module rewrites
 * only the first JSONL line of each generation and leaves every event row byte
 * for byte. It is deliberately independent of Harness imports; the Host route
 * supplies validated paths and the account home.
 */
import { randomBytes } from 'node:crypto'
import { constants, zstdCompress, zstdDecompress } from 'node:zlib'
import { lstat, mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { promisify } from 'node:util'

const zstdCompressAsync = promisify(zstdCompress)
const zstdDecompressAsync = promisify(zstdDecompress)
const CHECKSUM_OPTIONS = { params: { [constants.ZSTD_c_checksumFlag]: 1 } }
const ZSTD_MAGIC = 0xFD2FB528
const SESSION_FILE = /^session(?:\.[a-z0-9-]+)?\.jsonl(?:\.zstd)?$/i

/** A refused or failed store-level move. */
export class SessionMoveError extends Error {
  /**
   * @param code - stable `session-tools/*` code.
   * @param message - diagnostic naming the refused path or operation.
   */
  constructor(code, message) {
    super(message)
    this.name = 'SessionMoveError'
    this.code = code
  }
}

/**
 * Build the readable directory key for a project path, matching the JSONL
 * backend's layout. Separators become one `-`; unsafe units use `~XXXX`.
 * @param cwd - the session's project directory.
 * @returns a single filesystem-safe project directory name.
 */
export function projectKey(cwd) {
  if (typeof cwd !== 'string' || cwd.length === 0) throw new Error('cannot encode an empty project path')
  let readable = ''
  let separatorRun = false
  for (let i = 0; i < cwd.length; i++) {
    const code = cwd.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch
      separatorRun = false
    } else {
      readable += '~' + code.toString(16).toUpperCase().padStart(4, '0')
      separatorRun = false
    }
  }
  const slug = readable.replace(/^-+/, '') || 'root'
  return `--${slug.slice(0, 251)}--`
}

/** Byte range of one structurally complete Zstandard frame. */
export function scanZstdFrames(buffer) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) throw new SessionMoveError('session-tools/unsupported-format', 'session log ends inside a Zstandard frame header')
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) throw new SessionMoveError('session-tools/unsupported-format', `session log has invalid Zstandard frame magic at byte ${offset}`)
    offset += 4
    if (offset === buffer.length) throw new SessionMoveError('session-tools/unsupported-format', 'session log ends inside a Zstandard frame header')
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 0x18) !== 0) throw new SessionMoveError('session-tools/unsupported-format', 'session log has a reserved Zstandard frame-header bit')
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 0x20) !== 0
    const checksum = (descriptor & 0x04) !== 0
    const dictionaryFlag = descriptor & 0x03
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeaderBytes) throw new SessionMoveError('session-tools/unsupported-format', 'session log ends inside a Zstandard frame header')
    offset += remainingHeaderBytes
    for (;;) {
      if (buffer.length - offset < 3) throw new SessionMoveError('session-tools/unsupported-format', 'session log ends inside a Zstandard block header')
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 0x03
      const blockSize = blockHeader >>> 3
      if (blockType === 0x03) throw new SessionMoveError('session-tools/unsupported-format', 'session log has a reserved Zstandard block type')
      const payloadBytes = blockType === 0x01 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) throw new SessionMoveError('session-tools/unsupported-format', 'session log ends inside a Zstandard block')
      offset += payloadBytes
      if (lastBlock) break
    }
    if (checksum) {
      if (buffer.length - offset < 4) throw new SessionMoveError('session-tools/unsupported-format', 'session log ends inside a Zstandard checksum')
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return frames
}

/**
 * Atomically replace one file with already encoded bytes.
 * @param filePath - destination file.
 * @param content - complete replacement bytes.
 */
async function replaceFile(filePath, content) {
  const tmp = `${filePath}.${randomBytes(6).toString('hex')}.tmp`
  const handle = await open(tmp, 'wx', 0o600)
  try {
    await handle.writeFile(content)
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await rename(tmp, filePath)
  } catch (error) {
    if (process.platform !== 'win32') {
      await rm(tmp, { force: true })
      throw error
    }
    await rm(filePath, { force: true })
    await rename(tmp, filePath)
  }
}

/**
 * Rewrite the first JSONL line's `cwd` in one generation file.
 * @param filePath - absolute generation path.
 * @param targetCwd - new absolute project directory.
 * @param expectedId - Session id the header must name.
 * @returns the rewritten header object.
 */
async function rewriteHeaderFile(filePath, targetCwd, expectedId) {
  const bytes = await readFile(filePath)
  const compressed = filePath.toLowerCase().endsWith('.zstd')
  let plain
  let tail
  if (compressed) {
    const frames = scanZstdFrames(bytes)
    if (frames.length === 0) throw new SessionMoveError('session-tools/unsupported-format', `session log has no Zstandard frames: ${filePath}`)
    plain = (await zstdDecompressAsync(bytes.subarray(frames[0].start, frames[0].end))).toString('utf8')
    tail = bytes.subarray(frames[0].end)
  } else {
    plain = bytes.toString('utf8')
    tail = null
  }
  const newline = plain.indexOf('\n')
  if (newline < 0) throw new SessionMoveError('session-tools/unsupported-format', `session log has no complete header line: ${filePath}`)
  const first = plain.slice(0, newline)
  let header
  try {
    header = JSON.parse(first)
  } catch {
    throw new SessionMoveError('session-tools/unsupported-format', `session header is not valid JSON: ${filePath}`)
  }
  if (header === null || typeof header !== 'object' || header.type !== 'session'
    || typeof header.id !== 'string' || header.id !== expectedId) {
    throw new SessionMoveError('session-tools/unsupported-format', `session header does not identify "${expectedId}": ${filePath}`)
  }
  const remainder = plain.slice(newline + 1)
  header.cwd = targetCwd
  const headerLine = `${JSON.stringify(header)}\n`
  let content
  if (compressed) {
    const headerFrame = await zstdCompressAsync(Buffer.from(headerLine), CHECKSUM_OPTIONS)
    const contentFrame = remainder.length === 0
      ? Buffer.alloc(0)
      : await zstdCompressAsync(Buffer.from(remainder), CHECKSUM_OPTIONS)
    content = Buffer.concat([headerFrame, contentFrame, tail])
  } else {
    content = Buffer.from(headerLine + remainder, 'utf8')
  }
  await replaceFile(filePath, content)
  return header
}

/**
 * Rewrite the selected generation strictly, then other generations best-effort.
 * @param sessionDir - session-owned directory.
 * @param selectedFile - generation the persistence backend selected.
 * @param targetCwd - new absolute project directory.
 * @param expectedId - Session id every header must name.
 * @returns rewritten and skipped generation paths.
 */
export async function rewriteSessionHeaders(sessionDir, selectedFile, targetCwd, expectedId) {
  const info = await lstat(sessionDir)
  if (info.isSymbolicLink() || !info.isDirectory()) throw new SessionMoveError('session-tools/unsafe-storage', `session directory is a link or not a directory: ${sessionDir}`)
  const entries = await readdir(sessionDir, { withFileTypes: true })
  const files = entries
    .filter(entry => entry.isFile() && SESSION_FILE.test(entry.name))
    .map(entry => join(sessionDir, entry.name))
  const selected = files.find(file => resolve(file) === resolve(selectedFile))
  if (selected === undefined) throw new SessionMoveError('session-tools/unsafe-storage', `selected session log is missing from ${sessionDir}`)
  const header = await rewriteHeaderFile(selected, targetCwd, expectedId)
  const rewritten = [selected]
  const skipped = []
  for (const file of files) {
    if (file === selected) continue
    try {
      await rewriteHeaderFile(file, targetCwd, expectedId)
      rewritten.push(file)
    } catch (error) {
      skipped.push({ file, error })
    }
  }
  return { header, rewritten, skipped }
}

/**
 * Derive the JSONL session root from one selected generation path.
 * @param locationPath - `<root>/<project>/<session>/<file>`.
 * @returns the configured sessions root.
 */
export function sessionRootOf(locationPath) {
  if (typeof locationPath !== 'string' || !isAbsolute(locationPath)) throw new SessionMoveError('session-tools/unsafe-storage', 'session location is not absolute')
  return dirname(dirname(dirname(locationPath)))
}

/**
 * Move one session directory under the target project directory.
 * @param sessionDir - current session-owned directory.
 * @param targetProjectDir - destination project directory.
 * @returns the new session directory.
 */
export async function moveSessionDirectory(sessionDir, targetProjectDir) {
  const target = join(targetProjectDir, basename(sessionDir))
  try {
    await lstat(target)
    throw new SessionMoveError('session-tools/target-exists', `target session directory already exists: ${target}`)
  } catch (error) {
    if (!(error instanceof Error) || error.code !== 'ENOENT') throw error
  }
  await mkdir(targetProjectDir, { recursive: true, mode: 0o700 })
  try {
    await rename(sessionDir, target)
  } catch (error) {
    throw new SessionMoveError('session-tools/move-failed', `could not move the session directory: ${String(error)}`)
  }
  return target
}

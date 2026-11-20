/**
 * Host half of the session-delete bundle.
 *
 * The plugin registers authenticated exact Fetch routes and serves two
 * operations: permanent deletion and moving a session to another project.
 * Moving changes the SessionHeader's immutable `cwd`, moves the JSONL directory,
 * and updates workspace membership; it refuses live sessions and sessions with
 * subagent children. Deletion likewise refuses live sessions.
 *
 * This bundle is installed by path and imports no Harness package. The routes
 * join the Host's existing `/api` bridge, which owns browser authentication and
 * Host/Origin checks; only owner peers reach exact routes.
 */
import { lstat, rename } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { removeProjectionCache, removeSessionArtifacts, SessionStorageError } from './lib/delete-store.js'
import {
  moveSessionDirectory,
  projectKey,
  rewriteSessionHeaders,
  sessionRootOf,
  SessionMoveError,
} from './lib/move-store.js'

/** Exact delete route under the Host `/api` bridge; unique to this plugin. */
export const DELETE_ROUTE = '/api/dsh-session-delete-local/delete'
/** Exact move route under the Host `/api` bridge; unique to this plugin. */
export const MOVE_ROUTE = '/api/dsh-session-delete-local/move'
/** Read-only liveness route used to disable actions that would be refused. */
export const STATE_ROUTE = '/api/dsh-session-delete-local/state'

/** Plugin identity reported by the Loader. */
export const name = 'session-delete'

/** The Host connection service registers the exact Fetch routes. */
export const inject = ['connection']

/** A business failure encoded into a route's JSON envelope. */
class SessionToolError extends Error {
  /**
   * @param code - stable `session-tools/*` failure code.
   * @param status - HTTP status returned with the envelope.
   * @param message - human diagnostic.
   * @param details - structured payload for the client.
   * @param options - standard Error options; `cause` is kept in-process only.
   */
  constructor(code, status, message, details = {}, options) {
    super(message, options)
    this.name = 'SessionToolError'
    this.code = code
    this.status = status
    this.details = details
  }
}

/**
 * Resolve the DeepSeek Harness account home the same way the rest of the Host
 * does: configured `DSH_HOME`, then `~/.dsh`.
 * @returns absolute account home.
 */
function harnessHome() {
  const configured = process.env.DSH_HOME
  if (typeof configured === 'string' && configured.trim() !== '') return configured
  return join(homedir(), '.dsh')
}

/**
 * Validate a cold session and briefly claim its writer.
 * @param ctx - Host context.
 * @param sessionId - candidate session.
 * @returns the persistence service, snapshot, and selected JSONL location.
 */
async function loadColdSession(ctx, sessionId) {
  if (typeof sessionId !== 'string' || sessionId.trim() === '') {
    throw new SessionToolError('gateway/bad-request', 400, 'a non-empty sessionId is required', {})
  }
  const agent = ctx.get('agents')?.get(sessionId)
  if (agent?.status === 'running') {
    throw new SessionToolError(
      'session-tools/session-running',
      409,
      `session "${sessionId}" is running; stop the turn and restart DeepSeek Harness before changing it`,
      { sessionId, live: 'running' },
    )
  }
  if (ctx.get('sessions')?.get(sessionId) !== undefined || agent !== undefined) {
    throw new SessionToolError(
      'session-tools/session-live',
      409,
      `session "${sessionId}" is still open in this DeepSeek Harness process; restart DeepSeek Harness before changing it`,
      { sessionId, live: 'attached' },
    )
  }
  const persistence = ctx.get('sessionPersistence')
  if (persistence === undefined) {
    throw new SessionToolError('session-tools/unavailable', 503, 'session persistence is not mounted', { sessionId })
  }
  let snapshot
  try {
    snapshot = await persistence.stat(sessionId)
  } catch (cause) {
    throw new SessionToolError('session-tools/not-found', 404, `session "${sessionId}" is not stored locally`, { sessionId }, { cause })
  }
  if (snapshot.header?.origin === 'subagent') {
    throw new SessionToolError(
      'session-tools/subagent',
      409,
      `session "${sessionId}" is an internal subagent conversation and cannot be changed on its own`,
      { sessionId },
    )
  }
  const location = snapshot.location
  if (location?.kind !== 'jsonl' || typeof location.path !== 'string') {
    throw new SessionToolError('session-tools/no-log', 409, `session "${sessionId}" has no materialized JSONL log`, { sessionId })
  }
  let handle
  try {
    handle = await persistence.open(sessionId, 'write')
  } catch (cause) {
    throw new SessionToolError('session-tools/busy', 409, `session "${sessionId}" is still held by another writer`, { sessionId }, { cause })
  }
  try {
    await handle.close()
  } catch (cause) {
    throw new SessionToolError('session-tools/busy', 409, `session "${sessionId}" could not release its writer lock`, { sessionId }, { cause })
  }
  return { persistence, snapshot, location }
}

/**
 * Drop membership from the named workspaces.
 * @param ctx - Host context carrying the optional workspace registry.
 * @param sessionId - session leaving those workspaces.
 * @param workspaceIds - workspaces that accounted the session before the move.
 */
async function detachSessionFromWorkspaces(ctx, sessionId, workspaceIds) {
  const registry = ctx.get('workspaceRegistry')
  if (registry === undefined) return
  for (const workspaceId of workspaceIds) {
    const workspace = registry.get(workspaceId)
    if (workspace === undefined) continue
    try {
      await workspace.detachSession(sessionId)
    } catch (error) {
      ctx.logger.warn(`session-delete: detaching "${sessionId}" from workspace "${workspaceId}" failed: ${String(error)}`)
    }
  }
}

/**
 * Whether the workspace registry exposes the header/path caches this bundle
 * must refresh after rewriting a session header. The fields are implementation
 * details of the shipped registry; a host that hides them is refused before any
 * file changes, rather than leaving a moved session ungrouped.
 * @param registry - mounted workspace registry.
 * @returns whether the cache maps are accessible.
 */
function canRefreshWorkspaceCache(registry) {
  return registry.headers instanceof Map
    && registry.sessionPaths instanceof Map
    && registry.missingSessionPaths instanceof Set
    && registry.invalidSessionPaths instanceof Map
}

/**
 * Replace the registry's cached header identity after a header rewrite.
 * Evicting the header makes the next attach validation read persistence again,
 * which also re-indexes the canonical session path.
 * @param registry - mounted workspace registry.
 * @param sessionId - moved session.
 * @param targetPath - new canonical project path.
 */
function refreshWorkspaceCache(registry, sessionId, targetPath) {
  registry.headers.delete(sessionId)
  registry.sessionPaths.set(sessionId, targetPath)
  registry.missingSessionPaths.delete(sessionId)
  registry.invalidSessionPaths.delete(sessionId)
}

/**
 * Delete flow: clear workspace references, remove artifacts, drop caches.
 * @param ctx - Host context.
 * @param request - parsed `{ sessionId }` body.
 * @returns `{ sessionId, removed: true }`.
 */
async function deleteSession(ctx, request) {
  const sessionId = request?.sessionId
  const { location } = await loadColdSession(ctx, sessionId)
  const registry = ctx.get('workspaceRegistry')
  if (registry !== undefined) {
    for (const method of ['unarchiveSession', 'unpinSession']) {
      try {
        await registry[method](sessionId)
      } catch (error) {
        ctx.logger.warn(`session-delete: ${method} failed for "${sessionId}": ${String(error)}`)
      }
    }
    const workspaceIds = registry.list()
      .filter(workspace => workspace.sessionIds.includes(sessionId))
      .map(workspace => workspace.id)
    await detachSessionFromWorkspaces(ctx, sessionId, workspaceIds)
  }
  try {
    await removeSessionArtifacts(location.path)
  } catch (error) {
    if (error instanceof SessionStorageError) {
      throw new SessionToolError('session-tools/unsafe-storage', 409, error.message, { sessionId })
    }
    throw error
  }
  try {
    await removeProjectionCache(harnessHome(), sessionId)
  } catch (error) {
    // The log is authoritative; a stale checkpoint is harmless and self-heals.
    ctx.logger.warn(`session-delete: projection cache cleanup failed for "${sessionId}": ${String(error)}`)
  }
  ctx.emit('api-session/removed', sessionId)
  return { sessionId, removed: true }
}

/**
 * Map a store-level move failure into the route's error shape.
 * @param error - caught error.
 * @param sessionId - session being moved.
 * @returns a route error with a stable code.
 */
function moveFailure(error, sessionId) {
  if (error instanceof SessionMoveError) {
    const status = error.code === 'session-tools/move-failed' ? 500 : 409
    return new SessionToolError(error.code, status, error.message, { sessionId })
  }
  return new SessionToolError(
    'session-tools/internal',
    500,
    error instanceof Error ? error.message : String(error),
    { sessionId },
  )
}

/**
 * Read whether a session is attached or running so the client can disable the
 * actions that would be refused. Does not read or change storage.
 * @param ctx - Host context.
 * @param request - parsed `{ sessionId }` body.
 * @returns `{ sessionId, live, running }`.
 */
async function stateSession(ctx, request) {
  const sessionId = request?.sessionId
  if (typeof sessionId !== 'string' || sessionId.trim() === '') {
    throw new SessionToolError('gateway/bad-request', 400, 'a non-empty sessionId is required', {})
  }
  const agent = ctx.get('agents')?.get(sessionId)
  const session = ctx.get('sessions')?.get(sessionId)
  return {
    sessionId,
    live: session !== undefined || agent !== undefined,
    running: agent?.status === 'running',
  }
}

/**
 * Move flow: rewrite the header cwd, move the directory, and transfer membership.
 * @param ctx - Host context.
 * @param request - parsed `{ sessionId, workspaceId }` body.
 * @returns `{ sessionId, workspaceId, cwd, moved }`.
 */
async function moveSession(ctx, request) {
  const sessionId = request?.sessionId
  const workspaceId = request?.workspaceId
  if (typeof workspaceId !== 'string' || workspaceId.trim() === '') {
    throw new SessionToolError('gateway/bad-request', 400, 'a non-empty workspaceId is required', {})
  }
  const { persistence, snapshot, location } = await loadColdSession(ctx, sessionId)
  const registry = ctx.get('workspaceRegistry')
  if (registry === undefined) {
    throw new SessionToolError('session-tools/unavailable', 503, 'the workspace registry is not mounted', { sessionId })
  }
  if (!canRefreshWorkspaceCache(registry)) {
    throw new SessionToolError(
      'session-tools/unsupported-host',
      500,
      'this DeepSeek Harness build does not expose the workspace session cache needed for a safe move',
      { sessionId, workspaceId },
    )
  }
  const target = registry.get(workspaceId)
  if (target === undefined) {
    throw new SessionToolError('session-tools/workspace-not-found', 404, `workspace "${workspaceId}" was not found`, { sessionId, workspaceId })
  }
  const targetPath = target.path
  if (!isAbsolute(targetPath)) {
    throw new SessionToolError('session-tools/unsafe-storage', 409, 'the target workspace path is not absolute', { sessionId, workspaceId })
  }
  const targetInfo = await lstat(targetPath).catch(() => undefined)
  if (targetInfo === undefined || !targetInfo.isDirectory()) {
    throw new SessionToolError('session-tools/workspace-missing', 404, `the target project directory does not exist: ${targetPath}`, { sessionId, workspaceId })
  }
  const currentCwd = snapshot.header?.cwd
  if (currentCwd === targetPath) {
    if (!target.sessionIds.includes(sessionId)) {
      try {
        refreshWorkspaceCache(registry, sessionId, targetPath)
      } catch (cause) {
        throw new SessionToolError('session-tools/unsupported-host', 500, 'could not refresh the workspace session cache', { sessionId, workspaceId }, { cause })
      }
      try {
        await target.attachSession(sessionId)
      } catch (cause) {
        throw new SessionToolError('session-tools/attach-failed', 500, `could not attach the session to "${targetPath}": ${String(cause)}`, { sessionId, workspaceId, cwd: targetPath }, { cause })
      }
    }
    return { sessionId, workspaceId, cwd: targetPath, moved: false }
  }
  let all
  try {
    all = await persistence.list()
  } catch (cause) {
    throw new SessionToolError('session-tools/internal', 500, 'could not inspect stored sessions', { sessionId }, { cause })
  }
  const childCount = all.filter(stored => stored.header?.origin === 'subagent'
    && stored.header?.parentSession === sessionId).length
  if (childCount > 0) {
    throw new SessionToolError(
      'session-tools/children',
      409,
      `session "${sessionId}" has ${String(childCount)} subagent child session(s); move or remove them first`,
      { sessionId, count: childCount },
    )
  }
  const oldWorkspaceIds = registry.list()
    .filter(workspace => workspace.sessionIds.includes(sessionId))
    .map(workspace => workspace.id)
  const sessionDir = dirname(location.path)
  const root = sessionRootOf(location.path)
  const targetProjectDir = join(root, projectKey(targetPath))
  const sameProjectDir = resolve(targetProjectDir) === resolve(dirname(sessionDir))
  let activeDir = sessionDir
  let moved = false
  if (!sameProjectDir) {
    try {
      activeDir = await moveSessionDirectory(sessionDir, targetProjectDir)
      moved = true
    } catch (error) {
      throw moveFailure(error, sessionId)
    }
  }
  const activeSelected = join(activeDir, basename(location.path))
  try {
    await rewriteSessionHeaders(activeDir, activeSelected, targetPath, sessionId)
  } catch (error) {
    if (moved) {
      try {
        await rename(activeDir, sessionDir)
      } catch (rollbackError) {
        ctx.logger.warn(`session-delete: rolling back move of "${sessionId}" failed: ${String(rollbackError)}`)
      }
    }
    throw moveFailure(error, sessionId)
  }
  try {
    refreshWorkspaceCache(registry, sessionId, targetPath)
  } catch (cause) {
    throw new SessionToolError(
      'session-tools/attach-failed',
      500,
      `the session moved to "${targetPath}" but the workspace cache could not be refreshed; retry the move to finish membership`,
      { sessionId, workspaceId, cwd: targetPath },
      { cause },
    )
  }
  await detachSessionFromWorkspaces(ctx, sessionId, oldWorkspaceIds)
  try {
    await target.attachSession(sessionId)
  } catch (cause) {
    throw new SessionToolError(
      'session-tools/attach-failed',
      500,
      `the session moved to "${targetPath}" but could not join its workspace; retry the move to finish membership`,
      { sessionId, workspaceId, cwd: targetPath },
      { cause },
    )
  }
  try {
    await removeProjectionCache(harnessHome(), sessionId)
  } catch (error) {
    ctx.logger.warn(`session-delete: projection cache cleanup failed for "${sessionId}": ${String(error)}`)
  }
  return { sessionId, workspaceId, cwd: targetPath, moved: true }
}

/**
 * @param status - HTTP status.
 * @param payload - JSON envelope.
 * @returns a no-store JSON response.
 */
function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, no-store',
    },
  })
}

/**
 * Run one route operation and normalize every failure into the JSON envelope.
 * @param operation - operation bound to the Host context.
 * @param ctx - Host context.
 * @param request - Fetch request.
 * @returns the response.
 */
async function handleRequest(operation, ctx, request) {
  let body
  try {
    body = await request.json()
  } catch {
    return jsonResponse(400, { ok: false, error: { code: 'gateway/bad-request', message: 'invalid JSON body' } })
  }
  try {
    return jsonResponse(200, { ok: true, value: await operation(ctx, body) })
  } catch (error) {
    const code = typeof error?.code === 'string' ? error.code : 'session-tools/internal'
    const status = typeof error?.status === 'number' ? error.status : 500
    return jsonResponse(status, {
      ok: false,
      error: {
        code,
        message: error instanceof Error ? error.message : String(error),
        details: error?.details ?? {},
      },
    })
  }
}

const ROUTES = [
  { path: DELETE_ROUTE, operation: deleteSession },
  { path: MOVE_ROUTE, operation: moveSession },
  { path: STATE_ROUTE, operation: stateSession },
]

/**
 * Register the exact Fetch routes.
 * @param ctx - Host context carrying the connection service.
 */
export function apply(ctx) {
  const connection = ctx.get('connection')
  const fetchService = connection?.fetch
  if (fetchService === undefined || typeof fetchService.register !== 'function') {
    throw new Error('session-delete: connection.fetch.register is unavailable')
  }
  for (const route of ROUTES) {
    ctx.effect(() => fetchService.register({
      path: route.path,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: request => handleRequest(route.operation, ctx, request),
    }), `session-delete: ${route.path} exact fetch route`)
  }
}

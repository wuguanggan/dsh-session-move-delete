/**
 * Browser half of the session-delete bundle.
 *
 * It contributes one session context-menu action and one `shell.overlay`
 * dialog, then calls the Host's authenticated exact Fetch route. The route is
 * owner-only; the access source below keeps the action hidden from a non-owner
 * peer whose grant does not name it.
 */
window.__ModuleLoader__.load({
  id: 'dsh-session-move-delete',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NS = 'sessionDelete'
    const DELETE_ROUTE = '/api/dsh-session-delete-local/delete'
    const MOVE_ROUTE = '/api/dsh-session-delete-local/move'
    const STATE_ROUTE = '/api/dsh-session-delete-local/state'
    /** Never a wire endpoint; the access source only answers whether this Peer may act. */
    const ACCESS_ACTION = 'session-delete/delete'

    const zh = {
      'menu.delete': '删除会话',
      'menu.move': '移动到项目',
      'dialog.title': '删除会话',
      'dialog.desc': '将永久删除“{title}”的本地会话记录。此操作无法恢复，项目文件夹和其他会话不会受影响。',
      'dialog.note': '如果该会话仍在 DSH 中打开（即使没有运行中的回合），删除会失败。请重启 DeepSeek Harness 后再试。',
      'dialog.also': '指向该会话的定时任务和子会话不会被一并删除。',
      'dialog.cancel': '取消',
      'dialog.confirm': '永久删除',
      'dialog.deleting': '正在删除…',
      'dialog.move.title': '移动到项目',
      'dialog.move.desc': '将“{title}”移动到“{workspace}”？会话的工作目录将改为“{path}”，之后继续对话时工具会在新目录中运行。历史记录保持不变。',
      'dialog.move.note': '如果该会话仍在 DSH 中打开（即使没有运行中的回合），移动会失败。请重启 DeepSeek Harness 后再试。',
      'dialog.move.also': '包含子智能体会话的会话暂不支持移动；不会复制任何项目文件。',
      'dialog.move.confirm': '移动',
      'dialog.move.status': '正在移动…',
      'dialog.live': '该会话正在运行。请等待或停止当前回合，重启 DeepSeek Harness 后再试。',
      'dialog.attached': '该会话仍在当前 DeepSeek Harness 进程中打开（即使没有运行中的回合）。DSH 不能单独释放它，请重启 DeepSeek Harness 后再试。',
      'menu.attached': '会话已打开，需重启 DSH 后可操作',
      'menu.running': '会话正在运行，停止并重启 DSH',
      'dialog.notFound': '该会话记录已不存在。',
      'dialog.busy': '该会话仍被另一个进程占用。请关闭占用它的进程后重试。',
      'dialog.subagent': '子智能体会话不能单独操作。',
      'dialog.noLog': '该会话没有可操作的本地日志。',
      'dialog.unsafe': '会话存储目录包含无法识别的文件，已停止操作。',
      'dialog.failed': '操作失败：{message}',
      'move.children': '该会话包含子智能体会话，暂不支持移动。',
      'move.workspaceMissing': '目标项目不存在或目录已丢失。',
      'move.targetExists': '目标项目中已存在同名会话目录，已停止移动。',
      'move.unsupported': '该会话的存储格式暂不支持安全移动。',
      'move.unsupportedHost': '当前 DSH 版本未暴露安全移动所需的内部缓存。',
      'move.attachFailed': '会话已移动，但未能加入目标项目；请重试移动以完成归属。',
      'toast.deleted': '会话已删除',
      'toast.moved': '已移动到“{title}”',
      'toast.failed': '无法完成操作',
      'workspace.default': '默认工作区',
    }

    const en = {
      'menu.delete': 'Delete session',
      'menu.move': 'Move to project',
      'dialog.title': 'Delete session',
      'dialog.desc': 'Permanently delete the local conversation record for “{title}”. This cannot be undone. The project folder and other sessions are not affected.',
      'dialog.note': 'If the session is still open in DSH (even with no running turn), deletion will fail. Restart DeepSeek Harness and try again.',
      'dialog.also': 'Scheduled tasks and child sessions that point to this session are not deleted.',
      'dialog.cancel': 'Cancel',
      'dialog.confirm': 'Delete permanently',
      'dialog.deleting': 'Deleting…',
      'dialog.move.title': 'Move to project',
      'dialog.move.desc': 'Move “{title}” to “{workspace}”? The session’s working directory will change to “{path}”, and later turns will run tools there. History is unchanged.',
      'dialog.move.note': 'If the session is still open in DSH (even with no running turn), the move will fail. Restart DeepSeek Harness and try again.',
      'dialog.move.also': 'Sessions with subagent children cannot be moved; no project files are copied.',
      'dialog.move.confirm': 'Move',
      'dialog.move.status': 'Moving…',
      'dialog.live': 'This session is running. Wait for or stop the current turn, restart DeepSeek Harness, then try again.',
      'dialog.attached': 'This session is still open in the current DeepSeek Harness process (even with no running turn). DSH cannot release it individually; restart DeepSeek Harness and try again.',
      'menu.attached': 'Session is open; restart DSH to act on it',
      'menu.running': 'Session is running; stop it and restart DSH',
      'dialog.notFound': 'This session no longer exists.',
      'dialog.busy': 'This session is still in use by another process. Close that process and try again.',
      'dialog.subagent': 'A subagent conversation cannot be changed on its own.',
      'dialog.noLog': 'This session has no local log that can be changed.',
      'dialog.unsafe': 'The session storage folder contains unexpected files, so the operation was stopped.',
      'dialog.failed': 'Operation failed: {message}',
      'move.children': 'This session has subagent children, so it cannot be moved yet.',
      'move.workspaceMissing': 'The target project does not exist or its directory is missing.',
      'move.targetExists': 'The target project already contains a session directory with this id.',
      'move.unsupported': 'This session’s storage format cannot be moved safely.',
      'move.unsupportedHost': 'This DeepSeek Harness build does not expose the workspace cache needed for a safe move.',
      'move.attachFailed': 'The session moved, but could not join the target project; retry the move to finish membership.',
      'toast.deleted': 'Session deleted',
      'toast.moved': 'Moved to “{title}”',
      'toast.failed': 'Could not complete the operation',
      'workspace.default': 'Default workspace',
    }

    const CSS = `
.dsh-session-delete-overlay {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--dsw-alias-bg-mask-1, rgba(0, 0, 0, 0.32));
  backdrop-filter: var(--dsw-mask-blur, blur(2px));
}
.dsh-session-delete-dialog {
  box-sizing: border-box;
  width: min(440px, 100%);
  max-height: min(100dvh - 48px, 640px);
  overflow: auto;
  padding: 24px;
  border-radius: var(--dsw-radius-panel, 16px);
  background: var(--dsw-alias-bg-layer-2, #fff);
  box-shadow: var(--dsw-elevation-prominent, 0 12px 32px rgba(0, 0, 0, 0.18));
  color: var(--dsw-alias-label-primary, #0f1115);
  font-size: 14px;
  line-height: 22px;
  outline: none;
}
.dsh-session-delete-title {
  margin: 0 0 8px;
  font-size: 16px;
  line-height: 24px;
  font-weight: 500;
}
.dsh-session-delete-desc {
  margin: 0;
  color: var(--dsw-alias-label-secondary, #4b5563);
  overflow-wrap: anywhere;
}
.dsh-session-delete-warning {
  margin: 14px 0 0;
  padding: 8px 10px;
  border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-alias-state-warn-tertiary, rgba(245, 158, 11, 0.12));
  color: var(--dsw-alias-state-warn-primary, #b45309);
  font-size: 12px;
  line-height: 18px;
}
.dsh-session-delete-error {
  margin: 12px 0 0;
  color: var(--dsw-alias-state-error-primary, #b91c1c);
  font-size: 12px;
  line-height: 18px;
}
.dsh-session-delete-status {
  margin: 12px 0 0;
  color: var(--dsw-alias-label-secondary, #4b5563);
  font-size: 12px;
  line-height: 18px;
}
.dsh-session-delete-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 22px;
}
.dsh-session-delete-button {
  min-width: 72px;
  height: 32px;
  padding: 0 14px;
  border: 0.5px solid var(--dsw-alias-border-l4, rgba(0, 0, 0, 0.18));
  border-radius: var(--dsw-radius-md, 8px);
  background: transparent;
  color: var(--dsw-alias-label-primary, #0f1115);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.dsh-session-delete-button:disabled {
  opacity: 0.5;
  cursor: default;
}
.dsh-session-delete-button:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, #2563eb));
  outline-offset: 2px;
}
.dsh-session-delete-danger {
  border-color: transparent;
  background: var(--dsw-alias-state-error-primary, #b91c1c);
  color: #fff;
}
.dsh-session-delete-primary {
  border-color: transparent;
  background: var(--dsw-alias-state-business-primary, #2563eb);
  color: #fff;
}
@media (prefers-reduced-motion: reduce) {
  .dsh-session-delete-overlay,
  .dsh-session-delete-dialog {
    animation: none;
  }
}
`

    function createStore(initial) {
      let value = initial
      const listeners = new Set()
      return {
        getSnapshot: () => value,
        subscribe(listener) {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        set(next) {
          value = next
          for (const listener of [...listeners]) listener()
        },
      }
    }

    /** Map stable Host failure codes to localized guidance. */
    function failureText(error, t) {
      switch (error?.code) {
        case 'session-tools/session-running': return t('dialog.live')
        case 'session-tools/session-live': return t('dialog.attached')
        case 'session-tools/not-found': return t('dialog.notFound')
        case 'session-tools/no-log': return t('dialog.noLog')
        case 'session-tools/busy': return t('dialog.busy')
        case 'session-tools/subagent': return t('dialog.subagent')
        case 'session-tools/unsafe-storage': return t('dialog.unsafe')
        case 'session-tools/children': return t('move.children')
        case 'session-tools/workspace-not-found':
        case 'session-tools/workspace-missing': return t('move.workspaceMissing')
        case 'session-tools/target-exists': return t('move.targetExists')
        case 'session-tools/unsupported-format': return t('move.unsupported')
        case 'session-tools/unsupported-host': return t('move.unsupportedHost')
        case 'session-tools/attach-failed': return t('move.attachFailed')
        default: return t('dialog.failed', { message: error?.message ?? String(error) })
      }
    }

    /** 14px trash glyph for the context menu; independent of the host icon package. */
    function TrashIcon() {
      return h('svg', {
        viewBox: '0 0 16 16', width: 14, height: 14, fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': true,
      },
        h('path', { d: 'M2.8 4.2h10.4M6 4.2V3.1c0-.5.4-.9.9-.9h2.2c.5 0 .9.4.9.9v1.1M4.1 4.2l.6 8.6c.05.7.6 1.2 1.3 1.2h4c.7 0 1.25-.5 1.3-1.2l.6-8.6' }),
        h('path', { d: 'M6.7 7v4.1M9.3 7v4.1' }),
      )
    }

    /** 14px folder-with-arrow glyph for the move submenu. */
    function MoveIcon() {
      return h('svg', {
        viewBox: '0 0 16 16', width: 14, height: 14, fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': true,
      },
        h('path', { d: 'M1.9 4.2h4.1l1.3 1.6h6.8v6.8H1.9z' }),
        h('path', { d: 'M7.4 9.4h3.4M9.6 8l1.4 1.4-1.4 1.4' }),
      )
    }

    return {
      inject: ['contextMenus', 'slots', 'locale', 'remoteAccess', 'sessions', 'workspaces'],
      apply(ctx) {
        const t = ctx.locale.bind(NS)
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'session-delete: dictionaries')

        const request = createStore(null)

        const callRoute = async (route, body) => {
          const response = await fetch(route, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          })
          let payload
          try {
            payload = await response.json()
          } catch {
            throw new Error(`Request failed (HTTP ${response.status})`)
          }
          if (payload?.ok !== true) {
            const failure = new Error(payload?.error?.message ?? `Request failed (HTTP ${response.status})`)
            failure.code = payload?.error?.code
            failure.details = payload?.error?.details
            throw failure
          }
          return payload.value
        }

        const removeSession = sessionId => callRoute(DELETE_ROUTE, { sessionId })
        const moveSession = (sessionId, workspaceId) => callRoute(MOVE_ROUTE, { sessionId, workspaceId })
        const readState = async (sessionId, signal) => {
          const response = await fetch(STATE_ROUTE, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId }),
            signal,
          })
          const payload = await response.json()
          if (payload?.ok !== true) throw new Error(payload?.error?.message ?? `State request failed (HTTP ${response.status})`)
          return payload.value
        }
        /** Mirror the workspace browser's localized label for the automatic default title. */
        const workspaceLabel = workspace => workspace.title === 'default-workspace'
          ? t('workspace.default')
          : (workspace.title || workspace.path)

        const notify = (text, success) => {
          try {
            ctx.contextMenus.notify(text, success)
          } catch (error) {
            console.warn('session-delete: notice failed:', error)
          }
        }

        function DeleteSessionDialog({ t: translate }) {
          const pending = React.useSyncExternalStore(request.subscribe, request.getSnapshot)
          const [busy, setBusy] = React.useState(false)
          const [error, setError] = React.useState(null)
          const dialogRef = React.useRef(null)
          const restoreFocus = React.useRef(null)

          React.useEffect(() => {
            if (pending === null) return undefined
            restoreFocus.current = document.activeElement
            setBusy(false)
            setError(null)
            const timer = setTimeout(() => {
              const target = dialogRef.current?.querySelector('[data-autofocus]')
              target?.focus()
            }, 0)
            return () => {
              clearTimeout(timer)
              const previous = restoreFocus.current
              restoreFocus.current = null
              previous?.focus?.()
            }
          }, [pending])

          if (pending === null) return null

          const isMove = pending.kind === 'move'
          const close = () => {
            if (busy) return
            request.set(null)
          }
          const confirm = async () => {
            if (busy) return
            setBusy(true)
            setError(null)
            try {
              if (isMove) {
                await moveSession(pending.sessionId, pending.workspaceId)
                request.set(null)
                notify(translate('toast.moved', { title: pending.workspaceTitle }), true)
                if (typeof ctx.sessions.refresh === 'function') {
                  try {
                    await ctx.sessions.refresh()
                  } catch (reason) {
                    console.warn('session-delete: refreshing the session list failed:', reason)
                  }
                }
              } else {
                await removeSession(pending.sessionId)
                request.set(null)
                notify(translate('toast.deleted'), true)
              }
            } catch (reason) {
              setBusy(false)
              setError(failureText(reason, translate))
            }
          }
          const onKeyDown = event => {
            if (event.key === 'Escape') {
              event.preventDefault()
              close()
              return
            }
            if (event.key !== 'Tab') return
            const focusable = dialogRef.current?.querySelectorAll(
              'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
            )
            if (focusable === undefined || focusable.length === 0) return
            const first = focusable[0]
            const last = focusable[focusable.length - 1]
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault()
              last.focus()
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault()
              first.focus()
            }
          }

          const titleId = 'dsh-session-delete-title'
          const descriptionId = 'dsh-session-delete-desc'
          const displayTitle = pending.displayTitle || pending.sessionId

          return h('div', {
            className: 'dsh-session-delete-overlay',
            onMouseDown: event => { if (event.target === event.currentTarget) close() },
            onKeyDown,
          },
            h('style', null, CSS),
            h('div', {
              ref: dialogRef,
              className: 'dsh-session-delete-dialog',
              role: 'dialog',
              'aria-modal': 'true',
              'aria-labelledby': titleId,
              'aria-describedby': descriptionId,
              tabIndex: -1,
            },
              h('h2', { id: titleId, className: 'dsh-session-delete-title' },
                translate(isMove ? 'dialog.move.title' : 'dialog.title')),
              h('p', { id: descriptionId, className: 'dsh-session-delete-desc' },
                isMove
                  ? translate('dialog.move.desc', {
                    title: displayTitle,
                    workspace: pending.workspaceTitle,
                    path: pending.targetPath,
                  })
                  : translate('dialog.desc', { title: displayTitle })),
              h('p', { className: 'dsh-session-delete-warning' },
                translate(isMove ? 'dialog.move.note' : 'dialog.note')),
              h('p', { className: 'dsh-session-delete-status' },
                translate(isMove ? 'dialog.move.also' : 'dialog.also')),
              busy
                ? h('p', { className: 'dsh-session-delete-status', role: 'status' },
                  translate(isMove ? 'dialog.move.status' : 'dialog.deleting'))
                : null,
              error !== null ? h('p', { className: 'dsh-session-delete-error', role: 'alert' }, error) : null,
              h('div', { className: 'dsh-session-delete-footer' },
                h('button', {
                  type: 'button',
                  className: 'dsh-session-delete-button',
                  disabled: busy,
                  'data-autofocus': true,
                  onClick: close,
                }, translate('dialog.cancel')),
                h('button', {
                  type: 'button',
                  className: isMove
                    ? 'dsh-session-delete-button dsh-session-delete-primary'
                    : 'dsh-session-delete-button dsh-session-delete-danger',
                  disabled: busy,
                  onClick: confirm,
                }, translate(isMove ? 'dialog.move.confirm' : 'dialog.confirm')),
              ),
            ),
          )
        }

        ctx.effect(() => ctx.contextMenus.register({
          id: 'session.delete',
          target: 'session',
          order: 700,
          observe: ({ sessionId }) => [
            ctx.sessions.list,
            ctx.workspaces.list,
            ctx.locale,
            ctx.remoteAccess.source('session', sessionId, ACCESS_ACTION),
          ],
          resolve: async ({ sessionId, displayTitle }, signal) => {
            const row = ctx.sessions.list.getSnapshot().byId[sessionId]
            if (row === undefined || row.blank === true || row.origin === 'subagent') return []
            if (!ctx.remoteAccess.source('session', sessionId, ACCESS_ACTION).getSnapshot()) return []
            let state
            try {
              state = await readState(sessionId, signal)
            } catch {
              if (signal?.aborted) return []
              // A Host without the state route still gets the authoritative check on confirm.
              state = undefined
            }
            if (state?.live === true) {
              return [{
                id: 'restart-required',
                label: state.running === true ? t('menu.running') : t('menu.attached'),
                disabled: true,
                separatorBefore: true,
                afterContent: true,
              }]
            }
            const title = displayTitle || row.displayTitle || row.title || ''
            const workspaces = ctx.workspaces.list.getSnapshot().items
            const currentWorkspaceId = workspaces
              .find(workspace => workspace.sessionIds.includes(sessionId))?.workspaceId
            const targets = workspaces.filter(workspace => workspace.workspaceId !== currentWorkspaceId
              && workspace.path !== row.cwd)
            const actions = []
            if (targets.length > 0) {
              actions.push({
                id: 'move',
                label: t('menu.move'),
                separatorBefore: true,
                afterContent: true,
                icon: { key: 'session-delete.move' },
                children: targets.map(workspace => ({
                  id: `move:${workspace.workspaceId}`,
                  label: workspaceLabel(workspace),
                  run: () => {
                    request.set({
                      kind: 'move',
                      sessionId,
                      displayTitle: title,
                      workspaceId: workspace.workspaceId,
                      workspaceTitle: workspaceLabel(workspace),
                      targetPath: workspace.path,
                    })
                  },
                })),
              })
            }
            actions.push({
              id: 'delete',
              label: t('menu.delete'),
              danger: true,
              separatorBefore: true,
              afterContent: true,
              icon: { key: 'session-delete.trash' },
              run: () => { request.set({ kind: 'delete', sessionId, displayTitle: title }) },
            })
            return actions
          },
        }), 'session-delete: context menu actions')

        ctx.slots.inject('contextMenu.icon', () => {
          const disposers = [
            ctx.slots.register({ name: 'contextMenu.icon', key: 'session-delete.trash' }, TrashIcon),
            ctx.slots.register({ name: 'contextMenu.icon', key: 'session-delete.move' }, MoveIcon),
          ]
          return () => {
            for (const dispose of disposers.reverse()) dispose()
          }
        })

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'session-delete.dialog',
          locale: NS,
        }, DeleteSessionDialog))
      },
    }
  },
})

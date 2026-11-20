# Session move and delete

Adds two actions to a session row's context menu:

- **Move to project** moves the conversation to another workspace project.
- **Delete session** permanently removes the conversation's local record.

Both actions confirm first. Removing a workspace project still uses the built-in
**Delete workspace** action and keeps its folder and sessions.

## Move a session

1. Right-click a session row.
2. Choose **Move to project**, then the target project.
3. Read the confirmation and choose **Move**.

DSH stores a session's working directory in its immutable `SessionHeader`, and a
workspace's membership is validated against that directory. Moving therefore:

- rewrites the `cwd` in every JSONL generation header to the target project path;
- moves the session directory under the target project's JSONL directory;
- detaches the session from its old workspaces and attaches it to the target;
- refreshes the sidebar so the row appears under the target project.

**Later turns run tools in the new working directory.** Historical messages keep
their original paths, so file references recorded before the move may no longer
resolve; review the conversation after moving.

## Delete a session

1. Right-click a session row.
2. Choose **Delete session**.
3. Read the confirmation and choose **Delete permanently**.

The row disappears immediately. The following are removed:

- the session's JSONL log files under `$DSH_HOME/sessions`;
- its projection-cache record under `$DSH_HOME/storages/session_projcache`;
- its membership, pin, and archive references in the workspace registry;
- the sidebar row, through `api-session/removed`.

The session's search-index rows disappear when the next search reconciles the
index with storage.

## Limits

- **Sessions still open in DSH cannot be moved or deleted**, including idle
  sessions whose Agent is still resident; a running turn gets its own notice.
  Restart DeepSeek Harness to release the Agent first. The context menu shows a
  disabled “restart DSH” row instead of letting the action fail after confirm;
  the Host still refuses a race where the session becomes live later.
- **No project files are copied or removed.** Moving relocates the conversation's
  own log and working directory; it does not move or duplicate any files inside
  the project folders.
- **Sessions with subagent children cannot be moved.** Move or remove those
  children first so they cannot become orphans in the old project.
- **Subagent sessions are excluded.** Their rows are internal to a parent
  conversation, so both actions are hidden for them.
- **No cascade.** Child sessions and scheduled tasks are not moved or deleted
  with a parent. Scheduled tasks still target the same session id after a move,
  and later deliveries run in the new directory.
- **No recovery.** Deletion is permanent; there is no trash.
- **JSONL storage only.** The Host refuses a session whose storage location is
  not a JSONL session artifact rather than guessing at another backend's files.
- **One writer at a time.** The Host briefly claims write ownership before either
  operation; another process holding the session is reported as busy.
- **Move depends on the workspace cache shape.** The Host refuses the move when
  the running build hides the registry's header/path caches, rather than leaving
  a moved session ungrouped.

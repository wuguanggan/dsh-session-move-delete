# Session move & delete (DSH plugin)

Move a DeepSeek Harness session to another workspace project, or permanently
delete it, from the sidebar context menu. Sessions still open in DSH are
refused: restart DSH to release the resident Agent first, then move or delete
the cold session.

Install from the plugin market, or from GitHub:

```sh
dsh plugin --profile <profile> add github:wuguanggan/dsh-session-move-delete
```

---

# 会话移动与删除（DSH 插件）

在侧边栏会话的右键菜单中加入：

- **移动到项目**：把会话移动到另一个工作区项目；
- **删除会话**：二次确认后永久删除该会话的本地记录。

工作区项目删除沿用 DSH 内置入口。

## 使用

把会话移动到另一个项目：

1. 在侧边栏右键一个会话；
2. 选择 **移动到项目**，再选择目标项目；
3. 阅读确认框后点击 **移动**。

删除会话：

1. 右键会话，选择 **删除会话**；
2. 阅读确认框后点击 **永久删除**。

移动成功后会话出现在目标项目下；删除成功后会话行立即消失。项目文件夹、其他会话和附件不会被删除。

## 移动的语义

DSH 的会话 `cwd` 在创建时写入不可变的 `SessionHeader`，工作区归属也按 `cwd` 校验。因此“移动”会：

1. 改写会话日志头部的 `cwd` 为目标项目路径；
2. 把会话目录移动到目标项目对应的 JSONL 项目目录；
3. 更新工作区归属（从旧项目 detach，加入新项目）；
4. 清理旧的投影缓存，并让浏览器刷新会话列表。

**继续对话时，工具会在新的工作目录中运行。** 历史消息中出现的旧路径不会被改写；移动前后请自行确认会话中的文件引用仍然有效。

## 删除的范围

- `$DSH_HOME/sessions` 下该会话的 JSONL 日志（含历史代次与 `session.lock`）；
- `$DSH_HOME/storages/session_projcache` 下对应的投影缓存；
- 工作区归属、置顶与归档引用；
- 通过 Host `api-session/removed` 事件移除侧边栏行；
- 搜索索引在下一次搜索对账时移除该会话。

## 限制

- **仍在 DSH 中打开的会话不能移动或删除**，包括空闲但 Agent 仍驻留的会话；运行中的会话会显示单独提示。需要重启 DeepSeek Harness 释放 Agent 后再操作。右键菜单会直接显示“需重启 DSH”而不是让你点进去才失败。
- 移动和删除都是对**冷会话**的本地维护；不会复制项目文件，也不会修改项目文件夹。
- **有子智能体会话的父会话不能移动**，避免子会话留在旧项目成为孤儿。
- 子智能体会话不能单独移动或删除；删除父会话也不会级联删除子会话。
- 指向该会话的定时任务不会自动删除；移动后它们仍指向同一个会话，但会在新目录中投递。
- 仅支持 JSONL 会话存储；遇到非 JSONL 位置会拒绝，不猜测文件。
- 删除是永久的，没有回收站。
- 操作前会短暂获取写锁，另一个进程占用时返回“占用中”。
- 移动依赖当前 DSH 版本的工作区缓存结构；版本隐藏该缓存时会拒绝移动，而不是留下未归属的会话。

## 文件

- `index.js`：Host 端，注册 `/api/dsh-session-delete-local/delete` 和 `/move` 两条精确 Fetch 路由。
- `client.js`：浏览器端，注册右键菜单、移动子菜单、确认对话框和提示。
- `lib/delete-store.js`：只依赖 Node 内置模块的日志与缓存清理。
- `lib/move-store.js`：会话头 `cwd` 改写、JSONL 目录移动和项目目录键计算。
- `cordis.patch.yml`：插入 Host 插件行。
- `locale/`、`icon.svg`、`docs/DETAIL.md`：插件管理器的显示资源。

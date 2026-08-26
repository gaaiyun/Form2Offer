# Form2Offer Local Bridge

Local Bridge 是 Form2Offer 的可选本机 Agent 组件。它只监听 `127.0.0.1`，不提供公网服务、账号或云同步；浏览器扩展未安装 Bridge 时仍可继续使用原有本地规则和内置 AI。

## Windows 快速开始

需要 Node.js 20+ 和可选的 Codex CLI。解压 Release 中的 `Form2Offer-Bridge-win-x64-v0.11.0.zip` 后，在 PowerShell 7 执行：

```powershell
.\start-bridge.ps1 init --resume-root "G:\MyResume" --sources "resume.md,docs\facts.md,docs\versions.md" --job-source "jobs\bank.md"
.\start-bridge.ps1 serve
```

Bridge 会显示六位一次性配对码。在扩展设置页的“本地 Agent”区域填写该配对码并配对。配置和临时任务默认写入 `G:\Form2Offer\BridgeData`；也可用 `--data-dir` 指定其他目录。

Bridge 默认按配置只批准以下四类资料（文件名由用户自己的资料目录决定）：

- 个人简历底稿
- 事实口径与红线文档
- 版本清单
- 本次用 `--job-source` 选择的岗位版源文件

其他用户可用逗号分隔的 `--sources` 自定义白名单，例如：

```powershell
.\start-bridge.ps1 init --resume-root "G:\MyResume" --sources "resume.md,docs\facts.md,docs\versions.md" --job-source "jobs\bank.md"
```

资料源必须位于 `--resume-root` 内并精确出现在白名单中。`backup`、`_backup`、`tmp`、`output`、`releases`、压缩包和目录穿越都会被拒绝。身份证、电话、邮箱、住址、家庭、健康和政治面貌相关行不会进入 Agent 上下文。

## MCP 接入

MCP Client 启动命令为：

```powershell
node .\bin\form2offer-bridge.js mcp --data-dir "G:\Form2Offer\BridgeData"
```

Codex CLI 可注册为：

```powershell
codex mcp add form2offer -- node "G:\path\to\Form2Offer-Bridge\bin\form2offer-bridge.js" mcp --data-dir "G:\Form2Offer\BridgeData"
```

Work Buddy、Claude Code 或其他 MCP Client 请选择 stdio transport，并使用同一条 `node ... mcp` 命令。可用工具为：

- `form2offer_list_sessions`
- `form2offer_get_session`
- `form2offer_search_resume`
- `form2offer_submit_plan`
- `form2offer_cancel_session`

MCP Client 负责主动领取 `awaiting_agent` 任务并提交方案。第一版不调用 Work Buddy 的私有 Electron API。

## 安全边界

- 浏览器调用要求 Chrome 扩展 Origin、配对令牌和明确的 localhost 权限。
- Codex 自动任务使用 `codex exec --ephemeral --sandbox read-only`、独立临时目录和 JSON Schema 输出。
- 任务完成、失败或取消后删除临时正文；状态只保存在内存中，重启 Bridge 后清空。
- Agent 只能建议普通字段；敏感字段、声明、文件上传、验证码、按钮和最终提交不会成为可执行项。
- 方案必须在扩展审阅页由用户勾选确认后才会写入原招聘网页。

运行验证：

```powershell
npm test
npm run check
```

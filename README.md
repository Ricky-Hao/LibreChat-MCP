# librechat-mcp

给内网管理员 / Agent 使用的小型 LibreChat 管理 MCP Server。TypeScript + 官方 MCP SDK，无数据库、管理界面、登录流程或策略引擎。

- **56 个工具**：Skills（含附件和激活状态）、Agents（含 Skill 绑定）、Scheduled Tasks / Cron、Prompt 库、Conversation 增删查改 / 归档 / 消息搜索、Chat Project 增删查改，以及共享 / 可见性管理。
- **通用 API 请求**：没有接口白名单、只读模式或删除 / Run now 开关，方便请求上游新接口。
- **Streamable HTTP + stdio**；JSON 配置；npm 包和 Docker 分发。

> **仅用于可信内网。HTTP 默认没有鉴权，所有写操作均可调用。任何能连接它的人都能使用 refreshToken 对应用户的权限。它不是多用户权限隔离服务，也不是聊天代理。不要直接暴露到公网。**

## 快速运行

需要 Node.js 22+。从源码：

```sh
npm ci
npm run build
cp config.example.json config.json
chmod 600 config.json
# 用编辑器填写 baseUrl 和 refreshToken，不把凭据放在命令行里
npm start -- --config ./config.json
```

`config.json`：

```json
{
  "baseUrl": "http://librechat:3080",
  "refreshToken": "YOUR_LIBRECHAT_REFRESH_COOKIE",
  "host": "0.0.0.0",
  "port": 3000
}
```

MCP 地址：`http://<host>:3000/mcp`。健康检查：`GET /healthz`，只返回 `{"status":"ok"}`，不访问 LibreChat。

### npm 包

GitHub Release 提供可直接安装的 `.tgz` npm 包，不依赖 npm registry 登录：

```sh
curl -fL -o librechat-mcp.tgz https://github.com/Ricky-Hao/LibreChat-MCP/releases/download/v0.3.0/ricky-hao-librechat-mcp-0.3.0.tgz
npm install -g ./librechat-mcp.tgz
librechat-mcp --config ./config.json
```

包名为 `@ricky-hao/librechat-mcp`。npm registry 发布是可选的，需要维护者配置具有对应 scope 发布权限的 `NPM_TOKEN`；没有该凭据时只发布 GitHub Release 包及镜像，不声称已发布到 npm registry。

### Docker

```sh
mkdir -p config
cp config.example.json config/config.json
# 编辑 config/config.json 中的 baseUrl 和 refreshToken
chmod 700 config
chmod 600 config/config.json
docker run --rm --name librechat-mcp \
  -p 127.0.0.1:3000:3000 \
  -v "$PWD/config:/config" \
  ghcr.io/ricky-hao/librechat-mcp:0.3.0
```

容器以非 root 的 `node` 用户（UID 1000）运行，配置目录与文件需归该 UID 所有且可写（必要时调整 ownership）。必须挂载**整个可写目录**，不能使用旧版的单文件或 `:ro` 挂载：刷新会以临时文件 + rename 原子保存轮换后的 refreshToken。容器内配置 `host: "0.0.0.0"`，健康检查固定使用端口 3000。

也可 `docker build -t librechat-mcp .` 从源码构建。K8s 请把 JSON 配置放在可写持久化目录，而不是直接挂载只读 ConfigMap/Secret；同一份刷新会话只运行 **1 个副本**。默认请求超时 30 秒，停止容器可用 `docker stop --time 40`，K8s 配置相应的 terminationGracePeriodSeconds，让正在轮换的凭据保存完成。

### stdio

```sh
librechat-mcp --config ./config.json --transport stdio
```

本地 MCP 客户端配置示例：

```json
{
  "mcpServers": {
    "librechat-admin": {
      "command": "librechat-mcp",
      "args": ["--config", "/absolute/path/config.json", "--transport", "stdio"]
    }
  }
}
```

HTTP 客户端使用 `/mcp` 和 Streamable HTTP。服务无 MCP 会话存储；不提供 GET SSE 订阅或 HTTP DELETE 会话端点。HTTP 断开当前请求会取消该调用，但独立 POST 的取消通知不跨 MCP 实例路由；stdio 支持 SDK 取消通知。Gateway 的具体配置语法及实际集成未验证，不需要修改本服务来接入标准 Streamable HTTP 客户端。

## 配置

| 字段 | 默认 | 说明 |
|---|---|---|
| `baseUrl` | 必填 | LibreChat HTTP(S) 根地址，可包含部署前缀；不要填到 `/api` |
| `refreshToken` | 必填 | 浏览器中 `refreshToken` cookie 的值；仅支持 `token_provider=librechat` |
| `transport` | `http` | `http` 或 `stdio`，CLI 参数可覆盖 |
| `host` | `127.0.0.1` | HTTP 监听地址；容器使用 `0.0.0.0` |
| `port` | `3000` | HTTP 端口 |
| `timeoutMs` | `30000` | 每次上游请求总超时 |
| `userAgent` | 下方浏览器 UA | 用于所有上游 API 和内部刷新请求；通用请求显式 User-Agent 优先，仅覆盖该次请求，不改变内部刷新 UA |
| `authToken` | 不配置 | 可选的独立 MCP Bearer token，不是 LibreChat JWT |

`userAgent` 可省略，默认值为：

```text
Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36 Edg/153.0.0.0
```

自定义时在 JSON 中增加 `"userAgent": "你的 UA"`，重启生效。刷新 cookie 回写会保留此字段。

**v0.2.0 只接受 refreshToken，不兼容旧 `jwt` 配置。** 删除 `jwt` 字段即可升级，不需要自己获取 access JWT。

### 获取与刷新凭据

1. 在自己的浏览器登录 LibreChat，完成二次验证（如果启用）。
2. 开发者工具 → Application / 应用 → Cookies → LibreChat 域名。
3. 确认 `token_provider` 是 `librechat`，复制 `refreshToken` 的值到 JSON。HttpOnly cookie 可以在开发者工具查看，不要用 `document.cookie`。
4. 不要发送凭据给模型或提交到仓库。最好使用独立浏览器配置/登录会话为 MCP 获取凭据，随后不要继续在该浏览器会话里刷新或注销；浏览器和 MCP 同时轮换同一会话会互相使旧 cookie 失效。

首次管理 API 调用时，程序向固定上游 `POST /api/auth/refresh`，使用 `Cookie: refreshToken=...; token_provider=librechat` 获取 JWT。JWT **只保存在内存**。之后遇到明确的 401，合并并发刷新，并用新 JWT 最多重放原请求一次；不解码 JWT 来判断身份，也不自动重试网络异常、5xx 或刷新请求本身。`healthz`、MCP 初始化/工具发现不会刷新或访问 LibreChat。

上游 `Set-Cookie` 中轮换的 refreshToken 会原子回写**同一 JSON 配置**，权限设为 0600，保留其他配置字段。即使 JWT 响应正文损坏，也保存已经收到的轮换 cookie。回写失败返回 `AUTH_PERSIST_FAILED`；先修复目录可写性并再次调用（仅重试保存），不要先重启丢失内存中的新 cookie。正常 SIGTERM/SIGINT 会等待正在进行的刷新和保存，强制 kill / 崩溃或在收到新 cookie 前断网仍可能需要重新登录。

上游默认 access JWT 约 15 分钟、refresh session 约 7 天（以目标部署配置为准）。自动刷新**不会无限延长原会话寿命**；`AUTH_REFRESH_FAILED` 时可能已过期/撤销/轮换丢失，需要重新登录获取 refreshToken，修改配置并重启。代理必须保留刷新响应的 `Set-Cookie`；仅返回 JWT 而没有轮换 cookie 会报告刷新失败。不支持 OIDC token reuse、账号密码自动登录或服务端签名密钥。

`config/`、`config.json` 和 `config.*.json` 已加入 Git ignore（示例除外），Docker build context 不含配置。自定义文件名请自行加入 ignore。程序只自动更新 refreshToken；手动改配置时先停止服务，再编辑并启动，避免与正在进行的自动回写竞争。

### 作为库使用

CLI 自动注入持久化回调。直接使用导出的 API/factory 时，不传回调表示**只在内存保存、重启失效**；需要持久化请明确提供文件路径：

```ts
import { loadConfig, refreshTokenWriter, LibreChatClient, createHttpServer } from '@ricky-hao/librechat-mcp';
const path = './config.json';
const config = await loadConfig(path);
const api = new LibreChatClient(config, refreshTokenWriter(path));
const server = createHttpServer(config, api);
server.listen(config.port, config.host);
// 停止时关闭入站连接，并 await api.close() 等待刷新/保存完成。
```

## 工具

所有名称均以 `librechat_` 开头。完整字段可通过 MCP `tools/list` 查看。

| 资源 | 工具后缀 |
|---|---|
| Skills | `skills_list`, `skills_get`, `skills_create`, `skills_update`, `skills_delete` |
| 附件 | `skills_files_list`, `skills_file_read`, `skills_file_upload`, `skills_file_delete` |
| Skill 激活 | `skills_states_get`, `skills_set_enabled` |
| Agents | `agents_list`, `agents_get`, `agents_create`, `agents_update`, `agents_delete`, `agents_versions`, `agents_set_skills` |
| Cron | `schedules_list`, `schedules_get`, `schedules_create`, `schedules_update`, `schedules_delete`, `schedules_set_enabled`, `schedules_run_now` |
| Prompt 分组 | `prompt_groups_list`, `prompt_groups_get`, `prompt_groups_create`, `prompt_groups_update`, `prompt_groups_delete` |
| Prompt 版本 | `prompts_list`, `prompts_get`, `prompts_add_version`, `prompts_set_default`, `prompts_delete` |
| Conversations | `conversations_list`, `conversations_get`, `conversations_create`, `conversations_update`, `conversations_delete`, `conversations_set_archived`, `conversations_set_pinned` |
| 消息 / 检索 | `conversations_messages_list`, `conversations_messages_read`, `messages_search` |
| Chat Projects | `projects_list`, `projects_get`, `projects_create`, `projects_update`, `projects_delete` |
| 会话项目归属 | `conversations_set_project` |
| 共享 / 可见性 | `permissions_roles`, `permissions_get`, `permissions_update`, `visibility_set` |
| 通用 | `api_request` |

### 关键语义

- **Skill**：先读 `version`，更新时传 `expectedVersion`。deployment Skill 由上游拒绝写入；用户 API 允许有权限的同步来源编辑，但下次同步可能覆盖修改，通常应改源文件。附件上传支持 `utf8` 或 `base64` 内容；`SKILL.md` 用正文更新工具编辑。上游附件读取可能只返回 metadata，不代表内容为空。
- **Agent**：使用 `agent_...` 的 `id`；`agents_get` 默认读取 expanded 配置。更新只发指定字段，`model_parameters` 对现有参数做浅合并，数组是明确替换。没有原子 CAS，不能保证并发修改互不覆盖。专用工具覆盖常用字段；复杂 graph、subagents、tool resources 等配置用通用请求。
- **Skill 绑定**：`agents_set_skills` 单独设置 binding、enabled 和 scope；建议明确指定 `scope: "selected"`。上游 legacy 空数组可能表示所有 Skills，而非无绑定；`scope: "none"` 明确表示不暴露 Skill catalog。
- **Cron**：支持上游 structured cadence 和 `{"frequency":"cron","expression":"0 9 * * 1-5"}`。提供 IANA 时区。创建要求 `clientRequestId`，用同一 key 标识同一创建意图；默认创建为停用，显式 `enabled: true` 可直接启用。更新 / 启停传 `expectedConfigRevision`。不会隐式调用 Run now，但已启用任务会按时间执行。修改可能重算 `nextRunAt`、执行 MCP preflight 并影响在途任务；删除可能返回 202 draining。
- **Prompt 库**：一个 group 下的每个 Prompt 文档是一版，不存在供客户端使用的数字版本 CAS。修改正文用 `prompts_add_version` 追加；`prompts_set_default` 另行改变 `productionId`。删除最后一版会删除 group；删除默认版会选择最新剩余版。
- **Conversation**：操作当前凭据用户自己的会话，没有管理员跨用户 bypass。创建使用本次审计版本的标题 upsert 接口 + 新 UUID，仅创建 metadata，不调用模型。修改只改标题，先读存在性，但没有原子 update-only/CAS；归档、置顶和项目归属分别操作。列表默认只列未归档，`isArchived: true` 只列归档。
- **会话内容**：`conversations_get` 只读 metadata；`conversations_messages_list` 分页读取正文，保留结构化 content 和 parentMessageId。上游时间游标可能漏掉同时间戳消息；需要完整内容时用 `conversations_messages_read`，返回全部存储分支的数组、大小无界，可用 messageId 只读一条。
- **消息搜索**：`messages_search` 的 query 交给 Meilisearch，limit 最多 1000；含归档会话，没有可靠搜索分页、不能组合 conversationId。不保证索引实时或所有 tool/附件内容可搜。Conversation 列表的 search 也搜索标题及消息，但候选集有上游上限。通用 GET `/api/search/enable` 可检查 SEARCH/Meili 健康；未部署/不可用时搜索会报上游错误，不伪装为空结果。
- **Chat Project**：支持 name/description，不是旧 Agent sharing project，也没有 instructions、共享或归档 API。列表搜索 name/description，不依赖 Meili；用 Conversation 列表的 projectId 查看项目内会话。`conversations_set_project` 必须明确传 projectId，null 解除归属；一个会话只能属于一个项目。
- **删除区别**：删除 Conversation 会级联子会话、消息等，并协调停止相关生成，但不保证擦除上传文件。删除 Project 只解除会话归属，保留会话/消息/文件；相关 Schedule 可能在后续执行检查中停用。两者都可能部分成功，不作事务或即时完全清理承诺，不自动清空其他会话。
- **可见性**：权限工具使用文档 `_id`，不是 Agent 的 `agent_...` ID。`public: false` 只撤销公开访问，不会删除现有具名共享。Cron 没有共享 API；Agent / Prompt 没有通用启停开关，不造这些接口。
- **读请求也可能有副作用**：上游 Skills 列表可能同步 GitHub，Schedules 列表重试延期删除，附件读取可能写缓存。本工具按内网管理员用途直接调用，不额外阻止这些 GET。

### 通用 API 示例

```json
{
  "method": "PATCH",
  "path": "/api/agents/agent_example",
  "body": {"instructions": "New instructions"}
}
```

支持 `method`、`path` 或 `url`（二选一）、`query`、JSON `body`、`headers`。没有 endpoint、method、字段或管理操作白名单，写操作不需要另行开启。

- 相对路径基于 `baseUrl`（保留部署前缀）。绝对 URL 原样访问；只有与 `baseUrl` **同源**且未显式指定 Authorization/Cookie 时才自动取得并带上 JWT。
- 调用者提供的 headers 会转发，包括自行指定的认证头；此时不使用托管刷新。外部 URL 和显式调用刷新端点也不会触发自动刷新。不要把生产凭据作为工具参数交给模型。
- 不跟随重定向；3xx 作为上游状态返回错误，避免无意转发凭据。响应按 JSON 或文本读取，不是任意二进制下载代理。
- 对 `text/event-stream` 及未声明 Content-Type 的响应逐块检查 SSE（上游权限拒绝路径可能漏写该头）：即使 HTTP 200，收到 `event: error` 就返回 `UPSTREAM_STREAM_ERROR`、MCP `isError: true`，保留脱敏后的事件 data，并停止读取，不等待流结束、不重试。写操作标记结果可能不确定。正常结束的 SSE 仍返回原始文本；显式普通文本 Content-Type 和 SSE data/comment 中的字样不会误判。
- 通用工具可以绕过专用工具的字段校验，最终受上游权限和只读来源等校验约束。这是刻意保留的管理员逃生口，不承诺细粒度策略隔离或抵御恶意客户端。

## 返回、日志与测试

工具成功返回 `{"status":200,"data":...}`；需要回读的操作另带 `current`。错误统一为 `{"error":{"code":...,"message":...,"status":...,"data":...,"uncertain":...}}`，MCP `isError=true`。409 保留上游冲突数据；写请求超时、断连、5xx 或写后验证失败会标记可能不确定，**不自动重试**，先读取核查，尤其不要盲目重复创建。

输出会遮盖已知凭据字段、初始及轮换的 refreshToken/JWT，以及 authToken 原文；正常配置正文会返回给调用 Agent。日志仅包含工具名、耗时及结果，不打印请求 / 响应正文或认证头。这不是通用 DLP：别把其他秘密混入业务正文。

```sh
npm run check
npm test
npm run build
npm pack
```

测试使用 mock HTTP 上游，同时测试真正的 MCP HTTP / stdio 协议。**没有连接生产 LibreChat 或 Gateway 做集成验证**。详见 [API 能力矩阵](docs/API-MATRIX.md)、[当前计划](docs/PLAN.md) 和 [交付状态](docs/STATUS.md)。

# librechat-mcp

给内网管理员 / Agent 使用的小型 LibreChat 管理 MCP Server。TypeScript + 官方 MCP SDK，无数据库、管理界面、登录流程或策略引擎。

- **40 个工具**：Skills（含附件和激活状态）、Agents（含 Skill 绑定）、Scheduled Tasks / Cron、Prompt 库，以及共享 / 可见性管理。
- **通用 API 请求**：没有接口白名单、只读模式或删除 / Run now 开关，方便请求上游新接口。
- **Streamable HTTP + stdio**；JSON 配置；npm 包和 Docker 分发。

> **仅用于可信内网。HTTP 默认没有鉴权，所有写操作均可调用。任何能连接它的人都能使用配置中 JWT 对应用户的权限。它不是多用户权限隔离服务，也不是聊天代理。不要直接暴露到公网。**

## 快速运行

需要 Node.js 22+。从源码：

```sh
npm ci
npm run build
cp config.example.json config.json
chmod 600 config.json
# 用编辑器填写 config.json 中的 baseUrl 和 jwt，不把 JWT 放在命令行里
npm start -- --config ./config.json
```

`config.json`：

```json
{
  "baseUrl": "http://librechat:3080",
  "jwt": "YOUR_LIBRECHAT_USER_JWT",
  "host": "0.0.0.0",
  "port": 3000
}
```

MCP 地址：`http://<host>:3000/mcp`。健康检查：`GET /healthz`，只返回 `{"status":"ok"}`，不访问 LibreChat。

### npm 包

GitHub Release 提供可直接安装的 `.tgz` npm 包，不依赖 npm registry 登录：

```sh
curl -fL -o librechat-mcp.tgz https://github.com/Ricky-Hao/LibreChat-MCP/releases/download/v0.1.0/ricky-hao-librechat-mcp-0.1.0.tgz
npm install -g ./librechat-mcp.tgz
librechat-mcp --config ./config.json
```

包名为 `@ricky-hao/librechat-mcp`。npm registry 发布是可选的，需要维护者配置具有对应 scope 发布权限的 `NPM_TOKEN`；没有该凭据时只发布 GitHub Release 包及镜像，不声称已发布到 npm registry。

### Docker

```sh
docker build -t librechat-mcp .
docker run --rm --name librechat-mcp \
  -p 127.0.0.1:3000:3000 \
  -v "$PWD/config.json:/app/config.json:ro" \
  librechat-mcp
```

容器以非 root 的 `node` 用户（UID 1000）运行。确保它能读取挂载文件；不要为了方便把 JWT 文件改成所有人可读。容器内配置 `host: "0.0.0.0"`，示例健康检查固定使用端口 3000。

已发布公开镜像：`ghcr.io/ricky-hao/librechat-mcp:0.1.0` / `latest`，已验证无登录匿名拉取。将上面 `docker run` 命令末尾的 `librechat-mcp` 替换为 `ghcr.io/ricky-hao/librechat-mcp:0.1.0` 即可，不需要自行构建。

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

HTTP 客户端使用 `/mcp` 和 Streamable HTTP。服务无会话存储；不提供 GET SSE 订阅或 HTTP DELETE 会话端点。Gateway 的具体配置语法及实际集成未验证，不需要修改本服务来接入标准 Streamable HTTP 客户端。

## 配置

| 字段 | 默认 | 说明 |
|---|---|---|
| `baseUrl` | 必填 | LibreChat HTTP(S) 根地址，可包含部署前缀；不要填到 `/api` |
| `jwt` | 必填 | 合法用户 JWT 的原始 token，不带 `Bearer ` |
| `transport` | `http` | `http` 或 `stdio`，CLI 参数可覆盖 |
| `host` | `127.0.0.1` | HTTP 监听地址；容器使用 `0.0.0.0` |
| `port` | `3000` | HTTP 端口 |
| `timeoutMs` | `30000` | 每次上游请求总超时 |
| `authToken` | 不配置 | 可选的独立 MCP Bearer token，不是 LibreChat JWT |

凭据只从 JSON 配置读取，**没有 Secret 文件引用、自动登录、自动刷新或 JWT 签名功能**。401 会提示 JWT 可能过期或失效；替换配置中的 `jwt` 并重启进程 / 容器即可轮换。配置在启动时读取，修改后必须重启。

`config.json` 和 `config.*.json` 已加入 Git ignore（示例文件除外），Docker build context 也不会包含配置文件。自定义文件名请自行加入 ignore；不要提交生产配置或把它烘焙进镜像。

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
| 共享 / 可见性 | `permissions_roles`, `permissions_get`, `permissions_update`, `visibility_set` |
| 通用 | `api_request` |

### 关键语义

- **Skill**：先读 `version`，更新时传 `expectedVersion`。deployment Skill 由上游拒绝写入；用户 API 允许有权限的同步来源编辑，但下次同步可能覆盖修改，通常应改源文件。附件上传支持 `utf8` 或 `base64` 内容；`SKILL.md` 用正文更新工具编辑。上游附件读取可能只返回 metadata，不代表内容为空。
- **Agent**：使用 `agent_...` 的 `id`；`agents_get` 默认读取 expanded 配置。更新只发指定字段，`model_parameters` 对现有参数做浅合并，数组是明确替换。没有原子 CAS，不能保证并发修改互不覆盖。专用工具覆盖常用字段；复杂 graph、subagents、tool resources 等配置用通用请求。
- **Skill 绑定**：`agents_set_skills` 单独设置 binding、enabled 和 scope；建议明确指定 `scope: "selected"`。上游 legacy 空数组可能表示所有 Skills，而非无绑定；`scope: "none"` 明确表示不暴露 Skill catalog。
- **Cron**：支持上游 structured cadence 和 `{"frequency":"cron","expression":"0 9 * * 1-5"}`。提供 IANA 时区。创建要求 `clientRequestId`，用同一 key 标识同一创建意图；默认创建为停用，显式 `enabled: true` 可直接启用。更新 / 启停传 `expectedConfigRevision`。不会隐式调用 Run now，但已启用任务会按时间执行。修改可能重算 `nextRunAt`、执行 MCP preflight 并影响在途任务；删除可能返回 202 draining。
- **Prompt 库**：一个 group 下的每个 Prompt 文档是一版，不存在供客户端使用的数字版本 CAS。修改正文用 `prompts_add_version` 追加；`prompts_set_default` 另行改变 `productionId`。删除最后一版会删除 group；删除默认版会选择最新剩余版。
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

- 相对路径基于 `baseUrl`（保留部署前缀）。绝对 URL 原样访问；只有与 `baseUrl` **同源**时才自动带上配置的 JWT。
- 调用者提供的 headers 会转发，包括自行指定的认证头；不要把生产凭据作为工具参数交给模型。
- 不跟随重定向；3xx 作为上游状态返回错误，避免无意转发凭据。响应按 JSON 或文本读取，不是任意二进制下载代理。
- 通用工具可以绕过专用工具的字段校验，最终受上游权限和只读来源等校验约束。这是刻意保留的管理员逃生口，不承诺细粒度策略隔离或抵御恶意客户端。

## 返回、日志与测试

工具成功返回 `{"status":200,"data":...}`；需要回读的操作另带 `current`。错误统一为 `{"error":{"code":...,"message":...,"status":...,"data":...,"uncertain":...}}`，MCP `isError=true`。409 保留上游冲突数据；写请求超时、断连、5xx 或写后验证失败会标记可能不确定，**不自动重试**，先读取核查，尤其不要盲目重复创建。

输出会遮盖已知凭据字段及配置中的 JWT / authToken 原文；正常配置正文会返回给调用 Agent。日志仅包含工具名、耗时及结果，不打印请求 / 响应正文或认证头。这不是通用 DLP：别把其他秘密混入业务正文。

```sh
npm run check
npm test
npm run build
npm pack
```

测试使用 mock HTTP 上游，同时测试真正的 MCP HTTP / stdio 协议。**没有连接生产 LibreChat 或 Gateway 做集成验证**。详见 [API 能力矩阵](docs/API-MATRIX.md)、[当前计划](docs/PLAN.md) 和 [交付状态](docs/STATUS.md)。

# LibreChat API 能力矩阵

源码基准：[官方 dev@21a9edbe7481fd4de180b45922a2468fdcf79ea3](https://github.com/danny-avila/LibreChat/tree/21a9edbe7481fd4de180b45922a2468fdcf79ea3)。审计的是该 commit 的路由、中间件、校验器、服务和模型，不是邻近的自定义分支，也不只是上游文档。

**没有运行真实 LibreChat / Gateway 集成测试。** 下表的“已实现 / mock”不等于真实环境认证或权限验证通过。每个资源受目标部署的功能开关、用户角色、ACL、租户上下文和内容过滤影响；MCP 不代签 JWT、不指定 tenant/user 冒充身份，不绕过上游权限。

所有工具名称前缀为 `librechat_`；以下省略前缀。

## Authentication / refresh（v0.2.0）

| HTTP method/path | 字段与返回 | 状态与影响 | MCP / 测试 |
|---|---|---|---|
| POST `/api/auth/refresh` | cookie `refreshToken` + `token_provider=librechat`；JSON `{token,user}`，`Set-Cookie: refreshToken=...` | 不需要旧 access JWT。验证 refresh token 与服务端 session、有效期后签发 JWT，并轮换 session 的 refresh-token hash；会话的原过期时间不无限延长 | 内部调用，不作为额外工具；mock bootstrap、401、并发、轮换/保存、损坏响应、取消/关闭 |

配置只接受 refreshToken，不再接受 jwt。第一次托管 API 请求获取 JWT，明确 401 时只刷新并重放一次。JWT 在内存，CLI 将轮换 refreshToken 原子回写原 JSON。HTTP 各 POST 共享同一个 client 的刷新状态；独立 MCP 会话对象不会导致独立刷新。调用者显式 Authorization/Cookie、外部 URL、直接调用 refresh endpoint 不触发托管刷新。不是 OpenID/M2M 刷新、自动登录或凭据永久续期。

普通请求超时/断连/5xx 和刷新请求自身不重试；下文“不重试”均不包括明确认证拒绝后的这一次 401 重放。生产 JWT/cookie/刷新行为尚未实测。

源码：`api/server/controllers/AuthController.js` 非 OpenID refresh 分支、`api/server/services/AuthService.js:setAuthTokens`、`packages/data-schemas/src/methods/session.ts:generateRefreshToken`。

## Skills

| HTTP method/path | 字段与返回 | 认证/权限、并发与副作用 | MCP / 测试 |
|---|---|---|---|
| GET `/api/skills` | query `category,search,limit,cursor`；返回 `{skills,has_more,after}`，每项带 version/source | 用户 JWT + SKILLS USE；按可访问/公开 ACL 和租户列出。GET 可能启动 GitHub 同步 | `skills_list`；mock cursor/response |
| GET `/api/skills/:id` | 返回 Skill，包括 `_id,name,description,body,frontmatter,version,source,sourceMetadata,isPublic` | VIEW ACL；deployment Skill 可读 | `skills_get`；HTTP MCP 调用 |
| POST `/api/skills` | `name,description` 必填；`displayTitle,body,frontmatter,category,alwaysApply` 可选；201 Skill + warnings | USE/CREATE；作者与 tenant 来自已认证用户；创建 owner ACL，不公开共享 | `skills_create`；mock mapping |
| PATCH `/api/skills/:id` | 上述字段的局部更改，正整数 `expectedVersion` 必填；200 新 Skill；409 `{error:skill_version_conflict,current}` | CREATE + EDIT；模型按 `_id,version` 条件原子更新并递增版本。deployment 来源由上游拒绝；用户 API 不统一禁止 github/notion 来源写入，但后续同步可能覆盖手改。不自动覆盖版本冲突 | `skills_update`；mock 版本冲突/上游来源拒绝 |
| DELETE `/api/skills/:id` | `{id,deleted:true}` | CREATE + DELETE；无删除 CAS。删除文件记录/ACL、清理 Agent allowlists；blob 清理异步，成功不代表所有 blob 已擦除 | `skills_delete`；mock mapping |
| GET `/api/skills/:id/files` | `{files:[...]}`，无分页 | VIEW；元数据可能含存储路径，日志不记录 | `skills_files_list`；mock |
| GET `/api/skills/:id/files/*relativePath` | JSON `{content?,mimeType,isBinary,relativePath,filename,bytes}`；`SKILL.md` 直接读正文 | VIEW；文本可写上游缓存；二进制或超过约 1 MiB 的文件可能不返回 content，不当作空文件 | `skills_file_read`；mock nested path |
| POST `/api/skills/:id/files` | multipart `file,relativePath`；添加或替换单文件 | EDIT；无文件 CAS；Skill 文件变更和计数/版本更新非整体事务。专用工具支持 utf8/base64 输入；不允许以附件编辑 SKILL.md | `skills_file_upload`；mock multipart |
| DELETE `/api/skills/:id/files/*relativePath` | `{skillId,relativePath,deleted:true}` | EDIT；无文件 CAS；异步 blob 清理 | `skills_file_delete`；mock |
| GET/POST `/api/settings/skills/active` | GET `{[skillId]:boolean}`；POST `{skillStates:{...}}` 返回状态表 | 用户 JWT；这是当前用户偏好，不是共享或正文。POST **替换整张表**，有 orphan/access pruning；无 CAS。专用 setter 读/合并/写，保留其他值但不能排除并发丢更新 | `skills_states_get`, `skills_set_enabled`；mock merge |

用户 Skills 路由没有独立的全局 `enabled` 字段。Agent Skill catalog 启用是 Agent 配置；用户 activation 是 settings；public 是 ACL，三者不同。

`/api/agents/v1/skills` 属于另一套管理接口，使用 `createAgentManagementAuth` 验证 **OIDC M2M access token、machine subject、client binding 与租户主体**，并不接受任意用户 JWT。没有为该接口创建专用工具；通用工具若调用，仍由上游认证。

## Agents

| HTTP method/path | 字段与返回 | 权限/并发/影响 | MCP / 测试 |
|---|---|---|---|
| GET `/api/agents` | `category,search,limit,cursor,promoted,requiredPermission`；工具将 promoted boolean 映射为上游要求的 1/0；游标结果保留上游 `data,has_more,after` | 用户 JWT、AGENTS USE、按 ACL 查询；上游可能刷新元数据，非严格纯读 | `agents_list`；schema/discovery |
| GET `/api/agents/:id` | 基本 Agent；有数据库 `_id` 及业务 `id=agent_...` | VIEW；不返回完整 instructions 等编辑配置 | `agents_get(expanded=false)` |
| GET `/api/agents/:id/expanded` | 完整可编辑配置，version 是历史计数 | EDIT，不将 version 假冒为 CAS | `agents_get` 默认 expanded；mock |
| POST `/api/agents` | `provider,model`，常用可选字段 name/description/instructions/model_parameters/tools/category 等；201 Agent | CREATE；上游设置作者、ID、过滤/授权工具并授予 owner ACL。不隐式公开 | `agents_create`；mock |
| PATCH `/api/agents/:id` | 只发指定字段；200 Agent | CREATE + EDIT；没有一般客户端 CAS。server 会做 legacy OCR / 工具权限 reconciliation，可能改变无权限的已有工具。MCP 不重发整个 Agent；model_parameters 浅合并，其他数组明确替换 | `agents_update`；mock 不覆盖无关字段 |
| PATCH `/api/agents/:id`（Skill 配置） | `skills,skills_enabled,skills_scope,skill_authoring_enabled` | `skills_scope=all/selected/none`。legacy 空 skills 配合 enabled=true 可表示全部；空列表要表达 none 应指定 scope。无 CAS | `agents_set_skills`；mock 独立 payload |
| GET `/api/agents/:id/versions` | 历史配置数组 | EDIT；不是乐观锁 | `agents_versions`；mock |
| DELETE `/api/agents/:id` | `{message:"Agent deleted"}` | DELETE；无 CAS。上游相关 ACL/引用处理和后续 schedule fire access 检查仍生效；不要把此操作理解成撤回既有聊天 | `agents_delete`；mock |

专用编辑 schema 覆盖常用 Agent 字段。复杂 graph/subagents/tool_resources、duplicate/revert/avatar 等无需占位工具，使用通用请求；目前没有多版本转换层。

## Scheduled Tasks / Cron

| HTTP method/path | 字段与返回 | 权限/并发/影响 | MCP / 测试 |
|---|---|---|---|
| GET `/api/schedules` | `{schedules,limits}`；**无分页** | 用户 JWT + SCHEDULES USE，owner-scoped；读取会重试最多一小批 deferred deletions，并可能中止/擦除先前正在删除的任务；不 run-now | `schedules_list`；discovery |
| GET `/api/schedules/:id` | Schedule，含 `configRevision,timezone,nextRunAt,lastRun,inFlight` | owner-scoped，跨 owner 通常 404 | `schedules_get`；discovery |
| POST `/api/schedules` | `name,prompt,agent_id,cadence,timezone,clientRequestId`；可选 target=new,file_ids,chatProjectId,enabled；201 Schedule | CREATE；检查 agent USE/VIEW、附件/项目 ownership、账户删除门禁和服务就绪。clientRequestId 是真实上游幂等标识。上游 enabled 默认 true；专用工具默认 false，允许显式 true | `schedules_create`；mock cron/disabled 默认 |
| PATCH `/api/schedules/:id` | 局部配置 + `expectedConfigRevision`；200 新 Schedule，409 冲突 | upstream 可选 revision，但专用工具要求。服务先比 revision，再以读取 revision 为原子写 fence；不伪造 CAS。cadence/timezone 变更重算 nextRunAt；编辑可改 claim fencing，并做 MCP preflight/文件保留 | `schedules_update`；mock revision payload |
| PATCH `/api/schedules/:id`（启停） | `{enabled,expectedConfigRevision}` | 独立操作；启用安排未来执行，停用不保证即时 abort 现有生成 | `schedules_set_enabled`；mock |
| DELETE `/api/schedules/:id` | 200 或 202 `{id}`；503 可能 unconfirmed | quiesce-then-erase：停止新 claim、尝试 abort live runs；202 = draining，不伪报已完全擦除；无客户端 delete CAS | `schedules_delete`；mock 202 |
| POST `/api/schedules/:id/run` | `{scheduleId,conversationId,status:"started"}`；409 已 leased；其他 fire 错误 | CREATE；立即触发真实 Agent，可能费用和工具调用；独立调用，不重试 | `schedules_run_now`；mock explicit call |

cadence：structured `hourly/daily/weekdays/weekly` + hour/minute/daysOfWeek，或 `frequency=cron,expression`。cron 五字段语法、IANA timezone、最小间隔、DST/nextRunAt 的计算交给目标上游校验与执行，不用本地 cron 引擎重复实现。Schedules 不在 ACL ResourceType 中，**没有查询到任务共享/可见性 API**。

## Prompt library

不是 Agent instructions，也不是 Schedule prompt。

| HTTP method/path | 字段与返回 | 权限/并发/影响 | MCP / 测试 |
|---|---|---|---|
| GET `/api/prompts/groups` | `limit,cursor,name,category`；`{promptGroups,pageNumber,pageSize,pages,has_more,after}`；工具显式默认 limit=20 | 用户 JWT + PROMPTS USE，group ACL；上游兼容 pageSize，但专用工具使用 cursor | `prompt_groups_list`；mock |
| GET `/api/prompts/groups/:groupId` | Group，包括 productionId / productionPrompt | group VIEW | `prompt_groups_get` |
| POST `/api/prompts` | `{group:{name,oneliner?,category?,command?},prompt:{prompt,type:text|chat}}`；`{group,prompt}` | CREATE；新建 group + 初始 version，初始 productionId 指向该版。不共享。多步骤写非原子，不自动重试 | `prompt_groups_create`；mock |
| PATCH `/api/prompts/groups/:groupId` | 严格 metadata schema `name,oneliner,category,command`；Group | CREATE + EDIT；排除 productionId/author 等，无 CAS | `prompt_groups_update`；mock |
| DELETE `/api/prompts/groups/:groupId` | message | DELETE；所有版本及 group ACL 级联，无 CAS | `prompt_groups_delete`；mock |
| GET `/api/prompts?groupId=...` | 所有版本，createdAt 降序，数组；无分页 | group VIEW；专用工具必填 groupId，不请求跨组 admin bypass 列表 | `prompts_list` |
| GET `/api/prompts/:promptId` | Prompt `{_id,groupId,author,prompt,type,createdAt,updatedAt,...}` | 经 group VIEW | `prompts_get` |
| POST `/api/prompts/groups/:groupId/prompts` | `{prompt:{prompt,type}}`；`{prompt}` | group EDIT；**追加新文档**；不覆盖历史，不切换 productionId | `prompts_add_version`；mock append/no implicit default |
| PATCH `/api/prompts/:promptId/tags/production` | `{message}`；工具回读 group 验证 productionId | CREATE + group EDIT；无 CAS，可能 concurrent change | `prompts_set_default`；mock readback |
| DELETE `/api/prompts/:promptId?groupId=...` | 删除结果；可能额外返回 promptGroup 被删 | group DELETE；最后一版删除 group/ACL；若删除 production 则选最新剩余版本 | `prompts_delete`；mock query |

本版 Prompt schema 没有数字 `version`；版本就是单独文档及创建时间。没有内容 in-place PATCH 或一般 enabled API。部分 Prompt 模型会用 HTTP 200 + error message 代表失败，专用创建/编辑/读取工具检查必要返回形状；通用工具除 SSE error 事件外，只报告实际 HTTP 状态/正文，不替任意新 API 解释业务成功。

## Conversations / Messages（v0.3.0）

**仅当前认证用户自己的会话；这些接口没有管理员跨用户 bypass，分享链接也不赋予 owner API 访问权。** 租户、retention、子线程可见性仍由上游检查。以下均为已实现 / mock 映射，不是线上功能验证。

| HTTP method/path | 字段与返回 | 并发、限制与副作用 | MCP / 测试 |
|---|---|---|---|
| GET `/api/convos` | `limit` 默认 25 / 最大 100，`cursor,isArchived,pinned,tags,search,sortBy,sortDirection,projectId`；`{conversations,nextCursor}` | `isArchived=false` 只列未归档、true 只列归档；pinned=false 不过滤；tags 重复键匹配任一标签；projectId 为 ObjectId 或 `unassigned`。同一遍历保持过滤/排序不变 | `conversations_list`；mock query/cursor |
| GET `/api/convos/:conversationId` | conversation 文档；messages 仅引用，不是正文 | owner-scoped；404 unavailable；不调用 gen_title（后者会消费缓存）。metadata 和消息读取的 retention 检查并不完全一致 | `conversations_get`；mock |
| GET `/api/messages?conversationId=...` | `pageSize,cursor,sortBy,sortDirection`；`{messages,nextCursor}`；工具默认 25 / createdAt / asc，本地 pageSize 上限 1000 | 必须是根路径 query。上游单字段时间游标无 ID tie-breaker，且日期字符串可能丢毫秒，会漏同值消息；不能保证遍历完整 | `conversations_messages_list`；mock root query/structured content |
| GET `/api/messages/:conversationId[/:messageId]` | 完整消息数组；可选 messageId 返回零或一项数组，空数组不伪报 404 | 完整读取无分页、大小无界；包括全部存储分支，保留 parentMessageId/text/content/files 等，不扁平化为单线对话 | `conversations_messages_read`；mock path/branches |
| GET `/api/messages?search=...&pageSize=...` | 工具 query → search、limit → pageSize，默认 25 / 最大 1000；`{messages,nextCursor:null}` | Meili 全文搜索；含归档会话。无可用搜索分页、无 conversationId 联合过滤（传 ID 会绕过搜索）；不伪造 total/cursor。保留上游命中数据和中央凭据脱敏，不额外宣称与普通消息读取投影相同 | `messages_search`；mock mapping/errors |
| GET `/api/search/enable` | JSON boolean | SEARCH 开关及 Meili 健康检查，不代表索引完整；不是搜索接口 | 通用 `api_request`，无自动 preflight/gate |
| POST `/api/convos/update`（创建） | `{arg:{conversationId,title}}`；201 conversation | **没有专门空会话创建 API**。工具生成新 UUID，利用 pinned 标题接口 upsert 创建仅 metadata 的会话；无模型调用，无 create-only/CAS 保证，无跨调用幂等键；验证返回 ID/title | `conversations_create`；mock UUID/no chat call |
| POST `/api/convos/update`（修改） | 同上，只支持 title；工具 trim 且限制 1024，不静默截断 | 先 GET 确认存在以防拼错 ID 触发 upsert，但不是原子 update-only；并发删除后仍可能重建。200/201 `{message:"Error saving conversation"}` 不算成功 | `conversations_update`；mock pre-read/embedded error |
| POST `/api/convos/archive` | `{arg:{conversationId,isArchived:boolean}}`；200 conversation | 无 upsert，保留 updatedAt；归档写 archivedAt，取消清空。内部有并发重试，但耗尽可返回相反状态，工具核对 ID/目标值；不停止生成、不删除消息/文件/分享 | `conversations_set_archived`；mock boolean/state verification |
| POST `/api/convos/pin` | `{arg:{conversationId,pinned:boolean}}`；200 conversation | 无 upsert，保留 updatedAt，无客户端 CAS；核对返回状态 | `conversations_set_pinned`；mock |
| DELETE `/api/convos` | **仅** `{arg:{conversationId}}`；201 `{acknowledged,deletedCount,messages,conversationIds}` | 必填非空字符串 ID，绝不透传 source/endpoint/thread_id 或批量参数；零删除可成功。级联 owner 子会话、消息、checkpoint、分享等，协调生成/子任务停止；部分失败仍可能已写入。不承诺任意旧 provider 执行均已停止或附件 blob 擦除；上游清理失败标志不能当完整成功 | `conversations_delete`；mock exact body/no bulk/zero count |

搜索依赖 `MEILI_HOST` / `MEILI_MASTER_KEY` 和可用索引；同步由 `SEARCH` 控制，索引最终一致。`SEARCH=false` 时既有索引查询仍可能返回旧数据；`/api/search/enable=true` 不保证索引可查或完整。实际没有 `GET /api/search?q=...` 路由，不能沿用数据提供层的旧 URL helper。Conversation list 的 search 合并 title/index 与 message 命中，每个索引最多 1000；消息索引查询失败时可能静默退化为标题等 conversation-index 匹配。消息搜索支持索引中的 text、thinking、steer 文本，不保证任意 tool 内容或附件字节可检索；查询语义由部署的 Meili 决定，无本地 SQL/Lucene/regex 解析。

不提供批量归档/清空、聊天发送/模型生成、任意 conversation 字段 PATCH 或消息正文编辑工具。项目归属使用下节的独立 setter；更多接口仍可显式使用通用请求。

## Chat Projects（v0.3.0）

这里是 `ChatProject` / `chatprojects`，不是旧的 Agent sharing `projects` 集合，也不是 AgentCategory。所有操作 owner-scoped，无管理员跨 owner、共享或角色管理接口。

| HTTP method/path | 字段与返回 | 并发、限制与副作用 | MCP / 测试 |
|---|---|---|---|
| GET `/api/projects` | `cursor,limit` 默认 25 / 最大 100；sortBy `name/createdAt/lastConversationAt`，sortDirection `asc/desc`，search；`{projects,nextCursor}` | 搜索 name/description 的字面子串、不依赖 Meili；默认活动时间倒序 + ID tie-breaker，无 total；同一遍历保持 search/sort | `projects_list`；mock query/cursor |
| GET `/api/projects/:projectId` | 直接 project 文档及已存 conversationCount/lastConversationAt/lastConversationId | 不包含会话正文；用 conversations_list 的 projectId 过滤。计数仅含 retention 可见、未归档会话；GET 不刷新统计 | `projects_get`；mock |
| POST `/api/projects` | `{name,description?}`；201 project；MCP name 非空且 ≤100、description ≤1000，trim 后送出 | 上游会静默截断超长字段，工具提前拒绝；名称不唯一，无幂等键；不支持 instructions/files/agents/members 等字段 | `projects_create`；mock |
| PATCH `/api/projects/:projectId` | 只发 changes 中 name/description；200 project；description 空串清除 | 部分更新保留其他字段，无客户端 CAS；拒绝空 changes | `projects_update`；mock minimal patch |
| DELETE `/api/projects/:projectId` | 200 `{deletedCount,modifiedCount}` | 删除项目并 unset 所属会话的 chatProjectId；**保留会话、消息、文件、Schedule**。非事务，可能部分成功；Schedule 后续检查可能因 project_deleted 停用，不是即时取消生成 | `projects_delete`；mock no conversation-delete call |
| PUT `/api/projects/conversations/:conversationId` | `{projectId:ObjectId或null}`；`{conversation,previousProjectId,projectId}` | 移动/归属一个项目，明确 null 解除；必须显式传参，不能因漏填而解除。不改归档状态；无 CAS，统计失败可在归属已写入后返回 500 | `conversations_set_project`；mock move/unlink/missing argument |

Project ID 为 24-hex Mongo ObjectId；目标不属于当前用户时返回 unavailable。Project 无归档 API，也无级联删除其所有聊天的专用工具。

## 共享与可见性

| HTTP method/path | 字段与返回 | 权限/并发/影响 | MCP / 测试 |
|---|---|---|---|
| GET `/api/permissions/:resourceType/roles` | accessRoleId/permission role 列表 | 用户 JWT；resourceType 为 skill/agent/promptGroup | `permissions_roles` |
| GET `/api/permissions/:resourceType/:resourceId` | principals, public, publicAccessRoleId | SHARE ACL；Agent 使用文档 `_id`，不是 agent_... ID | `permissions_get` |
| PUT 同上 | `updated:[{type,id,accessRoleId,...}],removed:[{type,id}]`；grant/revoke 结果 | SHARE ACL + role SHARE，用户/组/角色变更不是整表覆盖；无 CAS；上游会跳过部分无效 principal，因此回读 actual ACL | `permissions_update`；mock readback |
| PUT 同上（public） | `{public,publicAccessRoleId?}`，true 默认 viewer role | 公开还需 SHARE_PUBLIC；false 只撤销 PUBLIC 条目，保留 named shares | `visibility_set`；mock |

不提供 Schedule sharing、Prompt 单版本 sharing 或不存在的 Agent/Prompt 全局启停工具。Prompt 的共享单位是 group。

## 通用请求与验证边界

`api_request` 转发任意 method/path 或 absolute URL、query、JSON body、headers；没有写入 gate / allowlist，供管理员访问未封装接口。JWT 通过 refreshToken 内部获取，只自动附加到 baseUrl 同源且无显式 Authorization/Cookie 的请求；headers 可显式覆盖，redirect 不跟随；JSON/text 返回。可绕过专用工具输入限制，但不绕过上游认证。自动测试覆盖未知路由 DELETE、绝对 URL、origin 凭据处理、headers/query、错误与无重试。v0.3.0 配置 userAgent 用于 refresh 和普通 API（显式请求 User-Agent 仅覆盖本次 API）。SSE 逐块解析：HTTP 200 的 `event: error` 返回 `UPSTREAM_STREAM_ERROR` / MCP isError，保留脱敏事件 data、停止读流且不重试；也检查未声明 Content-Type 的响应，因为 pinned denyRequest 会如此发出 SSE。显式普通文本 Content-Type 不作 SSE 误判。

## 源码证据索引

以上路径均相对 pinned upstream，点击顶部 commit 链接查看：

- 挂载：`api/server/index.js`；用户 vs M2M 挂载顺序：`api/server/routes/agents/index.js`。
- Skills：`api/server/routes/skills.js`、`api/server/services/Skills/handlers.js`、`api/server/services/Skills/sync.js`；`packages/api/src/skills/handlers.ts`、`packages/data-schemas/src/methods/skill.ts`；`api/server/middleware/accessResources/canAccessSkillResource.js`。
- Skill user state：`api/server/controllers/SkillStatesController.js`、`api/server/routes/settings.js`。
- Auth：`api/server/middleware/requireJwtAuth.js`、`api/server/controllers/AuthController.js`、`api/server/services/AuthService.js`、`packages/data-schemas/src/methods/session.ts`、`api/server/routes/agents/middleware.js`、`packages/api/src/middleware/management.ts`。
- Agents：`api/server/routes/agents/v1.js`、`api/server/controllers/agents/v1.js`、`packages/api/src/agents/validation.ts`、`packages/data-provider/src/schemas.ts`（SkillsScope）。
- Schedules：`api/server/routes/schedules.js`、`packages/data-provider/src/types/schedules.ts`、`packages/api/src/schedules/handlers.ts`、`packages/api/src/schedules/cadence.ts`。
- Prompts：`api/server/routes/prompts.js`、`packages/api/src/prompts/schemas.ts`、`packages/api/src/prompts/format.ts`、`packages/data-schemas/src/methods/prompt.ts`、`packages/data-schemas/src/schema/prompt.ts`。
- Conversations：`api/server/routes/convos.js`、`api/server/middleware/validate/convoAccess.js`、`api/server/middleware/denyRequest.js`、`packages/data-schemas/src/methods/conversation.ts`、`packages/data-schemas/src/schema/convo.ts`。
- Messages / search：`api/server/routes/messages.js`、`api/server/routes/search.js`、`packages/api/src/middleware/messageValidation.ts`、`packages/data-schemas/src/methods/message.ts`、`packages/data-schemas/src/models/plugins/mongoMeili.ts`；`packages/data-provider/src/api-endpoints.ts` 中 listMessages 的 query/path 选择不能直接用于消息分页。
- Chat Projects：`api/server/routes/projects.js`、`packages/api/src/projects/handlers.ts`、`packages/data-schemas/src/methods/chatProject.ts`、`packages/data-schemas/src/schema/chatProject.ts`；关联 Schedule 依赖检查见 `packages/api/src/schedules/fire.ts`。
- Permissions：`api/server/routes/accessPermissions.js`、`api/server/controllers/PermissionsController.js`、`packages/data-provider/src/accessPermissions.ts`。

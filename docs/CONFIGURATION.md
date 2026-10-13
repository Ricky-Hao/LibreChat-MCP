# 配置写入合同与迁移（v0.5.0 候选发布源码）

这是已发布/部署 v0.4.0 之后的 v0.5.0 候选发布源码，包和 server 版本为 0.5.0；资产发布和部署仍待分别执行、核验。当前源码 **56 个工具**：配置接口同步开放，并移除没有当前上游支持的 `conversations_create`。本地准备没有更新任何真实绑定、平台配置或数据。

## 接口边界

外层参数严格，配置对象开放；MCP 不维护下列开放对象的业务字段白名单。字段类型、必需项、权限及实际效果由上游验证。固定 HTTP 路由不变，配置只进入 body，不能修改请求选项。

| 工具输入（省略 librechat_ 前缀） | 配置与控制 |
|---|---|
| `agents_create({config})` | 开放 config；上游要求 provider/model，model_parameters 可省略 |
| `agents_update({id,changes})` | 非空 changes；model_parameters 不再隐式 GET/浅合并 |
| `skills_create({config})` | 开放 config；上游要求 name/description；作者/租户取认证用户 |
| `skills_update({id,expectedVersion,changes})` | 非空 changes；外层 expectedVersion 必填正整数；changes 顶层禁止同名控制键 |
| `projects_create({config})` | 开放 config；上游支持 name/description/instructions |
| `projects_update({projectId,changes})` | 非空 changes；contextRevision 作为上游原名字段直接传递 |
| `schedules_create({config,clientRequestId,enabled?})` | clientRequestId 外层必填；enabled 外层默认 false，显式 true 才创建为启用 |
| `schedules_update({id,expectedConfigRevision,changes})` | 外层 revision 必填非负整数，changes 非空；启停仍用 schedules_set_enabled |
| `prompt_groups_create({group,prompt})` | **group 继续严格 typed**；prompt 是开放 JSON object |
| `prompt_groups_update({groupId,changes})` | 非空开放 changes；当前上游严格 metadata schema 会拒绝未知字段 |
| `prompts_add_version({groupId,prompt})` | 开放 prompt；上游要求 prompt/type，剥离额外字段；追加新版本 |

Schedule 的 config/changes 顶层均禁止 `enabled`、`clientRequestId`、`expectedConfigRevision`，即使与外层值相同也在认证/HTTP 前拒绝。Skill update 同理拒绝顶层 `expectedVersion`。这是操作控制归属，非业务字段白名单；嵌套普通对象中的这些键不受限制。Skill create 没有该控制，未额外禁止 config.expectedVersion（当前上游会忽略）。

不引入旧形状别名。**Agent/Skill/Project/Schedule create 的原平铺字段调用须迁移到 config wrapper**；Schedule 的 clientRequestId/enabled 留在外层。Prompt wrappers 和更新外层 ID/revision 形状保持。

```js
skills_create({config: {name: 'example', description: 'Example skill', body: '# Example', frontmatter: {}}})
skills_update({id: 'SKILL_ID', expectedVersion: 7, changes: {body: '# Updated'}})
projects_create({config: {name: 'Example', instructions: 'Project guidance'}})
projects_update({projectId: 'PROJECT_OBJECT_ID', changes: {instructions: '', contextRevision: 3}})
schedules_create({
  clientRequestId: 'unique-create-intent', // 重试同一意图时保留此值及原 payload
  config: {name: 'Example', prompt: 'Example task', agent_id: 'AGENT_ID',
    cadence: {frequency: 'daily', hour: 9, minute: 0}, timezone: 'Asia/Shanghai'}
}) // MCP 显式发送 enabled:false，不继承上游默认 true
prompt_groups_create({group: {name: 'Example'}, prompt: {prompt: 'Example text', type: 'text'}})
```

占位 ID/模型需换成目标上游的真实值；示例不执行任何调用。Mongo ObjectId 参数保持 24-hex 校验，其他 ID 保持校验和 URL 编码。

## 上游语义

- 开放对象经通用验证后按值发送，保留遗漏、null、false、0、空字符串、空数组/对象，不做业务类型转换、字段重命名、配置合并或隐藏读回。外层控制仅按上述合同加入 body。一次工具写入不意味着上游只有一次数据库操作。
- 上游可能归一化或忽略字段：Skill handler 选择支持的字段；Project handler 选择 name/description/instructions/contextRevision；Schedule schema 剥离未知字段；Prompt revision 剥离未知字段，group update 则拒绝未知字段。未知字段透传不等于可存储任意字段。
- Project `instructions:''` 清空指令。可选 contextRevision 不匹配返回 409；本次审计的 update 方法仅在 instructions 实际变化时递增 revision，metadata-only 修改不递增。文件操作也可影响上下文版本。因此它是上下文修订保护，**不是 name/description 的通用 CAS**；MCP 不自动读取或补填它。项目文件操作是独立端点，本轮不新增工具。
- Skill expectedVersion 和 Schedule expectedConfigRevision 继续由调用者显式提供；冲突不自动重试覆盖。Schedule 更新仍可触发上游 preflight、重算 nextRunAt、影响在途执行。create 不调用 run-now；enabled=true 可安排未来执行。
- Agent 的 map/数组按上游替换，model_parameters 的旧浅合并已移除。审批 UUID 不自动生成/旋转；tools 可触发上游 options reconciliation。详见 [Agent 专项语义](AGENT-CONFIGURATION.md)。不要把 Agent 的替换规则推断为所有资源所有嵌套对象的存储规则。
- HTTP 200 不证明所有意图都生效；需要时显式 get 实际状态。保留现有 Prompt requireResource 业务失败识别、当前 Agent 顶层 history 裁剪及统一凭据脱敏。权限/default-version 工具既有读回保持；开放配置写入没有新增读回。

## Prompt group 创建为何保留 typed schema

审计 LibreChat `8ba662e1110bd1154bd415a6647bec5eca9cfc79`：`packages/api/src/prompts/service.ts::createPromptGroup` 只严格验证 prompt，group 仅检查存在/name；`packages/data-schemas/src/methods/prompt.ts::createPromptGroup` 将 group 展开到数据库查询及 `$setOnInsert`。author/authorName 来自认证用户，productionId 由服务设置，owner ACL 独立授予；但不能因此把任意 group 对象视作普通配置数据。

因此只保留创建 group 的既有 name/oneliner/category/command schema，不以数据库键黑名单替代。未来需先为上游创建 group 增加明确业务验证，才能安全移除此例外。本轮没有修改上游，也没有证明或宣称鉴权绕过。

权限/公开性、Skill 绑定与用户激活、Schedule 启停/立即执行、Prompt production、附件、项目归属、会话标题/归档/置顶/删除及读查询仍是 typed 操作合同，不是待移除的配置字段镜像。独立 generic api_request 保持原行为，不用作自动兜底。

## 通用 JSON 边界

同一个 `src/tools/json-config.ts` 校验所有上述开放对象，不改变共享 registry 或其他工具 schema：

- plain object 根（支持 null prototype）；允许 create/config/prompt `{}` 交上游验证，changes 必须非空。根数组/null 不允许。
- 根深度 0，最大 32；最多 10,000 个访问值（含根/容器/叶子，共享对象按出现次数计）；每个开放对象的序列化 UTF-8 最大 1,048,576 字节，包含 key/标点/转义。**不是整个请求 body/envelope 的预算**，不含另外加入的控制字段。
- 仅 JSON scalar、有限 number、密集数组、plain object；拒绝循环、undefined/function/BigInt/symbol、非有限数、Date/class、Proxy、访问器、非枚举属性、稀疏/附加属性数组。描述符遍历不执行配置内 getter/toJSON，不修改输入。
- 任意层级 `__proto__` 明确拒绝，避免 Zod record 静默丢键；constructor/prototype 作为普通数据保留。不向原型合并。
- 先检查节点/深度，再增量计入精确转义字节，不先分配巨大完整 JSON 字符串。SDK 广告是非递归 object + additionalProperties，无递归 `$ref`；错误固定且不回显配置。

这些是已解析配置的边界，不是 HTTP 解码前预算、任意 JS 执行 sandbox 或数据库授权证明。特别是外层 SDK 对象解析不承诺拦截直接注入的恶意 JS getter；实际协议输入为 JSON。

## Conversation 迁移

移除 `librechat_conversations_create`，无别名/自动 fallback。当前 `/api/convos/update` 使用 `packages/api/src/conversations/rename.ts`：不存在的 ID 返回 404，保存显式 noUpsert；新 UUID 无法创建空会话。限定检查未发现等价的纯 metadata 创建端点，import/fork/duplicate 和聊天执行均不是替代操作。

`conversations_update` 仍为 typed 标题修改，直接单次 POST，不再先 GET；验证返回 ID/title，保留错误/不确定性语义，无通用 CAS。404 不重试为创建。此源码任务没有更改已存平台工具绑定；发布后的绑定迁移需单独执行。

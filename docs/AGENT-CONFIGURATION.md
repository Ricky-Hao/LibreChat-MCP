# Agent 配置透传（v0.5.0 候选发布源码）

本功能纳入 v0.5.0 候选发布源码，尚不代表资产已发布或服务已部署。跨资源统一合同、JSON 边界及完整迁移见 [配置写入合同](CONFIGURATION.md)；当前源码共 56 个工具。本页保留 Agent 特有的替换与审批语义。

## 接口与迁移

```json
{"name":"librechat_agents_create","arguments":{"config":{"provider":"openAI","model":"SYNTHETIC_MODEL","model_parameters":{},"name":"Example"}}}
```

create 现在必须使用 `{config:{...}}`，不再接受旧版平铺的 `{provider,model,...}`。模型名称是示例占位符，请按目标服务选择。业务必需字段由上游定义：审计的 LibreChat `8ba662e1110bd1154bd415a6647bec5eca9cfc79` 中 `agentCreateSchema` 要求 `provider` 和 `model`（schema 允许 model 为 null；不表示任意 provider 都能运行），`model_parameters` 可省略。示例显式给 `{}`；MCP 允许 `config:{}`，由上游报告缺少的业务字段。

```json
{"name":"librechat_agents_update","arguments":{"id":"AGENT_ID","changes":{"tools":["synthetic_mcp_server"],"tool_options":{"synthetic_mcp_server":{"defer_loading":true,"allowed_callers":["direct"],"run_in_background":false}},"instructionsPrompt":null,"subagents":{"enabled":false,"agent_ids":[]}}}}
```

工具 ID 也是合成示例，实际使用目标上游返回的完整 ID。外层参数严格校验，`id` 必须非空并经过 URL 编码；内部 `config` / `changes` 是开放 JSON object，**没有 MCP 可编辑业务字段白名单**。update 的 `changes` 必须非空。

两工具分别固定调用 `POST /api/agents` 和 `PATCH /api/agents/:id`。对象只作为 HTTP body，不会展开成 method/path/header 等请求选项。MCP 不重命名、过滤或补齐业务字段，不自动绑定工具、不清理 options、不生成 UUID；generic `api_request` 仍是独立工具，不受这两个 schema 的限制。

**破坏性迁移点：`model_parameters` 不再 GET→浅合并。** 所有字段按给定对象发送，没有隐式预读或写后验证请求（既有认证握手除外）。如需保留原来的参数，请显式 `agents_get`（默认 expanded，需要 EDIT）读取，再自行构造完整目标 map；不要盲目重发整个 Agent，也不要把脱敏占位值当原始凭据写回。

## 替换、审批及上游调整

- `tool_options`、`model_parameters` 等 map 和数组按上游的顶层替换语义处理，不是递归 patch。省略字段只表示 **MCP 不发送**，不能保证服务端不受其他字段影响。
- `tool_options:{}` 清空配置。`model_parameters:{}` 不再保留旧参数：审计版本的 validator、`sanitizeModelParameters` 和浅层 `removeNullishValues` 都保留这个空对象，DB 更新接收它作为替换值；读取时空对象是否显式显示仍由存储/响应层决定。上游可转换已知数值参数并移除无效、nullish 或空字符串参数。
- `changes.tools` 即使没有 options，也可能触发上游权限/caller reconciliation。新 MCP 工具可能被过滤；缺少 `execute_code` 或相关能力时，`code_execution` caller 可被移除。**`allowed_callers:[]` 在审计版本运行时回退为 direct，不表示禁止调用。** MCP 不模拟这些规则。
- `approval_mode` / `approval_revision` 原样传递。revision 是可选、由客户端生成的 UUID epoch，不是 Agent CAS，也不是已经授予权限的凭证。保留现有审批绑定时应保留存储的 revision；任务明确要求更改审批策略时可提供新的 UUID。MCP 不自动生成、旋转或删除它。上游 `chat/always` 缺少 revision 时不能形成可记忆的 grant binding。
- `instructionsPrompt:null` 按上游合同解链；链接对象由上游验证权限/可解析性。有效链接存在时，提供的 inline `instructions` 可能不参与运行时指令；只读的 restricted stub 不是合法写入链接。
- `subagents`、skills、未来业务字段都可提交，但上游仍决定合法结构、引用权限和实际效果。`agents_set_skills` 保留为原来的薄封装；不复制新的 Prompt/subagent/approval 专用工具。
- 未知业务字段可能被上游 schema 剥离。HTTP 200 和返回当前 Agent 不代表每个请求字段都被应用；有验证需求时显式调用 `agents_get` 检查可见的实际状态。MCP 不做请求/响应字段差异推断或隐藏 readback。
- 没有通用 CAS、跨 Agent 事务或并发覆盖保护。一次 PATCH 可以同时提交一个 Agent 的 tools/options，但两 Agent 的修改不是一个原子事务。开放 JSON 不意味着支持任意数据库操作符、projection 或鉴权绕过。

上游依据（相邻 LibreChat checkout 内）：`packages/api/src/agents/validation.ts` 的 `agentCreateSchema/agentUpdateSchema`；`api/server/controllers/agents/v1.js` 的 create/update handlers；`packages/data-schemas/src/methods/agent.ts::updateAgent`；`packages/data-provider/src/agentToolOptions.ts::removeCodeExecutionCaller`；`packages/api/src/tools/classification.ts::buildToolRegistryFromAgentOptions`；`client/src/hooks/Agents/useMCPToolOptions.ts::withApprovalModes`；`packages/api/src/agents/hitl/modes.ts::resolveAgentToolGrantBinding`。

## 通用 JSON 输入边界

Agent 使用统一的 [通用 JSON 边界](CONFIGURATION.md#通用-json-边界)：深度 32、10,000 值、每个配置对象序列化 UTF-8 1 MiB，`__proto__` 明确拒绝。create config 可为空，changes 非空；SDK 外层严格、内层开放且非递归。

## 输出与验证边界

继续返回上游 HTTP 状态及当前 Agent，仅裁剪顶层 `versions`，嵌套同名字段和 `approval_revision` 不裁剪；历史仍通过 `agents_versions` 显式读取。原有输出凭据脱敏保持，日志只包含工具名、耗时、最终结果，不记录配置正文；这不是任意正文的通用 DLP。

测试使用本地合成上游与真实 SDK；实际字段接受/拒绝仍由目标 LibreChat 决定。此源码任务没有调用生产 API，也没有修改真实 Agent/Skill 绑定或权限。发布历史见 [STATUS](STATUS.md)，迁移记录见 [CHANGELOG](CHANGELOG.md)。

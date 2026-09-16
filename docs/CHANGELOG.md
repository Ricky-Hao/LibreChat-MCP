# Changelog

## v0.3.1 — Agent 当前状态响应精简

v0.3.0 安装包/镜像不包含此 MCP 层优化。此版本经授权发布安装包及镜像，不部署、不修改生产 Agent 或触发真实任务。发布验证记录见 [STATUS.md](STATUS.md)。

### 默认响应变化

- `agents_get`（basic / expanded）、`agents_create`、`agents_update`、`agents_set_skills` 从成功返回的当前 Agent 对象 `response.data` 中移除顶层 `versions` 历史数组。
- 保留已存在的 `version`、`id`、`_id`、`updatedAt`、当前 instructions/tools/skills/model_parameters 以及其他原有字段。不计算或补造上游未返回的 version；上游 create 通常没有该标量字段。
- 仅匹配带有效字符串 id、versions 数组且无 error/message 错误标记的当前 Agent。缺少历史、错误、空值和非预期结构原样经过既有处理；不新增业务成功判断或错误解释。
- 使用浅拷贝，不修改上游响应及嵌套对象。不递归删除同名字段：用户配置中的 version/versions、Skill version/expectedVersion、Schedule configRevision/expectedConfigRevision、Prompt 版本列表及 productionId 均不受影响。
- `agents_versions` 仍显式返回完整上游历史。未增加 includeVersions：专用工具已覆盖历史读取，也避免暗示普通 GET 能返回上游未提供的历史。通用 `api_request` 保持原样。
- 工具返回值在统一 MCP 序列化之前精简；当前 server 只生成 text content，不生成 structuredContent，因此不存在另一份未精简的结构化输出。

### 不变的行为与兼容性

请求路径、载荷、权限、HTTP 状态、错误和重试语义、写操作次数不变。没有为裁剪添加上游请求；model_parameters 更新原有的合并预读仍保留。仅减少 MCP 输出，不删除服务端历史或改变存储/版本生成。

依赖这些常规工具 `data.versions` 的调用者需要改用 `librechat_agents_versions`。当前状态及输入 schema 保持兼容；agents_get 在上游已经排除历史时输出不变。Agent 列表、删除及其他资源工具未增加裁剪。

### 核查依据

当前 MCP 基线为 `172d1a1` / v0.3.0，原 `src/tools/agents.ts` 直接返回 HTTP client 结果，没有响应字段筛选。

固定上游 `21a9edbe7481fd4de180b45922a2468fdcf79ea3`：

- `packages/data-schemas/src/methods/agent.ts:766–775`：GET 使用 getAgentWithVersionCount，计算 version 后 project 排除 versions。basic / expanded controller 见 `api/server/controllers/agents/v1.js:961–1033`。
- `packages/data-schemas/src/methods/agent.ts:703–729`、controller `:904–936`：create 建立初始历史，201 返回 Agent，没有该响应裁剪或标量 version 补充。
- model `:1071–1102`、controller `:1366–1387`：PATCH 返回含历史的 Agent，controller 根据历史长度设置 version；Skill 配置走同一 PATCH。
- model `:745–759`、controller `:1050–1062`：显式 versions 接口返回历史数组。

这是源码核查，不是生产环境验证。

### 本地验证及字节数示例

本地 `npm run check`、`npm test`（35/35）、`npm run build`、`git diff --check` 均通过。测试仅使用本地 mock，没有调用真实上游。

`test/agent-responses.test.ts` 新增 4 组 mock/协议测试，覆盖四个常规工具（两个 GET 形式）、历史存在/缺失、create 不补造 version、显式历史读取、嵌套同名配置、既有请求载荷/次数、其他资源版本字段、错误/空/非预期响应、冻结对象和共享引用不被修改。

合成 30 个包含长中文指令的历史版本，通过真实 MCP 调用比较未经裁剪的通用 PATCH 结果与相同 PATCH 的 agents_update 结果。对整个 MCP 工具结果（包含序列化的 text content）计算 UTF-8 JSON 字节数：

| 未裁剪 | 精简后 | 字节减少 |
|---:|---:|---:|
| 459,013 B | 488 B | 99.89% |

仅说明此合成 fixture 的序列化响应体缩减，不代表真实 Agent 的固定比例，也不是 token、延迟、内存或性能测量。

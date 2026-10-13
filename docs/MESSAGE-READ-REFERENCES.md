# Message analysis references

## Usage semantics

LibreChat `packages/api/src/agents/usage.ts` aggregates **captured emitted usage events**, not message count. `metadata.usage.input` is the normalized noncached input portion; cache read and cache creation/write are separate. Subset-cache providers subtract cached tokens from raw input; additive-cache providers keep separately reported cache portions. Output uses provider-aware recovery where total-minus-input reveals missing reasoning output, without counting additive cache as output. Cost is emitted only when captured events have complete cost coverage. Historical writers sometimes converted missing/invalid values to zero; readers cannot recover that lost uncertainty.

Coverage depends on primary, forwarded subagent and summarization sinks reaching the aggregate. Collected usage/billing and `tokenCount` differ: `recordCollectedUsage` returns first-primary input and primary-plus-summarization output for message accounting, excluding subagent/hidden sequential output in that return; older BaseClient paths may count text instead. `summaryTokenCount` and `summaryUsedTokens` measure summary/context accounting, not additional independent response bills. `contextUsage` is a context-window snapshot, not aggregate billed usage; its tool/instruction subsets must not be summed twice.

Detached child usage can be persisted separately. Adding parent and child rollups blindly can double-count forwarded usage. External OpenCode usage is **not implied included**. Missing/partial fields remain unknown; stored totals do not establish coverage of every model call.

No reliable persisted LLM request/completion count is available from these rollups. Message, step, tool and run IDs are not substitute counters. `run_tools_with_bash` is one stored top-level PTC tool call; its inner telemetry is best-effort/live-session only (`callbacks.js`, `client/src/store/ptc.ts`), not a durable execution ledger. A static manifest or script does not prove inner calls executed. No `N−1` LLM-savings claim is made: direct calls can also run concurrently. Durable per-call events with idempotent IDs and coverage markers remain a separate telemetry proposal.

## Gateway evidence

Historical read-only specialist evidence reported on 2026-10-13 identifies agentgateway image `ghcr.io/agentgateway/agentgateway:v1.5.0`, imageID `sha256:b9cdf753d7dbc7a574dd8bf55f8300a48663ba83357e61e8ffc9f1bb19ccd4b9`. Anonymous OCI metadata identifies version `v1.5.0` and revision `fe6732474a96a0363dfb9822859af4e9bab360fa`, matching the public GitHub tag. At that observation, LibreChat MCP runtime was `0.3.1`, imageID `sha256:1f58d2f44c479a50f4e4a0c4e23a9e950295129d1a946e2da3bc90a295c0c2b6`, and the new APIs were not deployed. The v0.4.0 release candidate/source implementation does not update this historical observation; publication and deployment status require separate verification.

At the matched source revision:

1. [Streamable HTTP upstream](https://github.com/agentgateway/agentgateway/blob/fe6732474a96a0363dfb9822859af4e9bab360fa/crates/agentgateway/src/mcp/upstream/streamablehttp.rs): JSON-success responses call `response_buffer_limit`, then `to_bytes_with_decompression`, then parse `ServerJsonRpcMessage`.
2. [Decompression](https://github.com/agentgateway/agentgateway/blob/fe6732474a96a0363dfb9822859af4e9bab360fa/crates/agentgateway/src/http/compression/mod.rs): decoded bytes are limited; `LimitExceeded` displays `body exceeded buffer limit`. Compression does not bypass this limit.
3. [Buffer policy](https://github.com/agentgateway/agentgateway/blob/fe6732474a96a0363dfb9822859af4e9bab360fa/crates/http/src/lib.rs): a response `BufferLimit` extension overrides `DEFAULT_BUFFER_LIMIT = 2_097_152`.

The legacy chain returns a Mongo full-message array, wraps it as MCP text JSON, then buffers the MCP HTTP JSON response in the gateway. A count-limited page can contain one giant tool body. The bounded chain projects metadata/descriptors/selected fields before a measured upstream response, then applies MCP backstops.

The observed configuration source has no buffer/maxBytes override, but a mounted configuration is not proof of in-memory loaded policy. **Effective incident threshold, actual failed-response extensions and failed payload size remain unmeasured; the original incident was not reproduced.** The matched source default supports the mechanism, not a measured incident threshold. `-32603` is a JSON-RPC internal-error code, not HTTP. Display truncation remains a separate unproven explanation. The synthetic 2 MiB buffer demonstrates the mechanism, not production reproduction. This redesign reused supplied evidence; it performed no runtime inspection or credential access.

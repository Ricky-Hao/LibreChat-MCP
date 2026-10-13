# Bounded message analysis

The v0.4.0 release candidate/source implementation provides three read-only tools requiring the paired LibreChat v2 API. Original source baselines: LibreChat `78e40464e4df7f36f1110e7258de54f47259c8e5`, MCP `0ac84637d6eafddcc5a25520176d65f66a720243`; these are not implementation commits. Publication and deployment status are verified separately.

For the upstream rationale, complete LibreChat patch manifest, writer audit, implementation-commit lookup and future-port runbook, see `docs/mcp-message-reads-patch.md` in the paired LibreChat checkout (`../LibreChat/docs/mcp-message-reads-patch.md` from this repository root when checked out as siblings). This checkout-relative pointer does not depend on a particular published branch.

## Tools

Names have the `librechat_` prefix. All schemas reject unknown fields. **Continue every operation with only `{cursor}`**; mixing cursor with start parameters is invalid. Defaults apply only on start.

| Tool | Start parameters | Result |
|---|---|---|
| `messages_list` | `conversationId`; optional `messageId`, `timeField`, `from`, `to`, `direction`, `limit`, `includeContext` | `{conversationId,observability,items,nextCursor}`; lists additionally state `consistency:"live"` |
| `messages_content` | `conversationId` + `messageId` **or** `ref`; optional `kind:"all"\|"tools"`, `ancestry`, `limit` | `{ref,ancestry,items,nextCursor}`; `text:true` when root text exists |
| `messages_read` | `ref`; `field:"text"\|"entry"\|"args"\|"output"` (default `entry`); `index` required except for text; optional `maxBytes` | `{representation,offsetBytes,data,complete,nextCursor}` |

`messages_list` defaults: `timeField:createdAt`, `direction:asc`, `limit:25`, `includeContext:false`. `messageId` selects zero or one item after authorization; it cannot be combined with time/order/page-size parameters. Listing preserves all stored branches and parents. `from` is inclusive and `to` exclusive. Timestamp+message-ID ordering uses simple collation and millisecond precision. A live list is not snapshot isolation: updates to its ordering field can move rows during traversal.

Every successful list response—including exact-message, empty and cursor-only results—returns `conversationId` once at page level. It also returns `observability:{llmRequests:"not_recorded",ptcInnerCalls:"not_recorded"}` once: reliable durable per-call counts are not persisted, not that analysis is unsupported. Stored usage may be absent or incomplete; these markers are never numeric counts. Identity and observability are included in the complete serialized response budget. UTC timestamps require seconds and accept no fraction or 1–3 fractional digits, with `Z`; MCP and upstream enforce the same syntax.

`messages_content` scans at most `limit` stored indices per query (default 25, maximum 100). Tool filtering can return an empty page with a continuation. Descriptors contain stored identity/status/timing fields, indices and available body fields; **no body-length computation or body serialization** occurs during discovery. Stored tool records are not a lifecycle journal. Repeated tool-call IDs are distinguished by scope and stored index.

Stored names use direct `tool_call.name`, then `function.name`, then `code_interpreter.name` when the preceding name is missing. No code-interpreter name is invented. Names over 512 UTF-8 bytes are marked in `omittedFields`; read the public entry to recover the stored name. The tool catalog describes initial-call requirements and ref/index/kind/ancestry/time selectors directly.

A page has one signed `ref` for its message revision and ancestry. Use it for body reads or child discovery. A descriptor with `children:{ancestry:[...],omitted:true}` requires an explicit `messages_content` call with that ancestry. A nested reference cannot move outside its existing ancestry prefix. Message text is root-only. Neither descriptors nor entry reads recursively expand children; private durable child threads remain unavailable.

MCP returns **one text content item containing the result JSON**, without HTTP status/data wrappers, protocol version fields or a duplicate structured payload. Errors use `isError:true` and `{error:{code,message}}`.

## Example

```json
{"name":"librechat_messages_list","arguments":{"conversationId":"CONVERSATION_ID","timeField":"updatedAt","from":"2026-10-01T00:00:00.000Z","to":"2026-10-02T00:00:00.000Z","includeContext":true}}
{"name":"librechat_messages_content","arguments":{"conversationId":"CONVERSATION_ID","messageId":"MESSAGE_ID","kind":"tools"}}
{"name":"librechat_messages_read","arguments":{"ref":"RETURNED_REF","field":"output","index":3,"maxBytes":8192}}
{"name":"librechat_messages_read","arguments":{"cursor":"RETURNED_NEXT_CURSOR"}}
{"name":"librechat_messages_content","arguments":{"ref":"RETURNED_REF","ancestry":[3]}}
```

Concatenate `data` at consecutive `offsetBytes` until `complete:true`/`nextCursor:null`. Offsets are UTF-8 bytes of the representation, before outer JSON escaping—not codepoints, UTF-16 units or model tokens. Strings, including JSON-looking strings, use `representation:"utf8"`. Objects, arrays, numbers, booleans and null use `"json"`; parse only the complete concatenation. Total byte lengths are intentionally omitted. If a requested segment cannot fit the next codepoint, restart with a larger `maxBytes`.

The existing connection-credential redactor still applies. If body data contains the connection's own secrets, redaction can change data relative to upstream offsets; exact reconstruction is not promised for such redacted payloads. BSON may already have replaced malformed Unicode before storage.

## Projections and measurements

Metadata includes stored message/parent IDs, timestamps, sender/user/model/endpoint identity, public `thread_id`, `finish_reason`, `unfinished`, `error`, `tokenCount`, `summaryTokenCount`, and safe `metadata.usage`/`summaryUsedTokens`. Absent values remain absent; a finish reason is not interpreted as proof of completeness. Private trace IDs and bodies are excluded by the database projection.

`includeContext:true` adds the measuring-only context projection, indicated once by `contextProjection:"measurements"`: context budget, instruction/pruning/remaining counts, calibration/cache/completed/resumed/retained counts, and allowlisted context breakdowns. Unknown/private context keys are excluded. It is a context-window snapshot, not another bill.

Measurement leaves preserve null, booleans, finite numbers, numeric strings up to 64 characters, and `unknown|not_recorded|unsupported`. Safe unknown usage keys/nesting are retained within depth 8/node 128 limits; arrays require every retained element to be safe. Credential/config-like keys, arbitrary prose and invalid types are omitted, with nonempty `omittedFields` identifying affected measurements. Missing is never replaced with zero. These are stored, unverified measurements, not normalized or complete accounting. See [usage semantics](MESSAGE-READ-REFERENCES.md#usage-semantics).

`entry` is an explicit **public projection**, identified by `projection:"public-entry"`, `nestedContentOmitted:true`, `unlistedFieldsOmitted:true`. It includes display text/think and public annotations, steer/quotes, error/phase/call IDs, display reasoning/activity/summary fields, summary text and boundary, agent/group/step and inline-subagent correlation, public media references, and tool identity/args/output/timing/status/executor. Function/code-interpreter bodies and public background-task status are supported. Claim/wakeup internals, unlisted/private/auth/config fields, attachment collections and nested bodies are excluded before driver materialization where structurally possible. Malformed scalar leaves receive a bounded error rather than a raw export.

## Consistency and access

**Writer-maintained revision consistency**: references/cursors bind document incarnation, `__v` (missing distinguished from zero), timestamp and relevant status. Normal save/edit/record/import/settlement paths increment `__v`; background claim pre-stamp/acquire/confirm/release also increment it atomically. There are no global mutation hooks or data migrations.

An unchanged message can be traversed exactly even when completion was not recorded. Supported content-writer updates—including same-millisecond writes—and delete/recreate stale prior content references and continuations. Claim writes can conservatively invalidate a reference even when the visible body is unchanged. Revision and selected data come from the **same single-document aggregation**, not a preflight read.

**Arbitrary raw database writes changing neither revision nor timestamp are outside this guarantee.** No whole-message content hash is computed. Completion status does not make a row immutable. There is no cross-request database snapshot or ownership lock until delivery.

Every call rechecks authentication, conversation ownership, explicit user/tenant/message scope, retention and private-child restrictions. Signed HMAC tokens are not bearer authorization. They contain selectors, effective limits, revision and continuation positions, but no bodies or credentials. Tokens expire after the configured lifetime; newly issued continuations get a fresh lifetime. Invalid, tampered, expired or cross-principal tokens fail safely. Cursor parameters cannot override token scope.

## HTTP and cost model

Three JWT-authenticated GET routes: `/api/message-reads/list`, `/content`, `/read`. HTTP advertises `x-librechat-message-reads: 2`, uses internal `schemaVersion:2`, and sets `Cache-Control: private, no-store`. Missing/incompatible capability fails `BOUNDED_READ_UNSUPPORTED`; there is **no full-message fallback**.

| Configuration under `messageReads` | Default | Allowed |
|---|---:|---:|
| `responseBytes` | 65,536 | 4,096–65,536 |
| `bodyBytes` | 16,384 | 256–32,768 |
| `pageSize` | 25 | 1–100 |
| `tokenTtlSeconds` | 3,600 | 60–86,400 |

Requests may reduce `maxBytes` to 1, but may not exceed configured `bodyBytes`. Complete serialized UTF-8 HTTP responses, including escaping and tokens, are measured before sending. MCP enforces 65,536 decoded HTTP bytes and a 262,144-byte complete post-redaction JSON-RPC envelope. These are ceilings, not advertised per-row constants. No gateway buffers are increased.

- **Metadata:** positive Mongo projection; context fields are not selected without opt-in. Historical usage objects can still be large before their measuring projection is applied in Node.
- **Descriptors:** Mongo evaluates a bounded source-index window at fixed numeric ancestry and returns only descriptors. Giant args/output/descendant arrays are not hydrated in Node; no exact body-size scan occurs.
- **Strings:** Mongo `$substrCP` returns at most `maxBytes+1` codepoints before driver materialization. Node trims by UTF-8 bytes and final wire budget. Signed cursors carry codepoint position plus byte offset. Mongo still reads the document and seeks through the string; this is not a constant-time database operation or an end-to-end memory bound.
- **Structured values/public entries:** only the selected field or positively projected entry is returned, then serialized in Node for each segment. This retains an O(selected-value-size) memory/serialization cost per request. It does not load unrelated siblings or nested transcripts. No generic JSON streaming engine or cache service is introduced.

Errors: `INVALID_REQUEST`, `INVALID_CURSOR` (400), `NOT_FOUND`, `FIELD_NOT_RECORDED` (404), `STALE_CURSOR` (409), `ITEM_TOO_LARGE`, `UNSUPPORTED_CONTENT` (422), `UNAVAILABLE` (503). Restart stale/expired traversals; never append mismatched revisions. Logs contain tool name, duration and final outcome only.

Independent `messages_search`, generic `api_request` and browser-facing `/api/messages` APIs remain available; **they are not the bounded analysis path**. Dedicated full-message MCP readers and superseded reader aliases/routes are absent.

## Verification

Synthetic tests exercise production database methods, real handlers/validation, router wiring and MCP HTTP transport. After building both workspaces:

```sh
LIBRECHAT_SOURCE_ROOT=../LibreChat node --import tsx --test test/bounded-upstream.integration.ts
```

The optional A/B schema harness also accepts `MESSAGE_READ_BASELINE_DIR` pointing to preserved first-design source artifacts. It compares serialized schema bytes, not model tokens or latency; historical artifacts are not required for the HTTP contract test above. [Recorded results](STATUS.md) and the paired LibreChat maintenance guide retain the live-test gaps. Publication/deployment is verified separately; implementation checks did not include a production real-message retest. Earlier Lighthouse `NO_FCP` is retained; no valid performance audit or live incident reproduction is claimed. [Gateway evidence](MESSAGE-READ-REFERENCES.md#gateway-evidence) is separately documented.

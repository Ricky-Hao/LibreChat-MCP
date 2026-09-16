# Delivery status

## v0.3.1

- Response-only Agent history trimming in get/create/update/set-skills; explicit agents_versions and generic requests remain unchanged. No additional upstream requests, input schema changes or storage mutations.
- Preserves current version/configuration, nested version fields, diagnostics and original response objects. Other resources were audited but not changed in this release.
- Local type-check, 35 mock/protocol tests and build passed. Synthetic 30-version MCP response: 459,013 → 488 UTF-8 JSON bytes (99.89% reduction for that fixture, not a token/performance claim). See CHANGELOG.md.
- No live LibreChat/Gateway integration, production Agent changes or task execution.

## v0.3.0

- Adds `userAgent` JSON configuration with the requested Windows Edge/Chrome 153 default. Applied to internal refresh calls and all API requests/replays; explicit generic-request User-Agent overrides only that request.
- SSE `event: error` is an application failure even with HTTP 200: parse incrementally, preserve/redact error data, cancel reading and never retry that stream error. Normal SSE/text remains unchanged.
- Adds 16 tools: Conversation list/get/metadata-only create/title update/archive/pin/single deletion, paged/full message reads and Meili message search; Chat Project CRUD and explicit conversation assignment/unlink.
- Audited pinned routes and model behavior: title-upsert creation needs no model call; message paging can skip ties; full reads preserve branches; project deletion unlinks rather than deleting chats. APIs are authenticated-user scoped, not cross-user administrator access.
- Local type-check, all 31 mock/protocol tests and build pass. Actual deployment UA acceptance, SSE, search backend and new resource lifecycle remain unverified.

## Implemented

- Independent TypeScript HTTP API client, JSON config, npm CLI/library exports.
- 56 MCP tools covering Skills/files/user activation, Agents/Skill bindings/history, Schedules/cron/run-now, Prompt groups/versions/defaults, Conversations/messages/search, Chat Projects/assignment, sharing/public visibility and unrestricted generic requests.
- Streamable HTTP (stateless JSON responses), stdio, optional downstream bearer, anonymous internal HTTP by default.
- Source-verified Skill and Schedule revision fields, Prompt append/default semantics, named/public ACL updates with read-back.
- v0.2.0: refreshToken-only config, in-memory JWT bootstrap, one replay after explicit 401, concurrent refresh coalescing across HTTP POSTs, atomic rotated-cookie persistence and graceful shutdown drain. No network/5xx or refresh-exchange retries. Output redaction includes old/new access and refresh tokens.
- Locked npm dependencies, non-root Docker, CI and GitHub Release / GHCR workflows; npm registry publication optional.
- README, current scope and pinned API capability matrix.

## Local validation

- `npm run check`, `npm run build`: passed.
- `npm test`: 35 grouped tests passed, including 4 Agent response-projection groups, User-Agent forwarding, 3 SSE cases, 5 Conversation/Message groups, Chat Project mapping and 8 refresh/persistence/concurrency/shutdown cases. Covers config, generic forwarding, credentials/redirects, 401/403/404/409/429/500, interrupted/timeout writes, cancellation between dependent requests, key CRUD/merge/version/permission semantics, pagination, MCP HTTP + stdio initialize/discover/call and protocol errors. Mocks do not prove live ACLs, database cascades or Meili indexing.
- `npm pack --dry-run`: passed locally; CI/release also packed the artifact. Package allowlist includes built code/docs/example, excludes local configuration/tests/source/dev caches. Built-bundle discovery verified 56 unique tools without an upstream connection.
- `docker build -t librechat-mcp:0.2.0 .`: passed on Node 22. Real container smoke with a mock upstream verified refresh-only bootstrap, UID 1000 runtime, atomic cookie save with 0600 permissions, and restart using the saved rotated cookie. Both containers/temp files removed. Default config path is `/config/config.json`, requiring a writable directory mount.
- Installed the published v0.3.0 `.tgz` in an isolated temporary prefix; version and CLI executable passed. Public v0.3.0 image pulled without Docker credentials; health, real HTTP MCP initialize/discovery of 56 tools, version and UID 1000 verified. No upstream requests; temporary container/config/install directories removed.
- Historical v0.2.0 container smoke with synthetic configuration: health check, real MCP initialization and discovery of all 40 tools passed; runtime UID verified as 1000. Container and temporary files removed afterward.
- Remote CI/release results are recorded in the delivery report rather than treated as live upstream integration.

## Not implemented / intentionally out of scope

- No Schedule sharing API exists in the audited resource ACL model.
- No generic Agent/Prompt enable/disable API or Prompt in-place content update; Prompt content changes append a version.
- No cross-user Conversation/Project admin bypass, chat generation/send, message-body editing, bulk conversation clear, Project archive/sharing or synthetic search pagination. Empty Conversation creation intentionally uses the pinned title-upsert, not an invented create-only endpoint.
- No standalone tools for every advanced Agent field, duplicate/revert/avatar, Skill archive import, or arbitrary binary downloads. Use the generic request where its JSON/text contract fits; attachment uploads support utf8/base64.
- No M2M/OpenID management-auth setup or refresh, JWT signing/decoding identity claims, login/password storage, Secret-file loader or manual-config hot reload.
- No cross-process refresh coordination; use one process/replica per refresh session. Library factories without an explicit persistence callback are in-memory only; CLI always provides it.
- Stateless HTTP cancellation notifications on separate POSTs are not routed across MCP instances; disconnect cancellation and stdio SDK cancellation are supported.
- No endpoint policies, read-only/delete/share/run gates, multi-user identity mapping, gateway deployment, Kubernetes manifests, database, UI, or multi-version compatibility layer (maintainer's revised scope).

## Not verified against a live target

- Actual LibreChat refresh-cookie/JWT acceptance, feature flags, tenant/ACL decisions, external storage, sync, cron engine or real resource lifecycle.
- Agent Gateway / Kubernetes integration and network isolation.
- Compatibility with dev commits newer than `21a9edbe7481fd4de180b45922a2468fdcf79ea3`.
- No production business resources were created, edited, deleted, shared or triggered.

## Published v0.3.0

- Source/tag commit: `f3b4e955bf51dcaa973f7c7b125e388afe034a91`; tag `v0.3.0`. The unreleased v0.2.1 UA fix was folded into this expanded feature release.
- [CI](https://github.com/Ricky-Hao/LibreChat-MCP/actions/runs/35046452711) and [Release workflow](https://github.com/Ricky-Hao/LibreChat-MCP/actions/runs/35046527088): passed, including all 31 tests and Node 22 Docker build.
- [Release package](https://github.com/Ricky-Hao/LibreChat-MCP/releases/tag/v0.3.0) downloaded anonymously and installed; SHA-256 matches GitHub's asset digest: `5c32c957cfc38f98cbbfb9b5d389a3aaf144b8cd52e423050a9ef2280522f94d`.
- Public `ghcr.io/ricky-hao/librechat-mcp:0.3.0` / `latest` published. Anonymous versioned pull, runtime UID 1000, health, MCP initialization/version and discovery of all 56 tools verified.
- Image digest: `sha256:1d30b33eaa3ca33825b7eba5854e459a9a66aceba8328fad4997426173c9303a`.
- Existing v0.2.0 refreshToken configuration remains valid; userAgent is optional/defaulted. Retain writable configuration directory and single-replica operation; restart to load changes. NPM_TOKEN was not configured, so npm registry publication was skipped.
- No live LibreChat/Gateway integration or production resource mutations were performed.

## Published v0.2.0

- Source/tag commit: `9768c452b4047b86ae8307d21aca2a44d05255a7`; tag `v0.2.0`.
- [CI](https://github.com/Ricky-Hao/LibreChat-MCP/actions/runs/35000905404) and [Release workflow](https://github.com/Ricky-Hao/LibreChat-MCP/actions/runs/35001017271): passed, including all 21 tests and Docker build.
- [Release package](https://github.com/Ricky-Hao/LibreChat-MCP/releases/tag/v0.2.0) downloaded and installed in an isolated prefix; CLI passed. SHA-256 matches the published asset: `0cbec284b5e9749f34d9a05dc2cb4d2545550eec73847f98d63e028658af5faa`.
- Public `ghcr.io/ricky-hao/librechat-mcp:0.2.0` / `latest` published; anonymous pull of 0.2.0 verified with an empty Docker login configuration.
- Image digest: `sha256:5300816e08f54a48c46c9c8b86cac4d3629f04780db790e7d30da3a424c229ca`.
- Breaking config change: remove jwt; require refreshToken. JWT stays in memory, only refreshToken is written back. Mount a writable directory, use a single replica per session. No production/test-deployment LibreChat requests were made by this development session.

## Published v0.1.0 (historical)

- Code commit: `2e18a22da077af8bb54e662303a17faced8f58a6`; tag `v0.1.0`.
- [GitHub CI](https://github.com/Ricky-Hao/LibreChat-MCP/actions/runs/34994727566): passed, including tests, package and Docker build.
- [Release workflow](https://github.com/Ricky-Hao/LibreChat-MCP/actions/runs/34994839905): passed.
- [GitHub Release](https://github.com/Ricky-Hao/LibreChat-MCP/releases/tag/v0.1.0): npm `.tgz` uploaded, downloaded again, SHA-256 verified and installed in a temporary prefix; CLI executed successfully. Download first and install the local tarball (some npm environments disallow remote URL installs).
- `ghcr.io/ricky-hao/librechat-mcp:0.1.0` and `latest` published. Pulled `0.1.0` with an empty Docker auth configuration, confirming public/anonymous access.
- Image digest: `sha256:03874d4790083c7acadd85c3138aad5e8a5e5abaac9c5ae1c44a5bfe360ff6a8`.
- **npm registry not published**: no `NPM_TOKEN` configured. GitHub Release package installation works without it.
- CI emitted non-fatal deprecation notices for actions using the Node 20 action runtime (runner executes them on Node 24). All steps succeeded; the application/container runs on Node 22.

# Delivery status

## v0.5.0 release-candidate source — transparent resource configuration

- Agent create uses `{config}` and update uses `{id,changes}` with strict outer arguments and open bounded JSON objects. No editable business-field whitelist; upstream validation/authorization remains authoritative.
- Removes the hidden model_parameters GET/shallow merge. No automatic approval revision generation, tools/options cleanup or readback; existing current-Agent history trimming and redaction remain.
- Skill/Project/Schedule configuration and Prompt revision payloads use the same bounded JSON validator. Mandatory Skill/Schedule outer controls remain; Prompt group creation keeps its strict metadata boundary until upstream validates it before query construction.
- Current catalog **56**: unsupported conversations_create removed, existing-only rename no longer pre-reads. No chat execution fallback or stored platform binding edits. Project instructions/contextRevision supported; no general Project metadata CAS claim.
- [Unified migration and JSON limits](CONFIGURATION.md), [Agent-specific semantics](AGENT-CONFIGURATION.md). Package/server version is now **0.5.0** for local release preparation, separate from released/deployed v0.4.0. Git publication, release assets/images and deployment remain for the coordinator to perform and verify. No production API or real resource/platform binding mutations occurred in this preparation. Historical sections below describe their original release snapshots.

## v0.4.0 source implementation — bounded message reading

- Three dedicated tools: `messages_list`, `messages_content`, `messages_read`; **57 source tools total**. Paired `/api/message-reads` v2 routes are required; browser APIs remain intact. No dedicated full-reader aliases.
- Mongo projections return metadata, bounded descriptor windows or one selected field. Strings are substring-projected before driver materialization. Structured fields retain per-selected-value serialization cost. Writer-maintained revisions fence supported updates; unversioned raw DB writes are explicitly outside the guarantee.
- Final narrow review: **117 affected cases passed** (74 bounded API/actual-router, 41 MCP, 2 compiled-source HTTP/schema cases). Prior 206 message/privacy-method and background passing evidence is reused; overlapping historical runs are not summed. List pages now carry conversation identity and explicit unavailable-count observability once, and catalog descriptions explain initial selectors and UTC precision.
- Synthetic reader discovery: **10 tools / 10,313 UTF-8 bytes → 3 tools / 3,876 bytes**, using actual SDK `tools/list` output with final descriptions. Giant fixture: legacy HTTP 3,970,485 bytes; maximum bounded upstream HTTP 22,279, MCP HTTP 32,721, descriptor DB result 457, string-window DB result 20,972 bytes across 248 bounded requests. These are fixture byte measurements, not token/latency savings.
- [Current contract](BOUNDED-MESSAGE-READS.md) and [usage/gateway evidence](MESSAGE-READ-REFERENCES.md). Supplied evidence identifies gateway v1.5.0 / revision `fe6732474a96a0363dfb9822859af4e9bab360fa`; incident threshold/payload remain unmeasured.
- Package/image publication is recorded [below](#published-v040); no production deployment or real-message retest was performed. Earlier Lighthouse `NO_FCP` is retained, not rerun, and establishes no performance acceptance. The paired LibreChat maintenance guide is linked at its immutable patch commit below; task reports remain historical evidence.

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

## Historical v0.3.1 baseline — implemented

- Independent TypeScript HTTP API client, JSON config, npm CLI/library exports.
- 56 MCP tools covering Skills/files/user activation, Agents/Skill bindings/history, Schedules/cron/run-now, Prompt groups/versions/defaults, Conversations/messages/search, Chat Projects/assignment, sharing/public visibility and unrestricted generic requests.
- Streamable HTTP (stateless JSON responses), stdio, optional downstream bearer, anonymous internal HTTP by default.
- Source-verified Skill and Schedule revision fields, Prompt append/default semantics, named/public ACL updates with read-back.
- v0.2.0: refreshToken-only config, in-memory JWT bootstrap, one replay after explicit 401, concurrent refresh coalescing across HTTP POSTs, atomic rotated-cookie persistence and graceful shutdown drain. No network/5xx or refresh-exchange retries. Output redaction includes old/new access and refresh tokens.
- Locked npm dependencies, non-root Docker, CI and GitHub Release / GHCR workflows; npm registry publication optional.
- README, current scope and pinned API capability matrix.

## Historical baseline — local validation

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
- No cross-user Conversation/Project admin bypass, chat generation/send, message-body editing, bulk conversation clear, Project archive/sharing or synthetic search pagination. Current upstream rename is existing-only; the formerly advertised empty Conversation creation has been removed in v0.5.0 candidate source.
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

## Published v0.4.0

Coordinator-verified publication evidence recorded on 2026-10-13. This documentation update is subsequent to the release; it is not the tag's source commit.

- **MCP source/tag:** [`30327ed6408778dedbb61897eb899aa186ae69b8`](https://github.com/Ricky-Hao/LibreChat-MCP/commit/30327ed6408778dedbb61897eb899aa186ae69b8); unique lightweight tag `v0.4.0`, independently matched through Git and API. [GitHub Release](https://github.com/Ricky-Hao/LibreChat-MCP/releases/tag/v0.4.0) is published, non-draft and non-prerelease.
- **Paired LibreChat patch:** [`8ba662e1110bd1154bd415a6647bec5eca9cfc79`](https://github.com/Ricky-Hao/LibreChat/commit/8ba662e1110bd1154bd415a6647bec5eca9cfc79), pushed to `rickyhao/dev`. [Immutable maintenance/porting guide](https://github.com/Ricky-Hao/LibreChat/blob/8ba662e1110bd1154bd415a6647bec5eca9cfc79/docs/mcp-message-reads-patch.md) includes the 18-file semantic patch manifest, writer audit and future-upstream runbook. This is the implementation commit; the earlier `78e40464` baseline is not.
- **CI failure retained:** initial feature `a24591ec1aa5aaee48712e481cd8f1f2f5ff276d` failed [CI run 38363336101, attempt 1](https://github.com/Ricky-Hao/LibreChat-MCP/actions/runs/38363336101/attempts/1) after successful `npm ci`: the two explicit integration tests statically imported unbuilt `dist` modules, causing TS2307 during check. Earlier local passes had prebuilt dist and were not clean-checkout evidence. The two-file fix in `30327ed` uses runtime compiled imports with source types; a fresh archive reproduced the original failure, then passed check/41 tests/build/pack and two compiled integration tests locally on Node 24.
- **Successful remote workflows:** [Node 22 CI run 38363850359, attempt 1](https://github.com/Ricky-Hao/LibreChat-MCP/actions/runs/38363850359/attempts/1) completed successfully, including Docker build; [Release run 38364214773, attempt 1](https://github.com/Ricky-Hao/LibreChat-MCP/actions/runs/38364214773/attempts/1) completed successfully. These results supersede the pending remote Node 22 check, not the retained failure history.
- **Release asset:** [`ricky-hao-librechat-mcp-0.4.0.tgz`](https://github.com/Ricky-Hao/LibreChat-MCP/releases/download/v0.4.0/ricky-hao-librechat-mcp-0.4.0.tgz), 56,081 bytes, asset ID `636285796`; SHA-256 `185b024ad66b73975d16a607b1c4cc4d4d849ad6df983e6c474fa871ffb336de`. Anonymous download checksum matched the API digest. Isolated `npm install --ignore-scripts` succeeded; the installed package's actual SDK handshake reported version `0.4.0`, 57 tools, exactly three readers, old two readers absent, and zero upstream network requests.
- **MCP image:** anonymous manifest verification found `ghcr.io/ricky-hao/librechat-mcp:0.4.0` and `:latest` at `sha256:c5a6c513b9cfca8265a6245d1d86c3edd1440164999d0382ae424cb034a7477b`, matching the workflow build digest. Manifest/config and verified package-layer inspection confirmed `linux/amd64`, configured user `node`, package name `@ricky-hao/librechat-mcp` and version `0.4.0`. Local Docker was unavailable: this is **not** a container-executed smoke test, image pull/run or health verification.
- **LibreChat image:** [`rickyhao-dev-image.yml` run 38363321682, attempt 1](https://github.com/Ricky-Hao/LibreChat/actions/runs/38363321682/attempts/1) completed successfully. Anonymous GHCR manifest checks for tags `sha-8ba662e1110bd1154bd415a6647bec5eca9cfc79` and `rickyhao-dev` both returned `sha256:231ff6a5e80dd5056df5f8bff064e25650f51e63f189abec3d821d13e4dc8cfb`; selected `linux/amd64` config had `org.opencontainers.image.revision` equal to the paired patch SHA. Moving-tag digests here describe the verification time, not a promise about future `latest`/`rickyhao-dev` values.
- **npm registry skipped:** [Release job 115185346194](https://github.com/Ricky-Hao/LibreChat-MCP/actions/runs/38364214773/job/115185346194) reported `NPM_TOKEN` not configured. GitHub asset/GHCR publication does not imply npm registry publication.
- **Remaining gaps:** no production deployment, real-message retest or new live gateway/retention/authorization evidence; historical Lighthouse `NO_FCP` still provides no performance acceptance. `npm ci` reported one high-severity audit finding, separate from the TypeScript failure; it was not diagnosed or upgraded in this scope, and dependencies are not claimed vulnerability-free. Structured-field per-selected-value memory/serialization cost and supported-writer revision limitations remain as documented above. This publication-recording turn changes documentation only; code, tests, permissions and bindings are unchanged.

## Published v0.3.1

- Source/tag commit: `12c20db628e00cb7f7872069f4765d9f24c384fa`; tag `v0.3.1`.
- [CI](https://github.com/Ricky-Hao/LibreChat-MCP/actions/runs/35060578746) and [Release workflow](https://github.com/Ricky-Hao/LibreChat-MCP/actions/runs/35060636736): passed, including 35 tests, package and Node 22 Docker build.
- [Release package](https://github.com/Ricky-Hao/LibreChat-MCP/releases/tag/v0.3.1) downloaded anonymously, SHA-256 checked against GitHub's asset digest, installed in an isolated prefix, and CLI/version verified. SHA-256: `a6f71ecae46957710970fe58650ddfcdebf1edae2ab9175e856782c5e2915686`.
- Public image `ghcr.io/ricky-hao/librechat-mcp:0.3.1` / `latest` published; versioned anonymous pull verified. Digest: `sha256:1f58d2f44c479a50f4e4a0c4e23a9e950295129d1a946e2da3bc90a295c0c2b6`.
- Published-container smoke passed against a loopback-only synthetic upstream: health, MCP version/56 tools, UID 1000, PATCH history trimming, explicit history retrieval, nested configuration preservation, one PATCH per call, refresh bootstrap and atomic rotated-cookie save with mode 0600. Temporary container/config/install directories removed. The initial fixture's host UID/umask permissions were corrected before the successful smoke run; no application fix was needed.
- npm registry publication skipped because NPM_TOKEN was not configured. No production deployment, real Agent mutations or task execution. Other resource responses remain unchanged; only the Agent optimization is included.

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

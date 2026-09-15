# Delivery status

## Implemented

- Independent TypeScript HTTP API client, JSON config, npm CLI/library exports.
- 40 MCP tools covering Skills/files/user activation, Agents/Skill bindings/history, Schedules/cron/run-now, Prompt groups/versions/defaults, sharing/public visibility, unrestricted generic requests.
- Streamable HTTP (stateless JSON responses), stdio, optional downstream bearer, anonymous internal HTTP by default.
- Source-verified Skill and Schedule revision fields, Prompt append/default semantics, named/public ACL updates with read-back.
- v0.2.0: refreshToken-only config, in-memory JWT bootstrap, one replay after explicit 401, concurrent refresh coalescing across HTTP POSTs, atomic rotated-cookie persistence and graceful shutdown drain. No network/5xx or refresh-exchange retries. Output redaction includes old/new access and refresh tokens.
- Locked npm dependencies, non-root Docker, CI and GitHub Release / GHCR workflows; npm registry publication optional.
- README, current scope and pinned API capability matrix.

## Local validation

- `npm run check`, `npm run build`: passed.
- `npm test`: 21 focused tests passed, including 8 refresh/persistence/concurrency/shutdown cases. Covers config, generic forwarding, credentials/redirects, 401/403/404/409/429/500, interrupted/timeout writes, cancellation between dependent requests, key CRUD/merge/version/permission semantics, pagination, MCP HTTP + stdio initialize/discover/call and protocol errors.
- `npm pack`: passed; package allowlist includes built code/docs/example, excludes local configuration/tests/source/dev caches.
- `docker build -t librechat-mcp:0.2.0 .`: passed on Node 22. Real container smoke with a mock upstream verified refresh-only bootstrap, UID 1000 runtime, atomic cookie save with 0600 permissions, and restart using the saved rotated cookie. Both containers/temp files removed. Default config path is `/config/config.json`, requiring a writable directory mount.
- Installed the packed `.tgz` in an isolated temporary directory; CLI executable passed.
- Started the Docker container with synthetic configuration: health check, real MCP initialization and discovery of all 40 tools passed; runtime UID verified as 1000. Container and temporary files removed afterward.
- Remote CI/release results are recorded in the delivery report rather than treated as live upstream integration.

## Not implemented / intentionally out of scope

- No Schedule sharing API exists in the audited resource ACL model.
- No generic Agent/Prompt enable/disable API or Prompt in-place content update; Prompt content changes append a version.
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

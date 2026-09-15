# Delivery status

## Implemented

- Independent TypeScript HTTP API client, JSON config, npm CLI/library exports.
- 40 MCP tools covering Skills/files/user activation, Agents/Skill bindings/history, Schedules/cron/run-now, Prompt groups/versions/defaults, sharing/public visibility, unrestricted generic requests.
- Streamable HTTP (stateless JSON responses), stdio, optional downstream bearer, anonymous internal HTTP by default.
- Source-verified Skill and Schedule revision fields, Prompt append/default semantics, named/public ACL updates with read-back.
- No automatic retries or token refresh. Uncertain write errors; 401 rotation guidance; output credential redaction; metadata-only stderr logs.
- Locked npm dependencies, non-root Docker, CI and GitHub Release / GHCR workflows; npm registry publication optional.
- README, current scope and pinned API capability matrix.

## Local validation

- `npm run check`, `npm run build`: passed.
- `npm test`: 13 focused tests passed. Covers config, generic forwarding, credentials/redirects, 401/403/404/409/429/500, interrupted/timeout writes, cancellation between dependent requests, key CRUD/merge/version/permission semantics, pagination, MCP HTTP + stdio initialize/discover/call and protocol errors.
- `npm pack`: passed; package allowlist includes built code/docs/example, excludes local configuration/tests/source/dev caches.
- `docker build -t librechat-mcp:0.1.0 .`: passed on Node 22, non-root runtime.
- Installed the packed `.tgz` in an isolated temporary directory; CLI executable passed.
- Started the Docker container with synthetic configuration: health check, real MCP initialization and discovery of all 40 tools passed; runtime UID verified as 1000. Container and temporary files removed afterward.
- Remote CI/release results are recorded in the delivery report rather than treated as live upstream integration.

## Not implemented / intentionally out of scope

- No Schedule sharing API exists in the audited resource ACL model.
- No generic Agent/Prompt enable/disable API or Prompt in-place content update; Prompt content changes append a version.
- No standalone tools for every advanced Agent field, duplicate/revert/avatar, Skill archive import, or arbitrary binary downloads. Use the generic request where its JSON/text contract fits; attachment uploads support utf8/base64.
- No M2M management-auth setup, JWT signing/decoding identity claims, login/password storage/refresh, Secret-file loader or credential hot reload.
- No endpoint policies, read-only/delete/share/run gates, multi-user identity mapping, gateway deployment, Kubernetes manifests, database, UI, or multi-version compatibility layer (maintainer's revised scope).

## Not verified against a live target

- Actual LibreChat JWT acceptance, feature flags, tenant/ACL decisions, external storage, sync, cron engine or real resource lifecycle.
- Agent Gateway / Kubernetes integration and network isolation.
- Compatibility with dev commits newer than `21a9edbe7481fd4de180b45922a2468fdcf79ea3`.
- No production business resources were created, edited, deleted, shared or triggered.

## Published v0.1.0

- Code commit: `2e18a22da077af8bb54e662303a17faced8f58a6`; tag `v0.1.0`.
- [GitHub CI](https://github.com/Ricky-Hao/LibreChat-MCP/actions/runs/34994727566): passed, including tests, package and Docker build.
- [Release workflow](https://github.com/Ricky-Hao/LibreChat-MCP/actions/runs/34994839905): passed.
- [GitHub Release](https://github.com/Ricky-Hao/LibreChat-MCP/releases/tag/v0.1.0): npm `.tgz` uploaded, downloaded again, SHA-256 verified and installed in a temporary prefix; CLI executed successfully. Download first and install the local tarball (some npm environments disallow remote URL installs).
- `ghcr.io/ricky-hao/librechat-mcp:0.1.0` and `latest` published. Pulled `0.1.0` with an empty Docker auth configuration, confirming public/anonymous access.
- Image digest: `sha256:03874d4790083c7acadd85c3138aad5e8a5e5abaac9c5ae1c44a5bfe360ff6a8`.
- **npm registry not published**: no `NPM_TOKEN` configured. GitHub Release package installation works without it.
- CI emitted non-fatal deprecation notices for actions using the Node 20 action runtime (runner executes them on Node 24). All steps succeeded; the application/container runs on Node 22.


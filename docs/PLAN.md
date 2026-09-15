# Implementation plan — revised scope

## Confirmed with the maintainer

The initial plan was committed as `b903cea` before implementation. The maintainer then revised the scope; this document supersedes its policy-heavy defaults.

- Existing **public** repository `Ricky-Hao/LibreChat-MCP`; keep its name and visibility.
- Small trusted-intranet administrator tool, not a public multi-user service.
- Skills, Agents with Skill bindings, Scheduled Tasks / Cron, Prompt library, visibility/sharing where upstream actually supports it, and run-now.
- All implemented operations available immediately; no read-only mode, policy engine, method/path allowlist or delete/share/run feature gates.
- Generic tool forwards requests, including unknown future API routes. It has no administrative restrictions. Configured upstream JWT is only attached to the configured origin; no automatic redirects or retries.
- JSON configuration containing `baseUrl` and literal `jwt`; no credential-file indirection, login or refresh. Restart to reload.
- Streamable HTTP without authentication by default; optional separate downstream bearer and stdio.
- npm CLI/package, GitHub Release package, Docker image. No Gateway implementation, Kubernetes deployment, UI, database or multi-version compatibility framework.
- Focused mock/protocol tests, not exhaustive defensive test suites. No production test resources.

## Upstream reference

Official `danny-avila/LibreChat` `dev` was fetched and pinned for this implementation at `21a9edbe7481fd4de180b45922a2468fdcf79ea3`. Source was read from a git archive of that commit, not a customized working tree. This is the source reference, not a promise of perpetual or multi-version compatibility. Generic requests cover unwrapped API changes; normal code updates can track dev as needed.

## Implementation

1. Initial route/capability audit and plan committed before code — done.
2. Audit user JWT, source restrictions, updates, prompt versions, cron and ACL API — done; see API-MATRIX.md.
3. Minimal independent client + config + semantic tool modules + HTTP/stdio entrypoint — done.
4. Focused request-mapping and MCP protocol tests — done.
5. Build/package/container validation and distribution workflows — see STATUS.md.

The authorization remains development/testing/distribution only, not production LibreChat mutations or Gateway deployment. Never commit JWTs, local config, client secrets or production responses.

# Implementation plan

## Scope and authorization

- Repository: existing public `Ricky-Hao/LibreChat-MCP`; owner explicitly approved retaining name and visibility. No secrets or production data.
- Working directory: `/home/ricky/git/LibreChat-MCP`.
- Target: official `danny-avila/LibreChat` `dev`, pinned to `21a9edbe7481fd4de180b45922a2468fdcf79ea3`. Confirmed using upstream remote and `ls-remote`; inspected an archive of this commit, not the neighboring customized working trees.
- No production API writes, deployment, Gateway changes or business test resources authorized. Mock tests by default. Gateway integration remains unverified.

## Sequence

1. Commit this plan and initial capability matrix before implementation.
2. Audit route mounts, authentication, input validators, services and model concurrency/deletion behavior; finish matrix with evidence.
3. Build standalone TypeScript API client, credentials, URL/body limits, operation policy and safe audit/error handling.
4. Add semantic resource tools and restricted generic tools using official MCP SDK Streamable HTTP. No chat, database access, login or identity impersonation.
5. Test mock mappings and real MCP initialization/discovery/calls/protocol errors, security boundaries, timeouts and uncertain writes.
6. Deliver locked dependencies, non-root Docker, Kubernetes examples, authentication/rotation instructions, tested/unsupported/unverified inventory.

## Initial safety decisions

- Require separate downstream bearer secret; all callers share the single upstream user's permissions. Network isolation and TLS termination required in deployment.
- Upstream JWT preferably loaded from mounted file, never a tool input. No JWT decoding as authentication, no refresh/login. Fail closed on missing credentials.
- Default read-only; separate opt-ins for writes, generic writes, deletions, activation and known side-effecting reads. Run-now and sharing remain blocked unless explicitly implemented and audited.
- Route AND payload rules shared by generic and dedicated operations. No arbitrary-origin forwarding, redirects, sensitive input headers, arbitrary binary proxy or automatic retries.
- GET `/api/skills` may synchronize GitHub skills. GET `/api/schedules` retries deferred deletion. These are not treated as pure reads.
- Honest results: preserve upstream versions/conflicts, distinguish policy denial, upstream failure, response size rejection and uncertain mutation. No fake CAS or fabricated success.

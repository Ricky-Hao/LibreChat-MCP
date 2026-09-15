# LibreChat API capability matrix

Target: [`danny-avila/LibreChat@21a9edbe7481fd4de180b45922a2468fdcf79ea3`](https://github.com/danny-avila/LibreChat/tree/21a9edbe7481fd4de180b45922a2468fdcf79ea3) (official `dev`). This is a pinned source audit, NOT a live integration certification. No target HTTP or Gateway integration tests have run.

Initial audit, before implementation. All MCP tools and tests are pending at this commit. Paths below are observed in source, not guessed from docs. Detailed field/response/policy findings will be expanded during implementation.

| Resource | Verified method/path | Authentication and access | Contract / concurrency / side effects | MCP status |
|---|---|---|---|---|
| Skills | GET, POST `/api/skills`; GET, PATCH, DELETE `/api/skills/:id` | User JWT, SKILLS USE/CREATE; VIEW/EDIT/DELETE resource ACL; tenant-aware dependencies | List `category/search/limit/cursor` → `skills,has_more,after`; detail includes `version`; PATCH requires positive `expectedVersion`, 409 includes `current`; create grants owner, not public | Planned. List may trigger GitHub sync: default blocked |
| Skill attachments | GET, POST `/api/skills/:id/files`; GET, DELETE `/api/skills/:id/files/*relativePath` | User JWT + resource VIEW/EDIT | Upload multipart `file,relativePath`; GET JSON content (binary may omit content); cached content may be written upstream; deletion includes asynchronous storage cleanup | Planned limited text support; no binary proxy |
| Management Skills | GET `/api/agents/v1/skills`, GET/PATCH `/:id`, GET files, PUT file | `requireAgentManagementAuth`, mounted before user JWT middleware | Separate authentication; cannot assume user JWT accepted | Not exposed |
| Agents | GET, POST `/api/agents`; GET, PATCH, DELETE `/:id`; GET `/:id/expanded`, `/:id/versions` | User JWT; AGENTS USE/CREATE; VIEW for basic, EDIT for expanded/history/update, DELETE for delete | PATCH validates partial payload; no general client CAS observed. Server may reconcile legacy/tool settings on edits | Planned verified field subset; unrelated request fields never replayed |
| Schedules | GET, POST `/api/schedules`; GET, PATCH, DELETE `/:id`; POST `/:id/run` | User JWT; SCHEDULES USE/CREATE; owner-scoped; agent VIEW, file/project ownership and policy checks | `cadence` structured or cron; IANA timezone; create requires `clientRequestId`, upstream defaults enabled=true (adapter will force false); update `expectedConfigRevision`; list `schedules,limits`, no pagination | Planned. List retries deferred deletion: default blocked; run never implicit |
| Prompt groups | GET `/api/prompts/groups`, GET/PATCH/DELETE `/api/prompts/groups/:groupId`; POST `/api/prompts` | User JWT; PROMPTS USE/CREATE; group VIEW/EDIT/DELETE ACL | Cursor list `limit/cursor/name/category`; creation body `{group,prompt}`; deletion is group-wide | Planned; no sharing in generic metadata updates |
| Prompt versions | GET `/api/prompts?groupId=...`; GET/DELETE `/api/prompts/:promptId`; POST `/api/prompts/groups/:groupId/prompts`; PATCH `/api/prompts/:promptId/tags/production` | User JWT; permission checked through group | Append new version, NOT overwrite history. Production-tag update is separate; version delete requires `groupId` query | Planned; no invented in-place version PATCH |
| Skill activation | GET/POST `/api/settings/skills/active` | User JWT | User preference separate from skill body; replace/merge semantics under audit | Pending audit |
| Sharing | Access-permissions subsystem | Separate ACL mutation and permission policy | Never part of create/body update | Not exposed initially |
| Generic API | Only audited method/path/payload combinations | Same upstream user AND same adapter policy as dedicated tools | Deny-by-default; GET not automatically safe; read/write tools separated | Planned |

## Evidence map

All source paths relative to the pinned upstream tree:

- Mounts: `api/server/index.js`, `api/server/routes/agents/index.js`.
- Skills: `api/server/routes/skills.js`, `api/server/services/Skills/handlers.js`, `api/server/services/Skills/sync.js`, `packages/api/src/skills/handlers.ts`, `packages/data-schemas/src/methods/skill.ts`.
- Alternate authentication: `api/server/routes/agents/middleware.js`, `api/server/routes/agents/skills.js`.
- Agents: `api/server/routes/agents/v1.js`, `api/server/controllers/agents/v1.js`, `packages/api/src/agents/validation.ts`.
- Schedules: `api/server/routes/schedules.js`, `packages/data-provider/src/types/schedules.ts`, `packages/api/src/schedules/handlers.ts`, `packages/api/src/schedules/cadence.ts`.
- Prompts: `api/server/routes/prompts.js`, `packages/api/src/prompts/schemas.ts`, `packages/api/src/prompts/format.ts`, `packages/data-schemas/src/methods/prompt.ts`.
- Skill state: `api/server/routes/settings.js`, `api/server/controllers/SkillStatesController.js`.

Remaining audit: exact safe Agent field subset and skill binding model, prompt version/default/delete behavior, source-based Skill write rejection, active-state replacement and tenant enforcement, returned shapes and deletion cascades. No claim of complete support until these are recorded.

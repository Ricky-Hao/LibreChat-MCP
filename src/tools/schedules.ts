import { z } from 'zod';
import { id, text, segment, type Tools } from './common.js';
import { jsonConfigSchema } from './json-config.js';

const controls = ['enabled', 'clientRequestId', 'expectedConfigRevision'];
const revision = z.number().int().min(0).describe('configRevision from schedules_get');

export const schedulesTools: Tools = (tool, api) => {
  tool('schedules_list', 'List all schedules owned by the JWT user and scheduling limits; no pagination. Upstream also retries deferred deletions. Does not start a task.', {},
    () => api.request({ path: '/api/schedules' }), false);
  tool('schedules_get', 'Read a schedule, configRevision, timezone, nextRunAt and in-flight state.', { id },
    ({ id }) => api.request({ path: `/api/schedules/${segment(id)}` }), true);
  tool('schedules_create', 'Create a scheduled chat; disabled unless enabled=true is explicit. clientRequestId identifies this create intent: reuse the same value and payload after uncertain results. No immediate run.', {
    config: jsonConfigSchema(false, controls).describe('Upstream Schedule config, e.g. name/prompt/agent_id/cadence/timezone. Operation controls belong outside config.'),
    clientRequestId: text.trim().min(1).max(128), enabled: z.boolean().default(false),
  }, ({ config, clientRequestId, enabled }) => api.request({ method: 'POST', path: '/api/schedules', body: { ...config, clientRequestId, enabled } }));
  tool('schedules_update', 'Patch schedule configuration with revision fencing. Cadence/timezone changes recalculate nextRunAt; upstream may perform MCP preflight and fence an in-flight occurrence. Does not call run-now. Enable/disable separately.', {
    id, expectedConfigRevision: revision, changes: jsonConfigSchema(true, controls).describe('Upstream Schedule changes. No enabled/clientRequestId/expectedConfigRevision inside changes; use outer controls or schedules_set_enabled.'),
  }, ({ id, expectedConfigRevision, changes }) => api.request({
    method: 'PATCH', path: `/api/schedules/${segment(id)}`, body: { ...changes, expectedConfigRevision },
  }));
  tool('schedules_set_enabled', 'Enable or disable a schedule with revision fencing. Enabling arms future executions; disabling is not a guarantee that a live run is aborted.', {
    id, enabled: z.boolean(), expectedConfigRevision: revision,
  }, ({ id, ...body }) => api.request({ method: 'PATCH', path: `/api/schedules/${segment(id)}`, body }));
  tool('schedules_delete', 'Delete a schedule and quiesce runs. HTTP 202 means draining, not fully erased; HTTP 503 may mean deletion is unconfirmed.', { id },
    ({ id }) => api.request({ method: 'DELETE', path: `/api/schedules/${segment(id)}` }));
  tool('schedules_run_now', 'Immediately execute a scheduled chat. This starts a real Agent run, may incur costs and may invoke tools. Not retried automatically.', { id },
    ({ id }) => api.request({ method: 'POST', path: `/api/schedules/${segment(id)}/run` }));
};

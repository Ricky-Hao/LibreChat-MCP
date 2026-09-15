import { z } from 'zod';
import { id, text, segment, nonempty, type Tools } from './common.js';

const cadence = z.union([
  z.strictObject({
    frequency: z.enum(['hourly', 'daily', 'weekdays', 'weekly']),
    hour: z.number().int().min(0).max(23), minute: z.number().int().min(0).max(59),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
  }),
  z.strictObject({ frequency: z.literal('cron'), expression: text.trim().min(1).max(256) }),
]);
const fields = {
  name: text.trim().min(1).max(256), prompt: text.trim().min(1).max(32000),
  agent_id: id, cadence, timezone: text.min(1).describe('IANA timezone, e.g. Asia/Shanghai'),
  target: z.literal('new').optional(), file_ids: z.array(id).max(10).optional(),
  chatProjectId: id.nullable().optional(),
};
const revision = z.number().int().min(0).describe('configRevision from schedules_get');

export const schedulesTools: Tools = (tool, api) => {
  tool('schedules_list', 'List all schedules owned by the JWT user and scheduling limits; no pagination. Upstream also retries deferred deletions. Does not start a task.', {},
    () => api.request({ path: '/api/schedules' }), false);
  tool('schedules_get', 'Read a schedule, configRevision, timezone, nextRunAt and in-flight state.', { id },
    ({ id }) => api.request({ path: `/api/schedules/${segment(id)}` }), true);
  tool('schedules_create', 'Create a scheduled chat; disabled unless enabled=true is explicit. clientRequestId identifies this create intent: reuse the same value and payload after uncertain results. No immediate run.', {
    ...fields, clientRequestId: text.trim().min(1).max(128), enabled: z.boolean().default(false),
  }, (body) => api.request({ method: 'POST', path: '/api/schedules', body }));
  tool('schedules_update', 'Patch schedule configuration with revision fencing. Cadence/timezone changes recalculate nextRunAt; upstream may perform MCP preflight and fence an in-flight occurrence. Does not call run-now. Enable/disable separately.', {
    id, expectedConfigRevision: revision, changes: nonempty(z.strictObject(fields).partial().shape),
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

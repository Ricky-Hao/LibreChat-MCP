import { z } from 'zod';
import type { ApiResponse } from '../client.js';
import { id, objectId, text, page, jsonObject, segment, nonempty, type Tools } from './common.js';

const fields = {
  name: text.optional(), description: text.optional(), instructions: text.optional(),
  provider: text.min(1).optional(), model: text.min(1).optional(),
  model_parameters: jsonObject.optional(), tools: z.array(text).optional(),
  category: text.optional(), conversation_starters: z.array(text).optional(),
  recursion_limit: z.number().int().positive().optional(),
  end_after_tools: z.boolean().optional(), hide_sequential_outputs: z.boolean().optional(),
  artifacts: text.optional(), memory_scope: z.enum(['user', 'agent']).optional(),
};

/** Only the current Agent at response.data; leave nested config and diagnostics intact. */
function currentAgent(response: ApiResponse): ApiResponse {
  const data = response.data;
  if (response.status < 200 || response.status >= 300 || !data || typeof data !== 'object' || Array.isArray(data)) return response;
  const agent = data as Record<string, unknown>;
  if (typeof agent.id !== 'string' || !agent.id || !Array.isArray(agent.versions) || 'error' in agent || 'message' in agent) return response;
  const { versions: _history, ...current } = agent;
  return { ...response, data: current };
}

const currentResponse = ' Returns current Agent state without top-level versions; use agents_versions for history.';

export const agentsTools: Tools = (tool, api) => {
  tool('agents_list', 'List accessible Agents with cursor pagination. Upstream may refresh cached metadata.', {
    ...page, search: text.optional(), category: text.optional(), promoted: z.boolean().optional(),
    requiredPermission: z.number().int().positive().optional(),
  }, ({ promoted, ...query }) => api.request({ path: '/api/agents', query: {
    ...query, ...(promoted !== undefined && { promoted: promoted ? '1' : '0' }),
  } }), false);
  tool('agents_get', 'Read Agent details. expanded=true returns editable configuration and requires EDIT permission.' + currentResponse, {
    id, expanded: z.boolean().default(true),
  }, ({ id, expanded }) => api.request({ path: `/api/agents/${segment(id)}${expanded ? '/expanded' : ''}` }).then(currentAgent), true);
  tool('agents_create', 'Create an Agent with explicit provider/model. Skill binding and public sharing are separate tools.' + currentResponse, {
    ...fields, provider: text.min(1), model: text.min(1),
  }, (body) => api.request({ method: 'POST', path: '/api/agents', body }).then(currentAgent));
  tool('agents_update', 'Patch only supplied Agent fields; model_parameters merges with existing parameters. Arrays replace explicitly. No upstream general CAS; concurrent edits may race. Upstream may reconcile tool permissions.' + currentResponse, {
    id, changes: nonempty(fields),
  }, async ({ id, changes }) => {
    if (changes.model_parameters) {
      const { data } = await api.request<{ model_parameters?: Record<string, unknown> }>({ path: `/api/agents/${segment(id)}/expanded` });
      changes.model_parameters = { ...data.model_parameters, ...changes.model_parameters };
    }
    return api.request({ method: 'PATCH', path: `/api/agents/${segment(id)}`, body: changes }).then(currentAgent);
  });
  tool('agents_set_skills', 'Set Agent Skill catalog configuration. skills replaces the binding list; enabled and scope change only when supplied. scope=selected with [] exposes none, unlike legacy [] which can expose all. No CAS.' + currentResponse, {
    id, skills: z.array(objectId), enabled: z.boolean().optional(), scope: z.enum(['all', 'selected', 'none']).optional(),
    authoringEnabled: z.boolean().optional(),
  }, ({ id, skills, enabled, scope, authoringEnabled }) => api.request({
    method: 'PATCH', path: `/api/agents/${segment(id)}`,
    body: { skills, skills_enabled: enabled, skills_scope: scope, skill_authoring_enabled: authoringEnabled },
  }).then(currentAgent));
  tool('agents_versions', 'Explicitly read Agent configuration history without current-state history trimming; requires EDIT permission.', { id },
    ({ id }) => api.request({ path: `/api/agents/${segment(id)}/versions` }), true);
  tool('agents_delete', 'Delete an Agent. Existing schedules referencing it may be disabled; no delete CAS.', { id },
    ({ id }) => api.request({ method: 'DELETE', path: `/api/agents/${segment(id)}` }));
};

import { z } from 'zod';
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

export const agentsTools: Tools = (tool, api) => {
  tool('agents_list', 'List accessible Agents with cursor pagination. Upstream may refresh cached metadata.', {
    ...page, search: text.optional(), category: text.optional(), promoted: z.boolean().optional(),
    requiredPermission: z.number().int().positive().optional(),
  }, ({ promoted, ...query }) => api.request({ path: '/api/agents', query: {
    ...query, ...(promoted !== undefined && { promoted: promoted ? '1' : '0' }),
  } }), false);
  tool('agents_get', 'Read Agent details. expanded=true returns editable configuration and requires EDIT permission.', {
    id, expanded: z.boolean().default(true),
  }, ({ id, expanded }) => api.request({ path: `/api/agents/${segment(id)}${expanded ? '/expanded' : ''}` }), true);
  tool('agents_create', 'Create an Agent with explicit provider/model. Skill binding and public sharing are separate tools.', {
    ...fields, provider: text.min(1), model: text.min(1),
  }, (body) => api.request({ method: 'POST', path: '/api/agents', body }));
  tool('agents_update', 'Patch only supplied Agent fields; model_parameters merges with existing parameters. Arrays replace explicitly. No upstream general CAS; concurrent edits may race. Upstream may reconcile tool permissions.', {
    id, changes: nonempty(fields),
  }, async ({ id, changes }) => {
    if (changes.model_parameters) {
      const { data } = await api.request<{ model_parameters?: Record<string, unknown> }>({ path: `/api/agents/${segment(id)}/expanded` });
      changes.model_parameters = { ...data.model_parameters, ...changes.model_parameters };
    }
    return api.request({ method: 'PATCH', path: `/api/agents/${segment(id)}`, body: changes });
  });
  tool('agents_set_skills', 'Set Agent Skill catalog configuration. skills replaces the binding list; enabled and scope change only when supplied. scope=selected with [] exposes none, unlike legacy [] which can expose all. No CAS.', {
    id, skills: z.array(objectId), enabled: z.boolean().optional(), scope: z.enum(['all', 'selected', 'none']).optional(),
    authoringEnabled: z.boolean().optional(),
  }, ({ id, skills, enabled, scope, authoringEnabled }) => api.request({
    method: 'PATCH', path: `/api/agents/${segment(id)}`,
    body: { skills, skills_enabled: enabled, skills_scope: scope, skill_authoring_enabled: authoringEnabled },
  }));
  tool('agents_versions', 'Read Agent configuration history; requires EDIT permission.', { id },
    ({ id }) => api.request({ path: `/api/agents/${segment(id)}/versions` }), true);
  tool('agents_delete', 'Delete an Agent. Existing schedules referencing it may be disabled; no delete CAS.', { id },
    ({ id }) => api.request({ method: 'DELETE', path: `/api/agents/${segment(id)}` }));
};

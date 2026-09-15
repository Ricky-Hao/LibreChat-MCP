import { z } from 'zod';
import { objectId, text, page, segment, nonempty, requireResource, readBack, type Tools } from './common.js';
import { ApiError } from '../client.js';

const groupFields = {
  name: text.min(1).max(255), oneliner: text.max(500).optional(), category: text.max(100).optional(),
  command: text.regex(/^[a-z0-9-]*$/).nullable().optional(),
};
const prompt = z.strictObject({ prompt: text.refine((s) => s.trim().length > 0, 'Prompt must not be blank'), type: z.enum(['text', 'chat']) });
const record = (data: unknown): data is Record<string, unknown> => !!data && typeof data === 'object' && !Array.isArray(data);
const hasId = (data: unknown) => record(data) && typeof data._id === 'string';

export const promptsTools: Tools = (tool, api) => {
  tool('prompt_groups_list', 'List Prompt library groups with cursor pagination; not Agent instructions or scheduled prompts.', {
    ...page, name: text.optional(), category: text.optional(),
  }, (query) => api.request({ path: '/api/prompts/groups', query: { limit: 20, ...query } }), true);
  tool('prompt_groups_get', 'Read a Prompt group including its productionId (default version).', { groupId: objectId },
    ({ groupId }) => api.request({ path: `/api/prompts/groups/${segment(groupId)}` }), true);
  tool('prompt_groups_create', 'Create a Prompt group with its initial version. Upstream sets that first version as production/default, without public sharing.', {
    group: z.strictObject(groupFields), prompt,
  }, async (body) => requireResource(await api.request({ method: 'POST', path: '/api/prompts', body }),
    (data) => record(data) && hasId(data.group) && hasId(data.prompt)));
  tool('prompt_groups_update', 'Patch group metadata only. Does not overwrite Prompt content/history, productionId or permissions. No CAS.', {
    groupId: objectId, changes: nonempty(z.strictObject(groupFields).partial().shape),
  }, async ({ groupId, changes }) => requireResource(await api.request({
    method: 'PATCH', path: `/api/prompts/groups/${segment(groupId)}`, body: changes,
  }), hasId));
  tool('prompt_groups_delete', 'Delete a Prompt group, every version and its ACL. No CAS.', { groupId: objectId },
    ({ groupId }) => api.request({ method: 'DELETE', path: `/api/prompts/groups/${segment(groupId)}` }));
  tool('prompts_list', 'List versions in one Prompt group, newest first. Versions are separate documents, not numeric CAS counters. No pagination.', { groupId: objectId },
    async (query) => requireResource(await api.request({ path: '/api/prompts', query }), Array.isArray, false), true);
  tool('prompts_get', 'Read one Prompt version by _id.', { promptId: objectId },
    async ({ promptId }) => requireResource(await api.request({ path: `/api/prompts/${segment(promptId)}` }), hasId, false), true);
  tool('prompts_add_version', 'Update Prompt content by appending a NEW version to its group; never overwrite history. Does not change the production/default version.', {
    groupId: objectId, prompt,
  }, async ({ groupId, prompt }) => requireResource(await api.request({
    method: 'POST', path: `/api/prompts/groups/${segment(groupId)}/prompts`, body: { prompt },
  }), (data) => record(data) && hasId(data.prompt)));
  tool('prompts_set_default', 'Make this version the group’s production/default Prompt and read back the group. No CAS.', { promptId: objectId }, async ({ promptId }) => {
    const { data: prompt } = await api.request<{ groupId: string }>({ path: `/api/prompts/${segment(promptId)}` });
    const result = requireResource(await api.request({ method: 'PATCH', path: `/api/prompts/${segment(promptId)}/tags/production` }),
      (data) => record(data) && data.message === 'Prompt production made successfully');
    const verified = await readBack(result, () => api.request({ path: `/api/prompts/groups/${segment(prompt.groupId)}` }));
    if (!record(verified.current) || verified.current.productionId !== promptId) {
      throw new ApiError('VERIFY_FAILED', 'The group does not currently select this version; inspect concurrent edits before retrying.', result.status, verified.current, true);
    }
    return verified;
  });
  tool('prompts_delete', 'Delete a single version. Deleting the last version also deletes its group/ACL; deleting production selects the newest remaining version.', {
    promptId: objectId, groupId: objectId,
  }, ({ promptId, groupId }) => api.request({ method: 'DELETE', path: `/api/prompts/${segment(promptId)}`, query: { groupId } }));
};

import { z } from 'zod';
import { id, objectId, text, segment, readBack, type Tools } from './common.js';

const resourceType = z.enum(['skill', 'agent', 'promptGroup']);
const resource = {
  resourceType,
  resourceId: objectId.describe('Resource document _id, NOT agent_...; get it from agents_get / skills_get / prompt_groups_get'),
};
const principal = z.strictObject({
  type: z.enum(['user', 'group', 'role']), id,
  name: text.optional(), email: text.optional(), source: z.enum(['local', 'entra']).optional(),
  idOnTheSource: text.optional(),
});
const pathFor = (r: { resourceType: string; resourceId: string }) =>
  `/api/permissions/${r.resourceType}/${segment(r.resourceId)}`;

export const permissionsTools: Tools = (tool, api) => {
  tool('permissions_roles', 'Read available accessRoleIds before granting permissions.', { resourceType },
    ({ resourceType }) => api.request({ path: `/api/permissions/${resourceType}/roles` }), true);
  tool('permissions_get', 'Read sharing principals and public visibility. Requires upstream SHARE permission.', resource,
    (r) => api.request({ path: pathFor(r) }), true);
  tool('permissions_update', 'Grant/change/revoke specified user/group/role permissions without replacing other ACL entries. No CAS; upstream can skip invalid principals, so current read-back is authoritative. Visibility is a separate tool.', {
    ...resource,
    updated: z.array(principal.extend({ accessRoleId: text.min(1) })).default([]),
    removed: z.array(principal.pick({ type: true, id: true })).default([]),
  }, async ({ updated, removed, ...r }) => readBack(
    await api.request({ method: 'PUT', path: pathFor(r), body: { updated, removed } }),
    () => api.request({ path: pathFor(r) }),
  ));
  tool('visibility_set', 'Set public visibility for a Skill, Agent or Prompt GROUP, preserving named shares. public=false removes public access, NOT existing user/group shares. Schedules have no sharing API. Requires upstream SHARE/SHARE_PUBLIC.', {
    ...resource, public: z.boolean(),
    publicAccessRoleId: text.optional().describe('Default for public=true: resource viewer role. Use permissions_roles for other available roles.'),
  }, async ({ public: isPublic, publicAccessRoleId, ...r }) => readBack(
    await api.request({
      method: 'PUT', path: pathFor(r),
      body: { public: isPublic, ...(isPublic && { publicAccessRoleId: publicAccessRoleId ?? `${r.resourceType}_viewer` }) },
    }),
    () => api.request({ path: pathFor(r) }),
  ));
};

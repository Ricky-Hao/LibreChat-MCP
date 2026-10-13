import { z } from 'zod';
import { id, objectId, text, segment, type Tools } from './common.js';
import { jsonConfigSchema } from './json-config.js';

/** Chat Projects, not legacy agent-sharing projects or Agent categories. */
export const projectsTools: Tools = (tool, api) => {
  tool('projects_list', 'List the authenticated user’s Chat Projects. Search matches name/description literally; pagination returns projects and nextCursor. Keep search/sort unchanged across pages.', {
    cursor: text.optional(), limit: z.number().int().min(1).max(100).default(25),
    sortBy: z.enum(['name', 'createdAt', 'lastConversationAt']).optional(),
    sortDirection: z.enum(['asc', 'desc']).optional(), search: text.optional(),
  }, (query) => api.request({ path: '/api/projects', query }), true);
  tool('projects_get', 'Read an owned Chat Project and its stored conversation statistics. Use conversations_list with projectId to read its chats.', { projectId: objectId },
    ({ projectId }) => api.request({ path: `/api/projects/${segment(projectId)}` }), true);
  tool('projects_create', 'Create an owned Chat Project from config JSON. Upstream validates fields and may ignore unknown ones.', {
    config: jsonConfigSchema().describe('Upstream Project config, e.g. name/description/instructions.'),
  }, ({ config }) => api.request({ method: 'POST', path: '/api/projects', body: config }));
  tool('projects_update', 'Send Project changes unchanged. Empty instructions clears them. Optional contextRevision fences context changes, not general metadata edits; no pre-read.', {
    projectId: objectId, changes: jsonConfigSchema(true).describe('Upstream Project changes, including optional contextRevision. Unknown fields may be ignored.'),
  }, ({ projectId, changes }) => api.request({ method: 'PATCH', path: `/api/projects/${segment(projectId)}`, body: changes }));
  tool('projects_delete', 'Delete one owned Chat Project and unlink its conversations; messages, files and conversations remain. Schedules may later disable when their project is missing. Unlink/delete is not transactional; no CAS.', { projectId: objectId },
    ({ projectId }) => api.request({ method: 'DELETE', path: `/api/projects/${segment(projectId)}` }));
  tool('conversations_set_project', 'Assign/move an owned conversation to an owned Chat Project, or explicitly unlink with projectId=null. One project per conversation. Does not create chats or change archive state. No CAS; project-stat updates can fail after membership changed.', {
    conversationId: id.trim().min(1), projectId: objectId.nullable(),
  }, ({ conversationId, projectId }) => api.request({ method: 'PUT', path: `/api/projects/conversations/${segment(conversationId)}`, body: { projectId } }));
};

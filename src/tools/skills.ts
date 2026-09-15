import { z } from 'zod';
import { ApiError } from '../client.js';
import { id, objectId, text, page, segment, nonempty, type Tools } from './common.js';

const fields = {
  name: text.min(1), description: text.min(1), body: text.optional(),
  displayTitle: text.optional(), category: text.optional(), alwaysApply: z.boolean().optional(),
  frontmatter: z.record(z.string(), z.unknown()).optional(),
};
const changes = nonempty(z.strictObject(fields).partial().shape);
const filePath = text.min(1).refine((s) => !s.startsWith('/') && s.split('/').every((p) => p && p !== '.' && p !== '..'), 'Use a relative file path');
const fileUrl = (skillId: string, path: string) => `/api/skills/${segment(skillId)}/files/${path.split('/').map(segment).join('/')}`;

export const skillsTools: Tools = (tool, api) => {
  tool('skills_list', 'List accessible Skills, preserving cursor pagination. Upstream may start GitHub Skill synchronization.', {
    ...page, search: text.optional(), category: text.optional(),
  }, (query) => api.request({ path: '/api/skills', query }), false);
  tool('skills_get', 'Read a Skill including body, source and version.', { id },
    ({ id }) => api.request({ path: `/api/skills/${segment(id)}` }), true);
  tool('skills_create', 'Create a private inline Skill. Sharing and user activation are separate operations.', fields,
    (body) => api.request({ method: 'POST', path: '/api/skills', body }));
  tool('skills_update', 'Patch a Skill using the version from skills_get. A 409 returns current state; never overwrites a conflict.', {
    id, expectedVersion: z.number().int().positive(), changes,
  }, ({ id, expectedVersion, changes }) => api.request({ method: 'PATCH', path: `/api/skills/${segment(id)}`, body: { ...changes, expectedVersion } }));
  tool('skills_delete', 'Delete a Skill, its files and ACL; upstream prunes Agent bindings. Deployment Skills are read-only upstream. No delete CAS.', { id },
    ({ id }) => api.request({ method: 'DELETE', path: `/api/skills/${segment(id)}` }));
  tool('skills_files_list', 'List attachment metadata for a Skill.', { id },
    ({ id }) => api.request({ path: `/api/skills/${segment(id)}/files` }), true);
  tool('skills_file_read', 'Read text attachment content or SKILL.md. Binary/large files may return metadata without content. Upstream may cache text.', {
    id, path: filePath,
  }, ({ id, path }) => api.request({ path: fileUrl(id, path) }), false);
  tool('skills_file_upload', 'Add or replace an attachment using multipart upload. SKILL.md must be edited with skills_update. No file CAS.', {
    id, path: filePath, content: text, encoding: z.enum(['utf8', 'base64']).default('utf8'), mimeType: text.default('text/plain'),
  }, async ({ id, path, content, encoding, mimeType }) => {
    if (path.toUpperCase() === 'SKILL.MD') throw new ApiError('INVALID_INPUT', 'Use skills_update to edit SKILL.md.');
    const form = new FormData();
    form.set('relativePath', path);
    form.set('file', new Blob([new Uint8Array(Buffer.from(content, encoding))], { type: mimeType }), path.split('/').at(-1)!);
    return api.request({ method: 'POST', path: `/api/skills/${segment(id)}/files`, body: form });
  });
  tool('skills_file_delete', 'Delete an attachment and schedule blob cleanup upstream. No file CAS.', { id, path: filePath },
    ({ id, path }) => api.request({ method: 'DELETE', path: fileUrl(id, path) }));
  tool('skills_states_get', 'Read the JWT user’s Skill activation overrides. These are user preferences, not public visibility.', {},
    () => api.request({ path: '/api/settings/skills/active' }), true);
  tool('skills_set_enabled', 'Change one user Skill activation override, preserving other overrides by read/merge/write. Upstream has no CAS; concurrent preference edits can race.', {
    id: objectId, enabled: z.boolean(),
  }, async ({ id, enabled }) => {
    const { data } = await api.request<Record<string, boolean>>({ path: '/api/settings/skills/active' });
    return api.request({ method: 'POST', path: '/api/settings/skills/active', body: { skillStates: { ...data, [id]: enabled } } });
  });
};

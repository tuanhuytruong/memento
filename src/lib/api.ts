import type { AccountOverview, EventTrack, MemoryReaction, PerspectivesPage, TimelineEvent } from '../types';

const API = '/api';

export class ApiError extends Error {
  status: number;
  details?: Record<string, unknown>;

  constructor(message: string, status: number, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });
  const contentType = response.headers.get('content-type') || '';
  let payload: unknown;
  if (response.status !== 204) {
    if (contentType.includes('application/json')) {
      payload = await response.json().catch(() => undefined);
    } else {
      payload = await response.text().catch(() => '');
    }
  }
  if (!response.ok) {
    const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : undefined;
    const message = typeof record?.message === 'string'
      ? record.message
      : typeof record?.error === 'string'
        ? record.error
        : typeof payload === 'string' && payload.trim()
          ? payload
          : `Request failed (${response.status})`;
    throw new ApiError(message, response.status, record);
  }
  return payload as T;
}

function unwrapList<T>(payload: unknown, keys: string[]): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    for (const key of keys) {
      if (Array.isArray(record[key])) return record[key] as T[];
    }
  }
  throw new Error('The server returned an unexpected list response.');
}

function unwrapOne<T>(payload: unknown, keys: string[]): T | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const record = payload as Record<string, unknown>;
  for (const key of keys) {
    if (record[key] && typeof record[key] === 'object') return record[key] as T;
  }
  return payload as T;
}

export interface AuthUser {
  id: string;
  username: string;
}

function requireResource<T>(payload: unknown, keys: string[], label: string): T {
  const resource = unwrapOne<T>(payload, keys);
  if (!resource || typeof resource !== 'object') {
    throw new Error(`The server did not return the saved ${label}.`);
  }
  return resource;
}

export interface ApiTag {
  id: string;
  name: string;
}

export type CollaboratorRole = 'viewer' | 'editor';
export interface TrackCollaborator {
  id: string;
  user_id: string;
  username: string;
  role: CollaboratorRole;
  invited_at: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
}
export interface CollaborationInvitation {
  id: string;
  role: CollaboratorRole;
  invited_at: string;
  expires_at: string;
  owner_username: string;
  track: EventTrack;
}

export const authApi = {
  me: async () => {
    const payload = await request<{ user?: AuthUser }>('/auth/me');
    if (!payload?.user || !payload.user.id || !payload.user.username) {
      throw new Error('The server returned an invalid session.');
    }
    return payload.user;
  },
  login: (username: string, password: string) => request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  }),
  register: (username: string, password: string, inviteCode: string) => request('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password, inviteCode }),
  }),
  logout: () => request('/auth/logout', { method: 'POST' }),
};

export const dataApi = {
  tracks: async () => unwrapList<EventTrack>(await request('/tracks'), ['tracks']),
  createTrack: async (track: Omit<EventTrack, 'id' | 'createdAt' | 'updatedAt'>) =>
    requireResource<EventTrack>(await request('/tracks', { method: 'POST', body: JSON.stringify(track) }), ['track'], 'track'),
  updateTrack: async (id: string, track: Omit<EventTrack, 'id' | 'createdAt' | 'updatedAt'>) =>
    requireResource<EventTrack>(await request(`/tracks/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(track) }), ['track'], 'track'),
  deleteTrack: (id: string) => request(`/tracks/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  trackVisits: async () => unwrapList<{ trackOwnerId: string; trackId: string; lastOpenedAt: string }>(await request('/track-visits'), ['visits']),
  recordTrackVisit: (ownerId: string, trackId: string) =>
    request<{ visit: { trackOwnerId: string; trackId: string; lastOpenedAt: string } }>(`/tracks/${encodeURIComponent(trackId)}/visit`, { method: 'PUT', body: JSON.stringify({ ownerId }) }),
  moments: async () => unwrapList<TimelineEvent>(await request('/moments'), ['moments']),
  // Phase 2: a save is the caller's own bookkeeping. The server is always the
  // authority; the client only reports its intent and rolls back on failure.
  setSaved: (ownerId: string, id: string, active: boolean) =>
    request<{ saved: { ownerId: string; id: string; saved: boolean } }>(`/moments/${encodeURIComponent(id)}/saved`, { method: 'PUT', body: JSON.stringify({ ownerId, active }) }),
  saved: async () => {
    const result = await request<{ saved: { ownerId: string; id: string }[]; count: number }>('/saved');
    return { saved: result.saved, count: result.count };
  },
  // Phase 3: the bounded read. Search text travels in a JSON body, never in a
  // query string, so it cannot end up in a request log.
  // Full-scope summary: counts that must not depend on how many pages the
  // client has loaded.
  overview: () => request<{ overview: AccountOverview }>('/moments/overview'),
  exportSnapshot: async (action: 'start' | 'page' | 'finalize', body: unknown) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = await fetch(`/api/export/${action}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (response.status === 429 && attempt < 3) {
        const wait = Number(response.headers.get('Retry-After'));
        await new Promise(resolve => setTimeout(resolve, Math.min(120, Math.max(1, Number.isFinite(wait) ? wait : 60)) * 1000));
        continue;
      }
      const data = await response.json();
      if (!response.ok) throw new ApiError(data.error || 'Backup unavailable.', response.status);
      return data;
    }
  },
  // Candidate pool for Ngày ấy. The caller supplies its own local calendar day
  // so "on this day" means the day the user is looking at, not a UTC one.
  resurfacingCandidates: (today: string) =>
    request<{ moments: TimelineEvent[] }>('/moments/resurfacing', { method: 'POST', body: JSON.stringify({ today }) }),
  queryMoments: (body: Record<string, unknown>, signal?: AbortSignal) =>
    request<{ moments: TimelineEvent[]; nextCursor: string | null; total?: number; facets?: Record<string, number> }>('/moments/query', { method: 'POST', body: JSON.stringify(body), signal }),
  savedMoments: async ({ limit = 40, cursor }: { limit?: number; cursor?: string } = {}) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set('cursor', cursor);
    const page = await request<{ items: { ownerId: string; id: string; savedAt: string }[]; nextCursor: string | null }>(`/saved/moments?${params}`);
    return page;
  },
  // Exact single-moment read for conflict comparison; same composite identity
  // and authorization boundary as every other moment route.
  moment: async (id: string, ownerId: string) =>
    requireResource<TimelineEvent>(await request(`/moments/${encodeURIComponent(id)}?ownerId=${encodeURIComponent(ownerId)}`), ['moment'], 'moment'),
  perspectives: (momentId: string, ownerId: string, cursor?: string) => {
    const params = new URLSearchParams({ ownerId, limit: '20' });
    if (cursor) params.set('cursor', cursor);
    return request<PerspectivesPage>(`/moments/${encodeURIComponent(momentId)}/perspectives?${params}`);
  },
  createPerspective: (momentId: string, ownerId: string, kind: 'perspective' | 'reflection', body: string, clientRequestId: string) =>
    request<{ perspective: import('../types').MomentPerspective }>(`/moments/${encodeURIComponent(momentId)}/perspectives`, { method: 'POST', body: JSON.stringify({ ownerId, kind, body, clientRequestId }) }),
  updatePerspective: (id: string, body: string, expectedVersion: number) =>
    request<{ perspective: import('../types').MomentPerspective }>(`/perspectives/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ body, expectedVersion }) }),
  deletePerspective: (id: string) => request(`/perspectives/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  exportPerspectives: async () => {
    const all: import('../types').MomentPerspective[] = [];
    let cursor: string | null = null;
    do {
      const params = new URLSearchParams({ limit: '500' });
      if (cursor) params.set('cursor', cursor);
      const page = await request<{ perspectives: import('../types').MomentPerspective[]; nextCursor: string | null }>(`/perspectives/export?${params}`);
      if (!Array.isArray(page.perspectives) || (page.nextCursor !== null && typeof page.nextCursor !== 'string')) throw new Error('The server returned an invalid perspective backup page.');
      all.push(...page.perspectives);
      if (page.nextCursor === cursor && cursor !== null) throw new Error('Perspective backup pagination did not advance.');
      cursor = page.nextCursor;
    } while (cursor);
    return all;
  },
  setReaction: async (momentId: string, ownerId: string, emoji: MemoryReaction['emoji'], active: boolean) => request<{ reactions: MemoryReaction[]; selectedEmojis: string[] }>(`/moments/${encodeURIComponent(momentId)}/reactions`, { method: 'PUT', body: JSON.stringify({ ownerId, emoji, active }) }),
  createMoment: async (moment: Omit<TimelineEvent, 'id' | 'createdAt' | 'updatedAt'>, eventOwnerId: string) =>
    requireResource<TimelineEvent>(await request('/moments', { method: 'POST', body: JSON.stringify({ ...moment, eventOwnerId }) }), ['moment'], 'moment'),
  updateMoment: async (id: string, ownerId: string, moment: Omit<TimelineEvent, 'id' | 'createdAt' | 'updatedAt'>, expectedVersion: number, eventOwnerId: string) =>
    requireResource<TimelineEvent>(await request(`/moments/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ ...moment, ownerId, expectedVersion, eventOwnerId }) }), ['moment'], 'moment'),
  deleteMoment: (id: string, ownerId: string) => request(`/moments/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify({ ownerId }) }),
  tags: async () => {
    const result = unwrapList<unknown>(await request('/tags'), ['tags']);
    return result.map((item) => {
      if (typeof item === 'string') return { id: item, name: item };
      const tag = item as { id?: unknown; tagId?: unknown; name?: unknown; label?: unknown };
      const name = typeof tag.name === 'string' ? tag.name : typeof tag.label === 'string' ? tag.label : '';
      const id = tag.id ?? tag.tagId ?? name;
      return typeof id === 'string' || typeof id === 'number' ? { id: String(id), name } : { id: name, name };
    }).filter((tag) => tag.name);
  },
  createTag: async (name: string) => {
    const payload = await request('/tags', { method: 'POST', body: JSON.stringify({ tag: name }) });
    const tag = unwrapOne<{ id?: unknown; tagId?: unknown; name?: unknown; label?: unknown }>(payload, ['tag']);
    const resultName = typeof tag?.name === 'string' ? tag.name : typeof tag?.label === 'string' ? tag.label : name;
    const id = tag?.id ?? tag?.tagId ?? resultName;
    return { id: String(id), name: resultName };
  },
  deleteTag: (id: string) => request(`/tags/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  collaborators: async (trackId: string) => unwrapList<TrackCollaborator>(await request(`/tracks/${encodeURIComponent(trackId)}/collaborators`), ['collaborators']),
  inviteCollaborator: (trackId: string, username: string, role: CollaboratorRole) => request(`/tracks/${encodeURIComponent(trackId)}/collaborators`, { method: 'POST', body: JSON.stringify({ username, role }) }),
  revokeCollaborator: (trackId: string, userId: string) => request(`/tracks/${encodeURIComponent(trackId)}/collaborators/${encodeURIComponent(userId)}`, { method: 'DELETE' }),
  collaborationInvitations: async () => unwrapList<CollaborationInvitation>(await request('/collaboration-invitations'), ['invitations']),
  acceptCollaborationInvitation: (id: string) => request(`/collaboration-invitations/${encodeURIComponent(id)}/accept`, { method: 'POST' }),
  usernameMatches: async (query: string) => unwrapList<string>(await request(`/users/search?q=${encodeURIComponent(query)}`), ['usernames']),
  uploadImage: async (file: File, momentId: string, ownerId: string, uploadId: string) => {
    const form = new FormData();
    form.append('file', file);
    form.append('momentId', momentId);
    form.append('ownerId', ownerId);
    try {
      return await request('/images', { method: 'POST', headers: { 'Idempotency-Key': uploadId }, body: form });
    } catch (error) {
      if (error instanceof ApiError && error.status === 413) {
        throw new ApiError(`"${file.name}" is too large for upload. Try a smaller photo.`, 413);
      }
      if (error instanceof ApiError && error.status === 415) {
        throw new ApiError(`"${file.name}" is not a supported image (JPEG/PNG/GIF/WebP only).`, 415);
      }
      throw error;
    }
  },
};

export async function loadAccountData() {
  const [tracks, tags, summary] = await Promise.all([dataApi.tracks(), dataApi.tags(), dataApi.overview()]);
  return { tracks, tags, overview: summary.overview };
}

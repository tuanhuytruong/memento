import type { EventTrack, TimelineEvent } from '../types';

const API = '/api';

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
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
    throw new ApiError(message, response.status);
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
  moments: async () => unwrapList<TimelineEvent>(await request('/moments'), ['moments']),
  createMoment: async (moment: Omit<TimelineEvent, 'id' | 'createdAt' | 'updatedAt'>) =>
    requireResource<TimelineEvent>(await request('/moments', { method: 'POST', body: JSON.stringify(moment) }), ['moment'], 'moment'),
  updateMoment: async (id: string, moment: Omit<TimelineEvent, 'id' | 'createdAt' | 'updatedAt'>) =>
    requireResource<TimelineEvent>(await request(`/moments/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(moment) }), ['moment'], 'moment'),
  deleteMoment: (id: string) => request(`/moments/${encodeURIComponent(id)}`, { method: 'DELETE' }),
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
  uploadImage: async (file: File, momentId: string) => {
    const form = new FormData();
    form.append('file', file);
    form.append('momentId', momentId);
    return request('/images', { method: 'POST', body: form });
  },
};

export async function loadAccountData() {
  const [tracks, moments, tags] = await Promise.all([dataApi.tracks(), dataApi.moments(), dataApi.tags()]);
  return { tracks, moments, tags };
}

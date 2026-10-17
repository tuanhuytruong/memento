import type { TimelineEvent } from '../types';
import type { BlindboxIntent, BlindboxResult } from './blindboxMemory';
import { ApiError } from './api';
async function discovery<T>(path: string, body: unknown, signal: AbortSignal): Promise<T> {
  const response = await fetch(`/api/discovery/${path}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  const data = await response.json();
  if (!response.ok) throw new ApiError(data.error || data.message || 'Could not load memories. Please retry.', response.status);
  return data as T;
}
export const requestBlindbox = (intent: BlindboxIntent, query: string, signal: AbortSignal) => discovery<BlindboxResult | null>('blindbox', { intent, query }, signal);
export const requestPostcardPage = (trackKey: string, search: string, cursor: string | null, signal: AbortSignal) => discovery<{ moments: TimelineEvent[]; nextCursor: string | null }>('postcard-picker', { trackKey, search, cursor, limit: 40 }, signal);

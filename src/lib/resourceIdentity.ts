import type { EventTrack, TimelineEvent } from '../types';

export const trackIdentity = (track: Pick<EventTrack, 'id' | 'resourceOwnerId'>) =>
  `${track.resourceOwnerId ?? 'legacy'}:${track.id}`;

export const momentIdentity = (moment: Pick<TimelineEvent, 'id' | 'resourceOwnerId'>) =>
  `${moment.resourceOwnerId ?? 'legacy'}:${moment.id}`;

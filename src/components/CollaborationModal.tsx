import { motion } from 'motion/react';
import { useOverlayMotion } from './ModalTransition';
import React, { useEffect, useRef, useState } from 'react';
import { Check, Clock3, Share2, UserMinus, Users } from 'lucide-react';
import { useModalLifecycle } from '../lib/useModalLifecycle';
import { type CollaborationInvitation, type TrackCollaborator } from '../lib/api';

type Props = {
  invitations: CollaborationInvitation[];
  onAccept: (id: string) => Promise<void>;
  track: { id: string; title: string } | null;
  isOpen: boolean;
  onClose: () => void;
  onInvite: (username: string, role: 'viewer' | 'editor') => Promise<void>;
  onLoadCollaborators: () => Promise<TrackCollaborator[]>;
  onRevoke: (userId: string) => Promise<void>;
  onSearchUsernames: (query: string) => Promise<string[]>;
};

export const CollaborationModal: React.FC<Props> = ({ invitations, onAccept, track, isOpen, onClose, onInvite, onLoadCollaborators, onRevoke, onSearchUsernames }) => {
  const overlayMotion = useOverlayMotion();
  const alive = useRef(true);
  const pendingRequest = useRef(false);
  const modal = useModalLifecycle(isOpen, onClose);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const [username, setUsername] = useState('');
  const [role, setRole] = useState<'viewer' | 'editor'>('viewer');
  const [collaborators, setCollaborators] = useState<TrackCollaborator[]>([]);
  const [matches, setMatches] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useRef(onLoadCollaborators); load.current = onLoadCollaborators;
  const search = useRef(onSearchUsernames); search.current = onSearchUsernames;
  const trackId = track?.id;
  useEffect(() => {
    if (!isOpen || !trackId) return;
    setError(''); setUsername(''); setRole('viewer');
    let active = true;
    void load.current().then((items) => { if (active && alive.current) setCollaborators(items); }).catch((e: unknown) => { if (active && alive.current) setError(e instanceof Error ? e.message : 'Could not load collaborators.'); });
    return () => { active = false; };
  }, [isOpen, trackId]);

  useEffect(() => {
    const query = username.trim();
    if (!isOpen || !query) { setMatches([]); return; }
    let active = true;
    const timer = window.setTimeout(() => {
      void search.current(query).then((result) => { if (active && alive.current) setMatches(result.slice(0, 3)); }).catch(() => { if (active && alive.current) setMatches([]); });
    }, 160);
    return () => { active = false; window.clearTimeout(timer); };
  }, [username, isOpen]);

  if (!isOpen || !track) return null;
  const pending = collaborators.filter((item) => !item.accepted_at && !item.revoked_at && new Date(item.expires_at) > new Date());
  const active = collaborators.filter((item) => item.accepted_at && !item.revoked_at && new Date(item.expires_at) > new Date());
  const invite = async (event: React.FormEvent) => {
    event.preventDefault(); if (pendingRequest.current) return; pendingRequest.current = true; setBusy(true); setError('');
    try { await onInvite(username.trim(), role); if (!alive.current) return; const items = await load.current(); if (!alive.current) return; setUsername(''); setCollaborators(items); }
    catch (e) { if (alive.current) setError(e instanceof Error ? e.message : 'Could not create invitation.'); }
    finally { if (alive.current) { pendingRequest.current = false; setBusy(false); } }
  };
  const revoke = async (userId: string) => {
    if (pendingRequest.current) return; pendingRequest.current = true; setBusy(true); setError('');
    try { await onRevoke(userId); if (!alive.current) return; const items = await load.current(); if (alive.current) setCollaborators(items); }
    catch (e) { if (alive.current) setError(e instanceof Error ? e.message : 'Could not revoke access.'); }
    finally { if (alive.current) { pendingRequest.current = false; setBusy(false); } }
  };
  return <motion.div {...overlayMotion.backdrop} ref={modal} tabIndex={-1} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-950/45" role="dialog" aria-modal="true" aria-label={`Share ${track.title}`}>
    <motion.section {...overlayMotion.panel} className="w-full max-w-lg rounded-2xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 shadow-xl">
      <header className="flex items-center justify-between p-5 border-b border-stone-100 dark:border-stone-800"><div><h2 className="font-display text-lg font-bold flex items-center gap-2"><Share2 className="w-5 h-5 text-amber-600" />Share track</h2><p className="text-sm text-stone-500 mt-1">{track.title}</p></div><button onClick={onClose} className="text-sm text-stone-500 hover:text-stone-900">Close</button></header>
      <div className="p-5 space-y-5">
        {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
        <form onSubmit={invite} className="rounded-xl bg-stone-50 dark:bg-stone-950/40 p-4 space-y-3">
          <label className="block text-sm font-semibold">Invite existing member</label>
          <div className="relative"><input required autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} maxLength={32} pattern="[A-Za-z0-9_.-]{3,32}" placeholder="Username" className="w-full rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-3 py-2 text-sm" />{matches.length > 0 && <div className="absolute z-10 mt-1 w-full rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 shadow-lg overflow-hidden">{matches.map((match) => <button key={match} type="button" onClick={() => { setUsername(match); setMatches([]); }} className="block w-full px-3 py-2 text-left text-sm hover:bg-stone-100 dark:hover:bg-stone-800">{match}</button>)}</div>}</div>
          <div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => setRole('viewer')} className={`rounded-lg border p-2 text-left text-sm ${role === 'viewer' ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/30' : 'border-stone-200 dark:border-stone-700'}`}><b>Viewer</b><span className="block text-xs text-stone-500 mt-0.5">Can view only</span></button><button type="button" onClick={() => setRole('editor')} className={`rounded-lg border p-2 text-left text-sm ${role === 'editor' ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/30' : 'border-stone-200 dark:border-stone-700'}`}><b>Editor</b><span className="block text-xs text-stone-500 mt-0.5">Can change moments & tags</span></button></div>
          <p className="text-xs text-stone-500 flex gap-1.5"><Clock3 className="w-3.5 h-3.5 shrink-0" />Invitation expires in 7 days. They must accept before they can view it.</p>
          <button disabled={busy} className="rounded-lg bg-stone-900 dark:bg-stone-100 dark:text-stone-900 text-white px-3 py-2 text-sm font-semibold disabled:opacity-50">Send invitation</button>
        </form>
        <CollaboratorList label="Active" people={active} onRevoke={revoke} disabled={busy} />
        <CollaboratorList label="Pending" people={pending} onRevoke={revoke} disabled={busy} />
      </div>
    </motion.section>
  </motion.div>;
}

function CollaboratorList({ label, people, onRevoke, disabled }: { label: string; people: TrackCollaborator[]; onRevoke: (id: string) => Promise<void>; disabled: boolean }) {
  if (!people.length) return null;
  return <section><h3 className="text-xs uppercase tracking-wider font-bold text-stone-500 mb-2">{label}</h3><div className="space-y-2">{people.map((person) => <div key={person.user_id} className="flex items-center justify-between rounded-lg border border-stone-200 dark:border-stone-700 px-3 py-2"><span className="text-sm"><b>{person.username}</b><span className="text-stone-500"> · {person.role}</span></span><button disabled={disabled} onClick={() => void onRevoke(person.user_id)} className="text-xs font-semibold text-rose-700 inline-flex gap-1 items-center"><UserMinus className="w-3.5 h-3.5" />Revoke</button></div>)}</div></section>;
}

export function SharedInvitations({ invitations, onAccept }: { invitations: CollaborationInvitation[]; onAccept: (id: string) => Promise<void> }) {
  if (!invitations.length) return null;
  return <section className="mb-4 rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20 p-4"><h2 className="font-semibold text-sm flex items-center gap-2"><Users className="w-4 h-4" />Shared with you</h2><div className="mt-3 space-y-2">{invitations.map((invitation) => <div key={invitation.id} className="flex flex-wrap items-center justify-between gap-2 text-sm"><span><b>{invitation.owner_username}</b> invited you to <b>{invitation.track.title}</b> as {invitation.role}.</span><button onClick={() => void onAccept(invitation.id)} className="rounded-lg bg-stone-900 dark:bg-stone-100 dark:text-stone-900 text-white px-3 py-1.5 text-xs font-semibold inline-flex items-center gap-1"><Check className="w-3.5 h-3.5" />Accept</button></div>)}</div></section>;
}

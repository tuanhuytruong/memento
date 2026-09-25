import React, { useState } from 'react';
import { Calendar, KeyRound, LoaderCircle, LockKeyhole, UserRound } from 'lucide-react';

interface AuthScreenProps {
  initialError?: string;
  onSubmit: (mode: 'login' | 'register', values: { username: string; password: string; inviteCode: string }) => Promise<void>;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ initialError, onSubmit }) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setError('');
    if (mode === 'register' && password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setPending(true);
    try {
      await onSubmit(mode, { username: username.trim(), password, inviteCode: inviteCode.trim() });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to authenticate. Please try again.');
    } finally {
      setPending(false);
    }
  };

  const changeMode = (next: 'login' | 'register') => {
    setMode(next);
    setError('');
  };

  return (
    <main className="min-h-screen bg-stone-50 dark:bg-stone-950 text-stone-900 dark:text-stone-100 flex items-center justify-center p-4">
      <section className="w-full max-w-md rounded-3xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-6 sm:p-8 shadow-xl">
        <div className="flex items-center gap-3 mb-6">
          <span className="w-11 h-11 rounded-2xl bg-amber-600 text-white flex items-center justify-center"><Calendar className="w-5 h-5" /></span>
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-amber-700 dark:text-amber-400 font-bold">Memento</p>
            <h1 className="text-xl font-bold font-display">Your life, remembered.</h1>
          </div>
        </div>
        <div className="mb-6">
          <h2 className="text-2xl font-bold">{mode === 'login' ? 'Welcome back' : 'Create your account'}</h2>
          <p className="text-sm text-stone-500 dark:text-stone-400 mt-1">{mode === 'login' ? 'Sign in to your private timeline.' : 'Registration requires a one-time invite code.'}</p>
        </div>

        {(error || initialError) && (
          <div role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
            {error || initialError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block">
            <span className="block text-sm font-semibold mb-1.5">Username</span>
            <span className="relative block">
              <UserRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
              <input autoComplete="username" required value={username} onChange={(e) => setUsername(e.target.value)} className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 pl-10 pr-3 py-3 outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500" />
            </span>
          </label>
          <label className="block">
            <span className="block text-sm font-semibold mb-1.5">Password</span>
            <span className="relative block">
              <LockKeyhole className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
              <input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 pl-10 pr-3 py-3 outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500" />
            </span>
          </label>
          {mode === 'register' && (
            <>
              <label className="block">
                <span className="block text-sm font-semibold mb-1.5">Confirm password</span>
                <span className="relative block">
                  <LockKeyhole className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
                  <input
                    type="password"
                    autoComplete="new-password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 pl-10 pr-3 py-3 outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
                  />
                </span>
              </label>
              <label className="block">
                <span className="block text-sm font-semibold mb-1.5">One-time invite code</span>
              <span className="relative block">
                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
                <input autoComplete="off" required value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 pl-10 pr-3 py-3 outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500" />
                </span>
              </label>
            </>
          )}
          <button type="submit" disabled={pending} className="w-full flex items-center justify-center gap-2 rounded-xl bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white font-semibold py-3 transition">
            {pending && <LoaderCircle className="w-4 h-4 animate-spin" />}
            {pending ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Register'}
          </button>
        </form>

        <p className="text-sm text-center text-stone-500 dark:text-stone-400 mt-6">
          {mode === 'login' ? 'Need an account?' : 'Already have an account?'}{' '}
          <button type="button" onClick={() => changeMode(mode === 'login' ? 'register' : 'login')} className="font-semibold text-amber-700 dark:text-amber-400 hover:underline">
            {mode === 'login' ? 'Register with an invite' : 'Sign in'}
          </button>
        </p>
      </section>
    </main>
  );
};

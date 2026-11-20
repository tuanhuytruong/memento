import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, BookOpen, KeyRound, LoaderCircle, LockKeyhole, UserRound } from 'lucide-react';
import archivalHero from '../assets/login/archival-hero.webp';
import archivalHeroCompact from '../assets/login/archival-hero-compact.webp';

interface AuthScreenProps {
  initialError?: string;
  onSubmit: (mode: 'login' | 'register', values: { username: string; password: string; inviteCode: string }) => Promise<void>;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ initialError, onSubmit }) => {
  const alive = useRef(true);
  const submitting = useRef(false);
  const title = useRef<HTMLHeadingElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const registerDraft = useRef({ confirmPassword: '', inviteCode: '' });
  const focusTitle = useRef(false);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const registering = mode === 'register';

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (focusTitle.current) {
      focusTitle.current = false;
      title.current?.focus();
    }
  }, [mode]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting.current) return;
    setError('');

    // Read the live DOM so autofilled values work even without change events.
    const fields = new FormData(event.currentTarget);
    const username = String(fields.get('username') ?? '').trim();
    const password = String(fields.get('password') ?? '');
    const inviteCode = String(fields.get('inviteCode') ?? registerDraft.current.inviteCode).trim();
    if (registering && password !== fields.get('confirmPassword')) {
      setError('Passwords do not match.');
      return;
    }

    submitting.current = true;
    setPending(true);
    try {
      await onSubmit(mode, { username, password, inviteCode });
    } catch (err) {
      if (alive.current) setError(err instanceof Error ? err.message : 'Unable to authenticate. Please try again.');
    } finally {
      submitting.current = false;
      if (alive.current) setPending(false);
    }
  };

  const changeMode = () => {
    if (submitting.current) return;
    if (registering && form.current) {
      const fields = new FormData(form.current);
      registerDraft.current = {
        confirmPassword: String(fields.get('confirmPassword') ?? ''),
        inviteCode: String(fields.get('inviteCode') ?? ''),
      };
    }
    focusTitle.current = true;
    setMode(registering ? 'login' : 'register');
    setError('');
  };

  return (
    <main className="archival-theme archival-auth">
      <div className="archival-auth__panel">
        <section className="archival-auth__content" aria-labelledby="archival-auth-title">
          <div className="archival-auth__brand">
            <span className="archival-auth__brand-mark"><BookOpen size={20} aria-hidden="true" /></span>
            <div>
              <p className="archival-auth__wordmark">Memento</p>
              <p className="archival-auth__edition">Archival memory journal</p>
            </div>
          </div>

          <header className="archival-auth__intro">
            <h1 ref={title} id="archival-auth-title" tabIndex={-1}>{registering ? 'Create your account' : 'Welcome back'}</h1>
            <p>{registering ? 'Registration requires a one-time invite code.' : 'Sign in to your private timeline.'}</p>
          </header>

          {(error || initialError) && <p role="alert" className="archival-auth__alert">{error || initialError}</p>}

          <form ref={form} onSubmit={handleSubmit} className="archival-auth__form" aria-label={registering ? 'Registration' : 'Sign in'}>
            <fieldset className="archival-auth__fields" disabled={pending}>
              <label className="archival-auth__field">
                <span>Username</span>
                <span className="archival-auth__input">
                  <UserRound size={17} aria-hidden="true" />
                  <input name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required />
                </span>
              </label>
              <label className="archival-auth__field">
                <span>Password</span>
                <span className="archival-auth__input">
                  <LockKeyhole size={17} aria-hidden="true" />
                  <input name="password" type="password" autoComplete={registering ? 'new-password' : 'current-password'} required />
                </span>
              </label>
              {registering && (
                <>
                  <label className="archival-auth__field">
                    <span>Confirm password</span>
                    <span className="archival-auth__input">
                      <LockKeyhole size={17} aria-hidden="true" />
                      <input name="confirmPassword" type="password" defaultValue={registerDraft.current.confirmPassword} autoComplete="new-password" required />
                    </span>
                  </label>
                  <label className="archival-auth__field">
                    <span>One-time invite code</span>
                    <span className="archival-auth__input">
                      <KeyRound size={17} aria-hidden="true" />
                      <input name="inviteCode" defaultValue={registerDraft.current.inviteCode} autoComplete="off" autoCapitalize="none" spellCheck={false} required />
                    </span>
                  </label>
                </>
              )}
              <button type="submit" className="archival-auth__submit">
                {pending ? 'Please wait…' : registering ? 'Register' : 'Sign in'}
                {pending ? <LoaderCircle size={17} className="animate-spin" aria-hidden="true" /> : <ArrowRight size={17} aria-hidden="true" />}
              </button>
            </fieldset>
            <span role="status" className="sr-only">{pending ? (registering ? 'Creating your account…' : 'Signing in…') : ''}</span>
          </form>

          <p className="archival-auth__mode">
            {registering ? 'Already have an account?' : 'Need an account?'}{' '}
            <button type="button" disabled={pending} onClick={changeMode}>
              {registering ? 'Sign in' : 'Register with an invite'}
            </button>
          </p>
        </section>
      </div>

      <figure className="archival-auth__hero">
        <picture>
          <source media="(max-width: 767px)" srcSet={archivalHeroCompact} width={768} height={492} />
          <img src={archivalHero} width={1024} height={1536} decoding="async" alt="" />
        </picture>
        <figcaption className="archival-auth__caption">
          <span className="archival-auth__plate">The memory archive</span>
          <span className="archival-auth__tagline">Your life, remembered.</span>
        </figcaption>
      </figure>
    </main>
  );
};

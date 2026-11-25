import React, { useEffect, useState } from 'react';
import { signInWithPopup } from 'firebase/auth';
import { AlertCircle, ShieldCheck } from 'lucide-react';
import { api, ApiClientError, setAuthToken } from '../lib/api';
import { auth, googleAuthProvider } from '../lib/firebase';
import type { User } from '../types';

interface AuthViewProps {
  onAuthenticated: (user: User, isFirebase: boolean) => void;
  sessionNotice?: string | null;
}

type AuthTab = 'login' | 'register' | 'claim';

export function AuthView({ onAuthenticated, sessionNotice }: AuthViewProps) {
  const [tab, setTab] = useState<AuthTab>('login');
  const [needsAdminSetup, setNeedsAdminSetup] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(sessionNotice ?? null);

  useEffect(() => {
    api
      .getSetupStatus()
      .then((res) => {
        setNeedsAdminSetup(res.needsAdminSetup);
      })
      .catch(() => {
        setNeedsAdminSetup(false);
      });
  }, []);

  async function handleGoogleSignIn() {
    setError(null);
    setLoading(true);
    try {
      const cred = await signInWithPopup(auth, googleAuthProvider);
      const idToken = await cred.user.getIdToken();
      setAuthToken(idToken);
      const { user } = await api.exchangeFirebaseToken(idToken);
      onAuthenticated(user, true);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Google Sign-In failed.');
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (tab === 'login') {
        const res = await api.login({ email, password });
        setAuthToken(res.token);
        onAuthenticated(res.user, false);
      } else if (tab === 'register') {
        const res = await api.register({ email, name, password });
        setAuthToken(res.token);
        onAuthenticated(res.user, false);
      } else {
        const res = await api.claimAdmin({ email, name, password });
        setAuthToken(res.token);
        setNeedsAdminSetup(false);
        onAuthenticated(res.user, false);
      }
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError('Authentication failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center px-4 py-12">
      <div className="w-full max-w-md mx-auto">
        <div className="mb-8 text-center">
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
            ResolveGrid
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Operations triage queue and atomic resource scheduling
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2.5 px-4 py-2.5 text-sm font-medium text-slate-900 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-50 whitespace-nowrap"
          >
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
              />
              <path
                fill="#34A853"
                d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
              />
              <path
                fill="#FBBC05"
                d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
              />
              <path
                fill="#EA4335"
                d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
              />
            </svg>
            <span>Continue with Google</span>
          </button>

          <div className="my-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-slate-200" />
            <span className="text-xs text-slate-500">or with email</span>
            <div className="h-px flex-1 bg-slate-200" />
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg mb-5">
            <button
              type="button"
              onClick={() => {
                setTab('login');
                setError(null);
              }}
              className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                tab === 'login'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('register');
                setError(null);
              }}
              className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                tab === 'register'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Register
            </button>
            {needsAdminSetup && (
              <button
                type="button"
                onClick={() => {
                  setTab('claim');
                  setError(null);
                }}
                className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  tab === 'claim'
                    ? 'bg-white text-blue-700 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Claim Admin
              </button>
            )}
          </div>

          {tab === 'claim' && needsAdminSetup && (
            <div className="mb-4 p-3 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-900 flex items-start gap-2">
              <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5 text-blue-700" />
              <span>
                First-run setup: claim the initial administrator account. This
                form locks automatically once claimed.
              </span>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 flex items-start gap-2"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {(tab === 'register' || tab === 'claim') && (
              <div>
                <label
                  htmlFor="auth-name"
                  className="block text-xs font-medium text-slate-700 mb-1.5"
                >
                  Full name
                </label>
                <input
                  id="auth-name"
                  type="text"
                  required
                  minLength={2}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Alex Rivera"
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                />
              </div>
            )}

            <div>
              <label
                htmlFor="auth-email"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                Email address
              </label>
              <input
                id="auth-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="operator@company.com"
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              />
            </div>

            <div>
              <label
                htmlFor="auth-password"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                Password
              </label>
              <input
                id="auth-password"
                type="password"
                required
                minLength={tab === 'login' ? 1 : 8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={
                  tab === 'login' ? 'Enter password' : 'Minimum 8 characters'
                }
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full px-4 py-2.5 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-50 whitespace-nowrap"
            >
              {loading
                ? 'Authenticating...'
                : tab === 'login'
                  ? 'Sign In'
                  : tab === 'register'
                    ? 'Create Account'
                    : 'Claim Admin Account'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { Menu, X } from 'lucide-react';
import { AdminView } from './components/AdminView';
import { AuthView } from './components/AuthView';
import { BookingsView } from './components/BookingsView';
import { ResourcesView } from './components/ResourcesView';
import { TriageView } from './components/TriageView';
import {
  api,
  setAuthToken,
  setFirebaseTokenProvider,
  setUnauthorizedHandler,
} from './lib/api';
import { auth } from './lib/firebase';
import type { User } from './types';

type NavSection = 'triage' | 'resources' | 'bookings' | 'admin';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [section, setSection] = useState<NavSection>('triage');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [bookingsRefreshKey, setBookingsRefreshKey] = useState(0);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setFirebaseTokenProvider(null);
      setAuthToken(null);
      setUser(null);
      setSection('triage');
      setSessionNotice('Your session expired. Please sign in again.');
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      if (!fbUser) {
        setFirebaseTokenProvider(null);
        setCheckingSession(false);
        return;
      }
      try {
        setFirebaseTokenProvider(async () => fbUser.getIdToken());
        const idToken = await fbUser.getIdToken();
        setAuthToken(idToken);
        const res = await api.exchangeFirebaseToken(idToken);
        setSessionNotice(null);
        setUser(res.user);
      } catch {
        setFirebaseTokenProvider(null);
        setAuthToken(null);
      } finally {
        setCheckingSession(false);
      }
    });
    return () => unsubscribe();
  }, []);

  async function handleSignOut() {
    try {
      await api.logout();
    } catch {
      // Ignore network/token errors on logout
    }
    setFirebaseTokenProvider(null);
    setAuthToken(null);
    setUser(null);
    setSessionNotice(null);
    setSection('triage');
    setMobileMenuOpen(false);
    try {
      await signOut(auth);
    } catch {
      // Ignore if signed in via local session token
    }
  }

  function handleAuthenticated(authedUser: User, isFirebase: boolean) {
    if (isFirebase) {
      setFirebaseTokenProvider(async () =>
        auth.currentUser ? auth.currentUser.getIdToken() : null
      );
    } else {
      setFirebaseTokenProvider(null);
    }
    setSessionNotice(null);
    setUser(authedUser);
    setSection('triage');
  }

  if (checkingSession) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <span className="text-sm text-slate-600">Loading ResolveGrid...</span>
      </div>
    );
  }

  if (!user) {
    return (
      <AuthView
        onAuthenticated={handleAuthenticated}
        sessionNotice={sessionNotice}
      />
    );
  }

  const navItems: Array<{ id: NavSection; label: string }> = [
    { id: 'triage', label: 'Triage Queue' },
    { id: 'resources', label: 'Resources' },
    { id: 'bookings', label: 'Bookings' },
    ...(user.role === 'ADMIN'
      ? [{ id: 'admin' as const, label: 'Admin' }]
      : []),
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 overflow-x-hidden">
      {/* Three-Zone Top Bar Contract */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-8">
          {/* Zone 1: Single-line Brand Wordmark */}
          <button
            type="button"
            onClick={() => setSection('triage')}
            className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            ResolveGrid
          </button>

          {/* Zone 2: Clean Single-Line Nav Links */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                  section === item.id
                    ? 'text-blue-700 border-blue-700'
                    : 'text-slate-600 border-transparent hover:text-slate-900'
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          {/* Zone 3: Single Primary Action + Mobile Drawer Trigger */}
          <div className="flex items-center gap-3 shrink-0">
            <span className="hidden lg:inline text-xs text-slate-500 max-w-[180px] truncate">
              {user.email} · {user.role}
            </span>
            <button
              type="button"
              onClick={handleSignOut}
              className="hidden md:inline-flex px-3.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              Sign Out
            </button>
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-label="Toggle navigation menu"
              className="md:hidden p-2 text-slate-700 hover:bg-slate-100 rounded-lg"
            >
              {mobileMenuOpen ? (
                <X className="w-5 h-5" />
              ) : (
                <Menu className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>

        {/* Mobile Nav Drawer (zero horizontal overflow at 375px) */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-slate-200 bg-white px-4 py-3 space-y-2">
            <div className="text-xs text-slate-500 pb-2 border-b border-slate-100">
              {user.email} · {user.role}
            </div>
            <div className="flex flex-col gap-1">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setSection(item.id);
                    setMobileMenuOpen(false);
                  }}
                  className={`text-left px-3 py-2 text-sm font-medium rounded-lg ${
                    section === item.id
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              className="w-full text-left px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 rounded-lg"
            >
              Sign Out
            </button>
          </div>
        )}
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {section === 'triage' && <TriageView />}
        {section === 'resources' && (
          <ResourcesView
            onBookingCreated={() => setBookingsRefreshKey((k) => k + 1)}
          />
        )}
        {section === 'bookings' && (
          <BookingsView refreshKey={bookingsRefreshKey} />
        )}
        {section === 'admin' && user.role === 'ADMIN' && <AdminView />}
      </main>
    </div>
  );
}

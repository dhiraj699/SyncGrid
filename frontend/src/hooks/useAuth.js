import { useCallback, useEffect, useState } from 'react';
import { api, onUnauthorized, setAuthToken } from '../services/apiClient.js';

const STORAGE_KEY = 'syncgrid.session';

const readStoredSession = () => {
  try {
    const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY));
    return stored?.token && stored?.user ? stored : null;
  } catch {
    return null;
  }
};

export function useAuth() {
  const [session, setSession] = useState(() => {
    const stored = readStoredSession();
    if (stored) setAuthToken(stored.token);
    return stored;
  });

  const signOut = useCallback(() => {
    setAuthToken(null);
    try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* storage unavailable */ }
    setSession(null);
  }, []);

  const signIn = useCallback(async (email, password) => {
    const next = await api.login(email, password);
    setAuthToken(next.token);
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
    setSession(next);
  }, []);

  useEffect(() => onUnauthorized(signOut), [signOut]);

  return { session, signIn, signOut };
}

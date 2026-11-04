import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '../api';
import type { Session } from '../api/types';

interface AuthState {
  session: Session | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

const AuthContext = createContext<AuthState>({ session: null, loading: true, error: null, retry: () => undefined });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Omit<AuthState, 'retry'>>({ session: null, loading: true, error: null });

  const refresh = useCallback(() => {
    api.getSession().then(
      (session) => setState({ session, loading: false, error: null }),
      // A failed lookup says nothing about the account, so a working session stays as it is.
      (error: Error) => setState((current) => (current.session ? { ...current, loading: false } : { session: null, loading: false, error: error.message })),
    );
  }, []);

  useEffect(() => {
    refresh();
    return api.onAuthChange(refresh);
  }, [refresh]);

  return <AuthContext.Provider value={{ ...state, retry: refresh }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

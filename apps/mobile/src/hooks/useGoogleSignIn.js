import { useCallback, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { isAvailable } from '../auth/googleAuthFlow';
import { getAuthErrorMessage } from '../api/errorMessages';

// Thin UI hook for the Google button (B4.2A).
//
// It holds NO authentication authority — that is AuthContext.signInWithGoogle
// (-> googleAuthFlow). This hook only exposes React/UI state:
//   * `loading`  — an attempt is running; also gates cosmetic duplicate presses
//   * `error`    — a safe, user-facing message (or null)
//   * `ready`    — the native module is present in this build; when false the
//                  screen should disable / safely no-op the button
//
// Cancellation (GOOGLE_CANCELLED) is silent — no banner. On success the auth
// state flips and the navigator swaps stacks; nothing to do here.

export default function useGoogleSignIn() {
  const { signInWithGoogle } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const ready = isAvailable();

  const signIn = useCallback(async () => {
    if (loading) return; // cosmetic duplicate-press guard (UX only)
    setError(null);

    if (!ready) {
      // No native module in this build (Expo Go / no dev build). Do not pretend
      // Google is configured — report it safely and make no OAuth request.
      setError({ message: getAuthErrorMessage({ code: 'GOOGLE_UNAVAILABLE' }) });
      return;
    }

    setLoading(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      if (err && err.code === 'GOOGLE_CANCELLED') {
        // Silent — user backed out.
      } else {
        setError({ message: getAuthErrorMessage(err) });
      }
    } finally {
      setLoading(false);
    }
  }, [loading, ready, signInWithGoogle]);

  const cancel = useCallback(() => setError(null), []);

  return {
    signIn,
    cancel,
    error,
    loading,
    ready,
  };
}

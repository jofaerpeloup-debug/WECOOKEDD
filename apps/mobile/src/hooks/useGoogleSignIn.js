import { useCallback, useState } from 'react';

// Google sign-in is DEFERRED for this slice.
//
// The WeCooked backend has no Google-auth endpoint yet, so there is no way for
// a Google identity to become a real, backend-authenticated WeCooked session.
// The previous implementation ran a client-side Google OAuth flow (web popup /
// native device-code) and treated the resulting Google profile as a logged-in
// user — that produced a *fake* local session that never touched Express auth,
// and it also required an OAuth **client secret** shipped through
// `EXPO_PUBLIC_*` (which is bundled into the app and therefore not secret).
//
// Both are removed here. This hook keeps the exact shape the Login screen
// consumes so the button still renders, but `signIn` only reports that the
// feature isn't available yet and never yields a profile / session. No OAuth
// requests are made and no Google client id/secret is read.
//
// When the backend gains a real Google flow (e.g. POST /auth/google that
// verifies an ID token server-side and returns the standard
// { user, accessToken, refreshToken }), wire that through authService — do not
// resurrect a client-only session here.

const UNAVAILABLE_MESSAGE =
  'Google sign-in isn’t available yet — please log in with your email and password.';

export default function useGoogleSignIn() {
  const [error, setError] = useState(null);

  const signIn = useCallback(() => {
    setError({ message: UNAVAILABLE_MESSAGE });
  }, []);

  const cancel = useCallback(() => {
    setError(null);
  }, []);

  return {
    signIn,
    cancel,
    profile: null,
    error,
    loading: false,
    ready: false,
    deviceCode: null,
    verificationUrl: null,
  };
}

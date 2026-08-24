import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';

WebBrowser.maybeCompleteAuthSession();

const discovery = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
  deviceAuthorizationEndpoint: 'https://oauth2.googleapis.com/device/code',
};

// "Web application" client — used on web only. It's a confidential client
// type, so it also needs its secret for the code exchange (see .env.example).
const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_WEB;
const WEB_CLIENT_SECRET = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_SECRET_WEB;

// "TVs and Limited Input devices" client — used on native. Redirect-based
// sign-in can't work in Expo Go (see .env.example), so native uses the OAuth
// Device Authorization Grant instead: no redirect URI involved at all, just
// a code the user enters at google.com/device from any browser.
const TV_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_TV;
const TV_CLIENT_SECRET = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_SECRET_TV;

async function fetchProfile(accessToken) {
  const res = await fetch('https://www.googleapis.com/userinfo/v2/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return res.json();
}

// ---- web: popup + Authorization Code flow ----------------------------------

function useGoogleSignInWeb() {
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const redirectUri = AuthSession.makeRedirectUri();

  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: WEB_CLIENT_ID,
      scopes: ['openid', 'profile', 'email'],
      redirectUri,
      responseType: AuthSession.ResponseType.Code,
      usePKCE: true,
    },
    discovery
  );

  useEffect(() => {
    if (response?.type === 'success' && request) {
      setLoading(true);
      AuthSession.exchangeCodeAsync(
        {
          clientId: WEB_CLIENT_ID,
          clientSecret: WEB_CLIENT_SECRET,
          code: response.params.code,
          redirectUri,
          extraParams: { code_verifier: request.codeVerifier },
        },
        discovery
      )
        .then((tokenResponse) => fetchProfile(tokenResponse.accessToken))
        .then((data) => setProfile(data))
        .catch((err) => setError(err))
        .finally(() => setLoading(false));
    } else if (response?.type === 'error') {
      setError(response.error);
    }
  }, [response]);

  const signIn = () => {
    if (!WEB_CLIENT_ID) {
      setError({ message: 'Missing Google Client ID — see .env.example' });
      return;
    }
    setError(null);
    promptAsync();
  };

  return {
    signIn,
    cancel: () => {},
    profile,
    error,
    loading,
    ready: !!request && !!WEB_CLIENT_ID,
    deviceCode: null,
    verificationUrl: null,
  };
}

// ---- native: OAuth Device Authorization Grant -------------------------------

function useGoogleSignInDevice() {
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [deviceCode, setDeviceCode] = useState(null);
  const [verificationUrl, setVerificationUrl] = useState(null);
  const pollTimer = useRef(null);
  const cancelled = useRef(false);

  useEffect(() => () => {
    cancelled.current = true;
    if (pollTimer.current) clearTimeout(pollTimer.current);
  }, []);

  const stopPolling = () => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    pollTimer.current = null;
  };

  const poll = (device_code, intervalSeconds) => {
    pollTimer.current = setTimeout(async () => {
      if (cancelled.current) return;
      try {
        const res = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: TV_CLIENT_ID,
            client_secret: TV_CLIENT_SECRET,
            device_code,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          }).toString(),
        });
        const data = await res.json();

        if (data.access_token) {
          setLoading(true);
          const p = await fetchProfile(data.access_token);
          if (!cancelled.current) {
            setProfile(p);
            setDeviceCode(null);
            setVerificationUrl(null);
          }
          setLoading(false);
          return;
        }

        if (data.error === 'authorization_pending') {
          poll(device_code, intervalSeconds);
        } else if (data.error === 'slow_down') {
          poll(device_code, intervalSeconds + 5);
        } else {
          // access_denied, expired_token, or anything else terminal
          setError({ message: data.error_description || data.error || 'Google sign-in failed.' });
          setDeviceCode(null);
          setVerificationUrl(null);
        }
      } catch (err) {
        if (!cancelled.current) setError(err);
      }
    }, intervalSeconds * 1000);
  };

  const signIn = async () => {
    if (!TV_CLIENT_ID) {
      setError({ message: 'Missing Google TV Client ID — see .env.example' });
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('https://oauth2.googleapis.com/device/code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: TV_CLIENT_ID,
          scope: 'openid profile email',
        }).toString(),
      });
      const data = await res.json();
      if (!data.device_code) {
        setError({ message: data.error_description || 'Could not start Google sign-in.' });
        setLoading(false);
        return;
      }
      setDeviceCode(data.user_code);
      setVerificationUrl(data.verification_url);
      setLoading(false);
      poll(data.device_code, data.interval || 5);
    } catch (err) {
      setError(err);
      setLoading(false);
    }
  };

  const cancel = () => {
    stopPolling();
    setDeviceCode(null);
    setVerificationUrl(null);
    setLoading(false);
  };

  return {
    signIn,
    cancel,
    profile,
    error,
    loading,
    ready: !!TV_CLIENT_ID,
    deviceCode,
    verificationUrl,
  };
}

// Wires up Google sign-in and resolves with the signed-in user's profile.
// Web uses the usual popup + redirect flow; native uses the OAuth Device
// Authorization Grant instead, since Expo Go can't receive a redirect back
// from Google (see .env.example for why, and which client IDs each needs).
export default function useGoogleSignIn() {
  return Platform.OS === 'web' ? useGoogleSignInWeb() : useGoogleSignInDevice();
}

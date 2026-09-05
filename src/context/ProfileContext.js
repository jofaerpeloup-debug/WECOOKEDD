import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { chef } from '../data/mockData';
import { loadJSON, saveJSON } from '../utils/storage';

const STORAGE_KEY = 'wecooked:profile';

const ProfileContext = createContext(null);

// The editable part of the user's identity — name / email / allergies /
// avatar / bio. Seeded from `chef`, then persisted.
export function ProfileProvider({ children }) {
  const [profile, setProfile] = useState({
    name: chef.name,
    email: chef.email,
    dietary: chef.dietary || [],
    avatar: chef.avatar || '',
    bio: chef.bio || chef.title || '',
  });
  const hydrated = useRef(false);

  useEffect(() => {
    (async () => {
      const stored = await loadJSON(STORAGE_KEY, null);
      if (stored) {
        setProfile((p) => ({
          name: stored.name || stored.username || p.name,
          email: stored.email || p.email,
          dietary: stored.dietary || p.dietary,
          avatar: stored.avatar ?? p.avatar,
          bio: stored.bio ?? p.bio,
        }));
      }
      hydrated.current = true;
    })();
  }, []);

  useEffect(() => {
    if (hydrated.current) saveJSON(STORAGE_KEY, profile);
  }, [profile]);

  const updateProfile = (patch) => setProfile((p) => ({ ...p, ...patch }));

  const value = useMemo(
    () => ({ profile, updateProfile, avatar: profile.avatar, bio: profile.bio }),
    [profile]
  );

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile() {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error('useProfile() must be called from inside a <ProfileProvider>');
  return ctx;
}

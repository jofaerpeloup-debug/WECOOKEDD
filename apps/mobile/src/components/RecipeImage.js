import React, { useEffect, useState } from 'react';
import { Image } from 'react-native';
import { imageSource } from '../utils/image';

// Local stand-in used whenever a recipe has no usable image — reuses an asset
// already in the repo (no upload/storage, no remote fallback, nothing new).
const FALLBACK = require('../../assets/leaf-deco.jpg');

/**
 * <Image> wrapper for recipe photography.
 *
 * `source` accepts the mixed values recipes carry:
 *   - backend `imageUrl`  — a URL string or null
 *   - legacy mock `image` — a bundled asset (require() number) or URL string
 *
 * A null/empty source, or a remote image that fails to load, falls back to the
 * bundled placeholder. The failure flag resets whenever `source` changes, so a
 * broken image on one recipe never pins the placeholder for the next one.
 */
export default function RecipeImage({ source, style, fallback = FALLBACK, ...rest }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [source]);

  const resolved = failed ? null : imageSource(source);

  return (
    <Image
      source={resolved || fallback}
      style={style}
      onError={() => setFailed(true)}
      {...rest}
    />
  );
}
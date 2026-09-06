// SDK57-C1D regression — <Image source> shape normalization.
//
// The onboarding StepsPage used to render `source={{ uri: recipe.image }}`.
// mockData's recipe images are a MIX of require()'d bundled assets (a number)
// and remote URL strings, so for a bundled asset that produced `{ uri: <number> }`
// — a shape React Native passes through unresolved and native RCTImageView
// rejects, crashing first render. imageSource() is the shared normalizer that
// keeps both kinds of value in a shape <Image> accepts.

const { imageSource } = require('../src/utils/image');

describe('imageSource', () => {
  it('passes a require()d bundled asset through as the opaque numeric id', () => {
    // Must stay a bare number: wrapping it as { uri: <number> } is the bug.
    expect(imageSource(42)).toBe(42);
  });

  it('wraps a remote URL string as { uri: string }', () => {
    const url = 'https://images.unsplash.com/photo-1619161208416-b7d5f04c5b99?w=800&q=80';
    expect(imageSource(url)).toEqual({ uri: url });
    expect(typeof imageSource(url).uri).toBe('string');
  });

  it('leaves an already-shaped source object alone', () => {
    const source = { uri: 'https://example.com/a.jpg', width: 100, height: 100 };
    expect(imageSource(source)).toBe(source);
  });

  it('returns undefined for a missing image so <Image> renders nothing', () => {
    expect(imageSource(null)).toBeUndefined();
    expect(imageSource(undefined)).toBeUndefined();
    expect(imageSource('')).toBeUndefined();
  });
});

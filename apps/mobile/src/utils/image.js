// Normalizes the mixed `image`/`avatar` values in the mock data layer into a
// value React Native's <Image source> accepts. Recipe/demo images come through
// as either a bundled asset (the number a require() returns), a remote URL
// string, an already-shaped { uri } object, or nothing at all — this collapses
// all of those to one safe shape so screens can just do:
//   <Image source={imageSource(recipe.image)} />

export function imageSource(value) {
  if (value == null || value === '') return undefined;
  if (typeof value === 'number') return value; // require()'d bundled asset
  if (typeof value === 'string') return { uri: value }; // remote URL
  return value; // already an { uri, ... } / resolved asset object
}
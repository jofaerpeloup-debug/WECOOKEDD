// Recipe images can be either a remote URL (string) or a locally bundled
// asset (the number/object returned by require()). This normalizes either
// into a valid <Image source={...}> value.
export function imageSource(image) {
  return typeof image === 'string' ? { uri: image } : image;
}

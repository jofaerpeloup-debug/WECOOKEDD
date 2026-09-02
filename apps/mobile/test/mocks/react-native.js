// Narrow test mock for `react-native` — B4.2A units only touch `Platform`
// (src/api/config.js reads Platform.OS; src/api/tokenStore.js checks it). The
// real RN module can't be loaded under this repo's `install-strategy=nested`
// without hoisting RN's whole jest toolchain, which B4.2A deliberately avoids.

const Platform = {
  OS: 'ios',
  select: (spec) => {
    if (!spec) return undefined;
    if ('ios' in spec) return spec.ios;
    if ('native' in spec) return spec.native;
    return spec.default;
  },
};

module.exports = { Platform };
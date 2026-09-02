// Narrow test mock for `expo-secure-store`. Only used indirectly: automocking
// src/api/tokenStore.js needs its imports to load. Tests that care about token
// storage mock tokenStore itself.

module.exports = {
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
};
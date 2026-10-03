const React = require('react');

const mockAlert = jest.fn();
jest.mock('react-native', () => {
  const React = require('react');
  const host = (name) => React.forwardRef(({ children, ...props }, ref) => React.createElement(name, { ...props, ref }, children));
  return {
    ActivityIndicator: host('ActivityIndicator'), Image: host('Image'), Pressable: host('Pressable'),
    ScrollView: host('ScrollView'), Text: host('Text'), TextInput: host('TextInput'), View: host('View'),
    Alert: { alert: (...args) => mockAlert(...args) },
    Platform: { OS: 'ios' }, StyleSheet: { create: (styles) => styles, flatten: (style) => Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style || {} },
  };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('../src/theme/ThemeContext', () => ({ useTheme: () => ({ colors: { cream: '#fff', creamDeep: '#eee', paper: '#fff', ink: '#111', inkSoft: '#333', inkFaint: '#666', hairline: '#ccc', onAccent: '#fff', sagePale: '#efe', sageDeep: '#353', error: '#900' } }) }));
jest.mock('../src/components/TopBar', () => 'TopBar');
jest.mock('../src/components/Input', () => {
  const React = require('react'); const { TextInput } = require('react-native');
  return (props) => React.createElement(TextInput, { ...props, accessibilityLabel: props.accessibilityLabel || props.label });
});
jest.mock('../src/components/Button', () => {
  const React = require('react'); const { Pressable, Text } = require('react-native');
  return ({ title, onPress, disabled, loading }) => React.createElement(Pressable, { onPress, disabled: disabled || loading, accessibilityLabel: title }, React.createElement(Text, null, title));
});

let mockAuth;
jest.mock('../src/context/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('../src/api/profileService', () => ({ updateProfile: jest.fn(), uploadAvatar: jest.fn(), resetAvatar: jest.fn() }));
jest.mock('../src/api/errorMessages', () => ({ getAuthErrorMessage: (error) => error.message || 'failed' }));

const { act, cleanup, fireEvent, render, waitFor } = require('@testing-library/react-native');
const ImagePicker = require('expo-image-picker');
const service = require('../src/api/profileService');
const AccountDetails = require('../src/screens/AccountDetailScreen').default;

const user = (overrides = {}) => ({ id: 'u1', name: 'Ada', email: 'ada@example.com', avatarUrl: null, bio: '', cookingLevel: 'beginner', preferences: { dietaryPreferences: [], allergies: [] }, ...overrides });
function deferred() { let resolve; let reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth = { user: user(), syncUser: jest.fn() };
});
afterEach(() => cleanup());

it('picker cancellation is a no-op and releases the shared single-flight guard', async () => {
  ImagePicker.launchImageLibraryAsync.mockResolvedValue({ canceled: true, assets: [] });
  const view = render(<AccountDetails navigation={{ goBack: jest.fn(), navigate: jest.fn() }} />);
  fireEvent.press(view.getByLabelText('Upload profile photo'));
  await waitFor(() => expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledTimes(1));
  expect(service.uploadAvatar).not.toHaveBeenCalled();
  await waitFor(() => expect(view.getByLabelText('Save Changes').props.disabled).toBe(false));
});

it('upload stays pessimistic, is single-flight, and reconciles only the server user', async () => {
  const pending = deferred();
  const asset = { uri: 'file://picked.jpg', fileName: 'picked.jpg', mimeType: 'image/jpeg' };
  ImagePicker.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [asset] });
  service.uploadAvatar.mockReturnValue(pending.promise);
  const view = render(<AccountDetails navigation={{ goBack: jest.fn(), navigate: jest.fn() }} />);
  fireEvent.press(view.getByLabelText('Upload profile photo'));
  fireEvent.press(view.getByLabelText('Save Changes'));
  await waitFor(() => expect(service.uploadAvatar).toHaveBeenCalledWith(asset));
  expect(service.updateProfile).not.toHaveBeenCalled();
  expect(view.getByLabelText('Ada initial')).toBeOnTheScreen();
  await act(async () => pending.resolve(user({ avatarUrl: 'https://cdn/a.webp' })));
  expect(mockAuth.syncUser).toHaveBeenCalledWith(expect.objectContaining({ avatarUrl: 'https://cdn/a.webp' }));
});

it('failed upload preserves the authoritative avatar and offers retry guidance', async () => {
  mockAuth = { user: user({ avatarUrl: 'https://cdn/old.webp' }), syncUser: jest.fn() };
  ImagePicker.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file://x.png', mimeType: 'image/png' }] });
  service.uploadAvatar.mockRejectedValue(new Error('Upload failed.'));
  const view = render(<AccountDetails navigation={{ goBack: jest.fn(), navigate: jest.fn() }} />);
  fireEvent.press(view.getByLabelText('Replace profile photo'));
  await waitFor(() => expect(view.getByText('Upload failed. You can retry.')).toBeOnTheScreen());
  expect(view.getByLabelText('Ada avatar').props.source.uri).toBe('https://cdn/old.webp');
  expect(mockAuth.syncUser).not.toHaveBeenCalled();
});

it('save sends bio and cooking level, then navigates only after same-account success', async () => {
  const navigation = { goBack: jest.fn(), navigate: jest.fn() };
  service.updateProfile.mockResolvedValue(user({ name: 'Ada Lovelace', bio: 'Bakes', cookingLevel: 'advanced' }));
  const view = render(<AccountDetails navigation={navigation} />);
  fireEvent.changeText(view.getByLabelText('Name'), 'Ada Lovelace');
  fireEvent.changeText(view.getByLabelText('Bio'), 'Bakes');
  fireEvent.press(view.getByLabelText('Advanced'));
  fireEvent.press(view.getByLabelText('Save Changes'));
  await waitFor(() => expect(service.updateProfile).toHaveBeenCalledWith(expect.objectContaining({ name: 'Ada Lovelace', bio: 'Bakes', cookingLevel: 'advanced' })));
  expect(mockAuth.syncUser).toHaveBeenCalled();
  expect(navigation.goBack).toHaveBeenCalledTimes(1);
});

it('account switch invalidates a late upload continuation and finalizer', async () => {
  const pending = deferred();
  ImagePicker.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file://x.jpg', mimeType: 'image/jpeg' }] });
  service.uploadAvatar.mockReturnValue(pending.promise);
  const view = render(<AccountDetails navigation={{ goBack: jest.fn(), navigate: jest.fn() }} />);
  const oldSync = mockAuth.syncUser;
  fireEvent.press(view.getByLabelText('Upload profile photo'));
  await waitFor(() => expect(service.uploadAvatar).toHaveBeenCalled());
  mockAuth = { user: user({ id: 'u2', name: 'Grace' }), syncUser: jest.fn() };
  view.rerender(<AccountDetails navigation={{ goBack: jest.fn(), navigate: jest.fn() }} />);
  await act(async () => pending.resolve(user({ avatarUrl: 'https://cdn/stale.webp' })));
  expect(oldSync).not.toHaveBeenCalled();
  expect(mockAuth.syncUser).not.toHaveBeenCalled();
  expect(view.getByLabelText('Grace initial')).toBeOnTheScreen();
});

it('confirmed reset succeeds and reconciles the authoritative server user', async () => {
  mockAuth = { user: user({ avatarUrl: 'https://cdn/old.webp' }), syncUser: jest.fn() };
  const updated = user({ avatarUrl: null });
  service.resetAvatar.mockResolvedValue(updated);
  const view = render(<AccountDetails navigation={{ goBack: jest.fn(), navigate: jest.fn() }} />);

  fireEvent.press(view.getByLabelText('Reset profile photo'));
  const resetAction = mockAlert.mock.calls[0][2].find((action) => action.text === 'Reset');
  await act(async () => resetAction.onPress());

  expect(service.resetAvatar).toHaveBeenCalledTimes(1);
  expect(mockAuth.syncUser).toHaveBeenCalledWith(updated);
});

it('reset failure preserves the authoritative avatar and offers retry guidance', async () => {
  mockAuth = { user: user({ avatarUrl: 'https://cdn/old.webp' }), syncUser: jest.fn() };
  service.resetAvatar.mockRejectedValue(new Error('Reset failed.'));
  const view = render(<AccountDetails navigation={{ goBack: jest.fn(), navigate: jest.fn() }} />);

  fireEvent.press(view.getByLabelText('Reset profile photo'));
  const resetAction = mockAlert.mock.calls[0][2].find((action) => action.text === 'Reset');
  await act(async () => resetAction.onPress());

  expect(view.getByText('Reset failed. You can retry.')).toBeOnTheScreen();
  expect(view.getByLabelText('Ada avatar').props.source.uri).toBe('https://cdn/old.webp');
  expect(mockAuth.syncUser).not.toHaveBeenCalled();
});

it('account switch while reset confirmation is open cannot start the old mutation', async () => {
  mockAuth = { user: user({ avatarUrl: 'https://cdn/old.webp' }), syncUser: jest.fn() };
  const view = render(<AccountDetails navigation={{ goBack: jest.fn(), navigate: jest.fn() }} />);
  fireEvent.press(view.getByLabelText('Reset profile photo'));
  const resetAction = mockAlert.mock.calls[0][2].find((action) => action.text === 'Reset');

  mockAuth = { user: user({ id: 'u2', name: 'Grace', avatarUrl: 'https://cdn/grace.webp' }), syncUser: jest.fn() };
  view.rerender(<AccountDetails navigation={{ goBack: jest.fn(), navigate: jest.fn() }} />);
  await act(async () => resetAction.onPress());

  expect(service.resetAvatar).not.toHaveBeenCalled();
});

it('unmount while reset confirmation is open cannot start the mutation', async () => {
  mockAuth = { user: user({ avatarUrl: 'https://cdn/old.webp' }), syncUser: jest.fn() };
  const view = render(<AccountDetails navigation={{ goBack: jest.fn(), navigate: jest.fn() }} />);
  fireEvent.press(view.getByLabelText('Reset profile photo'));
  const resetAction = mockAlert.mock.calls[0][2].find((action) => action.text === 'Reset');

  view.unmount();
  await act(async () => resetAction.onPress());

  expect(service.resetAvatar).not.toHaveBeenCalled();
});

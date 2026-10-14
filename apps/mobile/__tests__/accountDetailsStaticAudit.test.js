const fs = require('fs');
const path = require('path');
const React = require('react');

jest.mock('react-native', () => {
  const React = require('react');
  const host = (name) => React.forwardRef(({ children, ...props }, ref) => React.createElement(name, { ...props, ref }, children));
  return {
    ActivityIndicator: host('ActivityIndicator'), Alert: { alert: jest.fn() }, Image: host('Image'),
    Platform: { OS: 'ios' }, Pressable: host('Pressable'), ScrollView: host('ScrollView'), Text: host('Text'),
    TextInput: host('TextInput'), View: host('View'),
    StyleSheet: { create: (styles) => styles, flatten: (style) => Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style || {} },
  };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('../src/theme/ThemeContext', () => ({ useTheme: () => ({ colors: { cream: '#fff', creamDeep: '#eee', paper: '#fff', ink: '#111', inkSoft: '#333', inkFaint: '#666', hairline: '#ccc', onAccent: '#fff', sagePale: '#efe', sageDeep: '#353', error: '#900' } }) }));
jest.mock('../src/components/TopBar', () => 'TopBar');
jest.mock('../src/components/Input', () => 'Input');
jest.mock('../src/components/Button', () => 'Button');
jest.mock('../src/components/Badge', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return ({ label }) => React.createElement(Text, null, `BADGE:${label}`);
});
jest.mock('../src/api/profileService', () => ({ resetAvatar: jest.fn(), updateProfile: jest.fn(), uploadAvatar: jest.fn() }));
jest.mock('../src/api/errorMessages', () => ({ getAuthErrorMessage: (error) => error.message }));
let mockAuth;
jest.mock('../src/context/AuthContext', () => ({ useAuth: () => mockAuth }));

const { act, cleanup, fireEvent, render } = require('@testing-library/react-native');
const { StyleSheet } = require('react-native');
const ImagePicker = require('expo-image-picker');
const AccountDetails = require('../src/screens/AccountDetailScreen').default;

const raw = fs.readFileSync(path.join(__dirname, '../src/screens/AccountDetailScreen.js'), 'utf8');

describe('MOBILE-PROFILE2 Account Details source contract', () => {
  it('uses AuthContext and the three authenticated profile mutations only', () => {
    expect(raw).toMatch(/const \{ user, syncUser \} = useAuth\(\)/);
    expect(raw).toMatch(/resetAvatar, updateProfile, uploadAvatar/);
    expect(raw).not.toMatch(/fetch\(|AsyncStorage|mockData|CommunityContext/);
  });

  it('implements the 500-character bio and exact cooking-level choices', () => {
    expect(raw).toMatch(/MAX_BIO_LENGTH = 500/);
    expect(raw).toMatch(/maxLength=\{MAX_BIO_LENGTH\}/);
    expect(raw).toMatch(/\['beginner', 'Beginner'\]/);
    expect(raw).toMatch(/\['intermediate', 'Intermediate'\]/);
    expect(raw).toMatch(/\['advanced', 'Advanced'\]/);
  });

  it('uses photo-library selection without camera/crop authority', () => {
    expect(raw).toMatch(/launchImageLibraryAsync/);
    expect(raw).toMatch(/allowsEditing: false/);
    expect(raw).not.toMatch(/launchCameraAsync|requestCameraPermissions/);
  });

  it('keeps save, upload, and reset under one identity-bound operation guard', () => {
    expect(raw).toMatch(/operationRef\.current/);
    expect(raw).toMatch(/ownerRef\.current === operation\.ownerId/);
    expect(raw).toMatch(/generationRef\.current === operation\.generation/);
    expect(raw).toMatch(/beginOperation\('save'\)/);
    expect(raw).toMatch(/beginOperation\('upload'\)/);
    expect(raw).toMatch(/beginOperation\('reset'\)/);
  });

  it('renders the authoritative avatar or accessible initial and confirms reset', () => {
    expect(raw).toMatch(/user\?\.avatarUrl/);
    expect(raw).toMatch(/accessibilityLabel=\{`\$\{user\?\.name \|\| 'Account'\} initial`\}/);
    expect(raw).toMatch(/Alert\.alert\('Reset profile photo\?'/);
  });

  it('adopts the pinned avatar badge with the real picker and a server-derived level label', () => {
    expect(raw).toMatch(/accessibilityLabel="Choose profile photo"/);
    expect(raw).not.toMatch(/AVATAR_CHOICES|pravatar\.cc|mockData|useProfile\(/);
  });

  it('keeps email read-only and sends credential changes to Security', () => {
    expect(raw).toMatch(/<Text style=\{styles\.readonlyValue\}>\{user\?\.email\}<\/Text>/);
    expect(raw).toMatch(/navigation\.navigate\('Security'\)/);
    expect(raw).not.toMatch(/onChangeText=\{setEmail\}|email: trimmedEmail/);
  });

  it('sends only owned profile fields during save', () => {
    const call = raw.match(/updateProfile\(\{([^;]+?)\}\);/s);
    expect(call).not.toBeNull();
    expect(call[1]).toMatch(/name: trimmedName,\s*bio,\s*cookingLevel/);
    expect(call[1]).toMatch(/dietaryPreferences: normalizePreferenceValues\(dietary\)/);
    expect(call[1]).toMatch(/allergies: normalizePreferenceValues\(allergies\)/);
    expect(call[1]).not.toMatch(/avatarUrl|assetId|role|status|email|userId/);
  });

  it('normalizes legacy duplicate preferences on hydration and save', () => {
    expect(raw).toMatch(/normalizePreferenceValues\(user\?\.preferences\?\.dietaryPreferences \?\? \[\]\)/);
    expect(raw).toMatch(/dietaryPreferences: normalizePreferenceValues\(dietary\)/);
    expect(raw).toMatch(/allergies: normalizePreferenceValues\(allergies\)/);
  });

  it('uses sibling edit/remove actions with labels instead of nested Pressables', () => {
    expect(raw).toMatch(/accessibilityLabel=\{`Edit \$\{item\}`\}/);
    expect(raw).toMatch(/accessibilityLabel=\{`Remove \$\{item\}`\}/);
    expect(raw).toMatch(/accessibilityLabel=\{`Save edit for \$\{item\}`\}/);
    expect(raw).toMatch(/accessibilityLabel=\{`Add \$\{title\}`\}/);
    expect(raw).not.toMatch(/<Pressable key=\{item\}[\s\S]*?<Pressable/);
  });
});

describe('UI-FINAL1 4B4 rendered corrections', () => {
  const profile = (cookingLevel) => ({
    id: 'u1', name: 'Ada', email: 'ada@example.com', avatarUrl: null,
    bio: '', cookingLevel, preferences: { dietaryPreferences: [], allergies: [] },
  });
  const navigation = { goBack: jest.fn(), navigate: jest.fn() };

  afterEach(() => { cleanup(); jest.clearAllMocks(); });

  it.each([
    ['beginner', 'BEGINNER'], ['intermediate', 'INTERMEDIATE'], ['advanced', 'ADVANCED'],
  ])('renders the authenticated %s badge', (level, label) => {
    mockAuth = { user: profile(level), syncUser: jest.fn() };
    const view = render(<AccountDetails navigation={navigation} />);
    expect(view.getByText(`BADGE:${label}`)).toBeOnTheScreen();
  });

  it.each([
    ['missing', undefined], ['null', null], ['unknown', 'expert'], ['unsupported', 42],
  ])('omits the badge for a %s cooking level', (_case, level) => {
    const account = profile(level);
    if (level === undefined) delete account.cookingLevel;
    mockAuth = { user: account, syncUser: jest.fn() };
    const view = render(<AccountDetails navigation={navigation} />);
    expect(view.queryByText(/^BADGE:/)).toBeNull();
  });

  it('keeps a full 48dp camera target inside its wrapper and disables it during upload', async () => {
    let finishPick;
    ImagePicker.launchImageLibraryAsync.mockImplementation(() => new Promise((resolve) => { finishPick = resolve; }));
    mockAuth = { user: profile('beginner'), syncUser: jest.fn() };
    const view = render(<AccountDetails navigation={navigation} />);
    const target = view.getByLabelText('Choose profile photo');
    const targetStyle = StyleSheet.flatten(target.props.style);
    const ancestors = [];
    for (let node = target.parent; node; node = node.parent) ancestors.push(node);
    const wrap = ancestors.find((node) => {
      const style = StyleSheet.flatten(node.props.style);
      return style.width > targetStyle.width && style.height > targetStyle.height;
    });
    const section = ancestors.find((node) => {
      const style = StyleSheet.flatten(node.props.style);
      return style.alignItems === 'center' && typeof style.gap === 'number';
    });
    const wrapStyle = StyleSheet.flatten(wrap?.props.style);
    const sectionStyle = StyleSheet.flatten(section?.props.style);
    const badgeStyle = StyleSheet.flatten(target.children[0].props.style);
    expect(target.props.accessibilityRole).toBe('button');
    expect(target.props.accessibilityState.disabled).toBe(false);
    expect(target.props.hitSlop).toBeUndefined();
    expect(targetStyle).toEqual(expect.objectContaining({ width: 48, height: 48, right: 0, bottom: 0 }));
    expect(badgeStyle).toEqual(expect.objectContaining({ width: 26, height: 26 }));
    expect(wrap).toBeDefined();
    expect(section).toBeDefined();
    expect(wrapStyle.width).toBeGreaterThanOrEqual(targetStyle.width + targetStyle.right);
    expect(wrapStyle.height).toBeGreaterThanOrEqual(targetStyle.height + targetStyle.bottom);
    expect(sectionStyle.gap).toBeGreaterThan(0);
    const actions = view.getByLabelText('Upload profile photo');
    const actionAncestors = [];
    for (let node = actions.parent; node; node = node.parent) actionAncestors.push(node);
    expect(actionAncestors).toContain(section);
    expect(actionAncestors).not.toContain(wrap);
    fireEvent.press(target);
    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledTimes(1);
    expect(view.getByLabelText('Choose profile photo').props.disabled).toBe(true);
    expect(view.getByLabelText('Choose profile photo').props.accessibilityState.disabled).toBe(true);
    await act(async () => finishPick({ canceled: true, assets: [] }));
    expect(view.getByLabelText('Choose profile photo').props.disabled).toBe(false);
  });
});

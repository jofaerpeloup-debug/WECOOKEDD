const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const React = require('react');

let mockThemeMode = 'system';
let mockThemeIsDark = false;
let mockThemeColors;
const mockSetMode = jest.fn();

jest.mock('react-native', () => {
  const React = require('react');
  const host = (name) => React.forwardRef(({ children, ...props }, ref) => React.createElement(name, { ...props, ref }, children));
  return {
    Pressable: host('Pressable'), ScrollView: host('ScrollView'), Text: host('Text'), View: host('View'),
    Alert: { alert: jest.fn() },
    StyleSheet: { create: (styles) => styles, flatten: (style) => Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style || {} },
  };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../src/components/TopBar', () => 'TopBar');
jest.mock('../src/theme/ThemeContext', () => ({ useTheme: () => ({
  colors: mockThemeColors, mode: mockThemeMode, isDark: mockThemeIsDark, setMode: mockSetMode,
}) }));
jest.mock('../src/context/AuthContext', () => ({ useAuth: () => ({ signOut: jest.fn() }) }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '9.8.7' } } }));

const { lightColors, darkColors } = require('../src/theme/theme');
const { StyleSheet } = require('react-native');
const root = path.join(__dirname, '../../..');
const src = path.join(__dirname, '../src');
const read = (relative) => fs.readFileSync(path.join(src, relative), 'utf8');

beforeEach(() => {
  mockThemeMode = 'system';
  mockThemeIsDark = false;
  mockThemeColors = lightColors;
  mockSetMode.mockClear();
});

function contrast(foreground, background) {
  const luminance = (hex) => {
    const channels = hex.slice(1).match(/.{2}/g).map((part) => parseInt(part, 16) / 255);
    const linear = channels.map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  };
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe('Slice 4C accessibility correction', () => {
  const { render, fireEvent, cleanup } = require('@testing-library/react-native');
  const SettingsScreen = require('../src/screens/SettingsScreen').default;
  const LicensesScreen = require('../src/screens/LicensesScreen').default;

  afterEach(cleanup);

  it('renders distinct 48dp appearance targets and preserves selection behavior', () => {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const screen = render(React.createElement(SettingsScreen, { navigation }));
    for (const label of ['Light', 'Dark', 'System']) {
      const option = screen.getByLabelText(`${label} appearance`);
      const style = StyleSheet.flatten(option.props.style);
      expect(style.minHeight).toBeGreaterThanOrEqual(48);
      expect(style.minWidth).toBeGreaterThanOrEqual(48);
      expect(option.props.hitSlop).toBeUndefined();
      expect(option.props.accessibilityState.selected).toBe(label === 'System');
    }
    fireEvent.press(screen.getByLabelText('Dark appearance'));
    expect(mockSetMode).toHaveBeenCalledWith('dark');
    mockThemeMode = 'dark';
    screen.rerender(React.createElement(SettingsScreen, { navigation }));
    expect(screen.getByLabelText('Dark appearance').props.accessibilityState.selected).toBe(true);
    expect(screen.getByLabelText('System appearance').props.accessibilityState.selected).toBe(false);
  });

  it('keeps license text above 4.5:1 on its rendered paper card in both themes', () => {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const screen = render(React.createElement(LicensesScreen, { navigation }));
    for (const [dark, palette] of [[false, lightColors], [true, darkColors]]) {
      mockThemeIsDark = dark;
      mockThemeColors = palette;
      screen.rerender(React.createElement(LicensesScreen, { navigation }));
      const badge = screen.getAllByText('MIT')[0];
      const foreground = StyleSheet.flatten(badge.props.style).color;
      let ancestor = badge.parent;
      let background;
      while (ancestor && !background) {
        background = StyleSheet.flatten(ancestor.props.style).backgroundColor;
        ancestor = ancestor.parent;
      }
      expect(background).toBe(palette.paper);
      expect(foreground).toBe(dark ? palette.inkSoft : palette.sageDeep);
      expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps Security action text above 4.5:1 on both card palettes', () => {
    const security = read('screens/SecurityScreen.js');
    expect(security).toMatch(/const \{ colors, isDark \} = useTheme\(\)/);
    expect(security).toMatch(/card: \{[\s\S]*?backgroundColor: colors\.paper/);
    expect(security).toMatch(/linkAction: \{[\s\S]*?color: isDark \? colors\.inkSoft : colors\.sageDeep/);
    expect(security).toMatch(/linkActionDisabled: \{ color: colors\.inkSoft \}/);
    expect(security).toMatch(/<View style=\{styles\.card\}>[\s\S]*?<Text style=\{styles\.linkAction\}>Cancel request/);
    for (const [foreground, background] of [
      [lightColors.sageDeep, lightColors.paper],
      [darkColors.inkSoft, darkColors.paper],
      [lightColors.inkSoft, lightColors.paper],
    ]) expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('Slice 4C rendered support navigation', () => {
  const { render, fireEvent, cleanup } = require('@testing-library/react-native');
  const HelpCenterScreen = require('../src/screens/HelpCenterScreen').default;
  const AboutScreen = require('../src/screens/AboutScreen').default;

  afterEach(cleanup);

  it('opens the real Security route and expands truthful FAQ content', () => {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const screen = render(React.createElement(HelpCenterScreen, { navigation }));
    fireEvent.press(screen.getByLabelText('Account and security'));
    expect(navigation.navigate).toHaveBeenCalledWith('Security');
    fireEvent.press(screen.getByLabelText('Where can I manage my account security?'));
    expect(screen.getByText(/Two-factor authentication is not available yet/)).toBeTruthy();
    expect(screen.queryByText('Contact Support')).toBeNull();
  });

  it('shows the configured app version and opens each real legal route', () => {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const screen = render(React.createElement(AboutScreen, { navigation }));
    expect(screen.getByText('Version 9.8.7')).toBeTruthy();
    for (const [label, route] of [
      ['Terms of Service', 'Terms'], ['Privacy Policy', 'Privacy'], ['Open Source Licenses', 'Licenses'],
    ]) {
      fireEvent.press(screen.getByLabelText(label));
      expect(navigation.navigate).toHaveBeenCalledWith(route);
    }
  });
});

describe('Slice 4C route and support integrity', () => {
  it('keeps Settings destinations registered and Help on a real authenticated route', () => {
    const nav = read('navigation/RootNavigator.js');
    const help = read('screens/HelpCenterScreen.js');
    for (const route of ['AccountDetails', 'Security', 'Notifications', 'HelpCenter', 'About', 'Terms', 'Privacy', 'Licenses']) {
      expect(nav).toContain(`name="${route}"`);
    }
    expect(help).toMatch(/navigation\.navigate\('Security'\)/);
    expect(help).not.toMatch(/Onboarding|mailto:|support@wecooked\.app|data\/mockData/);
    expect(help).toContain('Support unavailable: direct contact is not configured');
    expect(help).not.toMatch(/Assistant, Community, Meal Planning, Reviews, Collections, Cook History/);
  });

  it('reads the built app version and permits native system appearance', () => {
    expect(read('screens/AboutScreen.js')).toMatch(/Constants\.expoConfig\?\.version \|\| Constants\.nativeAppVersion/);
    const config = JSON.parse(fs.readFileSync(path.join(root, 'apps/mobile/app.json'), 'utf8')).expo;
    const mobile = require('../package.json');
    const lock = require('../../../package-lock.json');
    expect(config.userInterfaceStyle).toBe('automatic');
    expect(config.plugins).toContain('expo-system-ui');
    expect(mobile.dependencies['expo-system-ui']).toBe('~57.0.4');
    expect(lock.packages['apps/mobile/node_modules/expo-system-ui'].version).toBe('57.0.4');
  });
});

describe('Slice 4C legal and dependency data integrity', () => {
  const legal = {
    Terms: {
      sections: '0431afa561b102fc3fc116efd2c53143a5c4de7f5b824ad06deaa9bb1b64bd1b',
      intro: 'eeaa8a66e5c030c9593378e53ba545e972b903025d7427e5dece16572ec76904',
    },
    Privacy: {
      sections: '9d7e4eea7ead4148402683b5f367ebd40b23d1423fa5c781498dcc24da8f0623',
      intro: '4a04aaf895519846134b3e0d2fb3d41801cc91e15b71751399fb66816e2a493e',
    },
  };

  it.each(['Terms', 'Privacy'])('retains the repository legal copy in %s', (screen) => {
    const source = read(`screens/${screen}Screen.js`);
    const sections = source.match(/const SECTIONS = \[[\s\S]*?\n\];/)?.[0];
    const intro = source.match(/<Text style=\{styles\.intro\}>[\s\S]*?<\/Text>/)?.[0];
    const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
    expect(hash(sections)).toBe(legal[screen].sections);
    expect(hash(intro)).toBe(legal[screen].intro);
    expect(source).toMatch(/accessibilityRole="header"/);
  });

  it('displays only declared, lockfile-verified direct mobile dependencies', () => {
    const mobile = require('../package.json');
    const lock = require('../../../package-lock.json');
    const { licenses } = require('../src/data/licenses');
    const names = Object.keys(mobile.dependencies).filter((name) => name !== '@wecooked/contracts').sort();
    expect(licenses.map((entry) => entry.name).sort()).toEqual(names);
    for (const entry of licenses) {
      const resolved = lock.packages[`apps/mobile/node_modules/${entry.name}`]
        || lock.packages[`node_modules/${entry.name}`];
      expect(entry.version).toBe(resolved.version);
      expect(entry.license).toBe(resolved.license);
    }
    expect(read('screens/LicensesScreen.js')).toContain("from '../data/licenses'");
    expect(read('screens/LicensesScreen.js')).toContain('Direct third-party mobile packages');
  });
});

const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;

let mockScheme = 'light';
jest.mock('react-native', () => ({ useColorScheme: () => mockScheme }));
jest.mock('../src/utils/storage', () => ({ loadJSON: jest.fn(), saveJSON: jest.fn() }));

const { loadJSON, saveJSON } = require('../src/utils/storage');
const { ThemeProvider, useTheme } = require('../src/theme/ThemeContext');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

let currentTheme;
function Observer() {
  currentTheme = useTheme();
  return null;
}

async function mount() {
  let tree;
  await act(async () => {
    tree = create(React.createElement(ThemeProvider, null, React.createElement(Observer)));
  });
  return tree;
}

beforeEach(() => {
  mockScheme = 'light';
  currentTheme = null;
  loadJSON.mockReset();
  saveJSON.mockReset();
  saveJSON.mockResolvedValue(undefined);
});

it('hydrates a valid saved mode and follows OS changes in System mode', async () => {
  loadJSON.mockResolvedValue('system');
  const tree = await mount();
  expect(loadJSON).toHaveBeenCalledWith('wecooked:themeMode', 'system');
  expect(currentTheme.mode).toBe('system');
  expect(currentTheme.isDark).toBe(false);
  mockScheme = 'dark';
  await act(async () => { tree.update(React.createElement(ThemeProvider, null, React.createElement(Observer))); });
  expect(currentTheme.isDark).toBe(true);
  await act(async () => { tree.unmount(); });
});

it('keeps a user selection made before hydration and saves it', async () => {
  const pending = deferred();
  loadJSON.mockReturnValue(pending.promise);
  const tree = await mount();
  await act(async () => { currentTheme.setMode('dark'); });
  expect(currentTheme.mode).toBe('dark');
  await act(async () => { pending.resolve('light'); await pending.promise; });
  expect(currentTheme.mode).toBe('dark');
  expect(saveJSON).toHaveBeenCalledWith('wecooked:themeMode', 'dark');
  await act(async () => { tree.unmount(); });
});

it('rejects unsupported stored and selected values', async () => {
  loadJSON.mockResolvedValue('unknown');
  const tree = await mount();
  expect(currentTheme.mode).toBe('system');
  await act(async () => { currentTheme.setMode('unknown'); });
  expect(currentTheme.mode).toBe('system');
  expect(saveJSON).not.toHaveBeenCalled();
  await act(async () => { tree.unmount(); });
});

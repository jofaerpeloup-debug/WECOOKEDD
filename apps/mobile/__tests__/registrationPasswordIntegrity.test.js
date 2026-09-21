jest.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  BackHandler: { addEventListener: jest.fn() },
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  Platform: { OS: 'ios' },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles) => styles },
  Text: 'Text',
  View: 'View',
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));

jest.mock('../src/theme/ThemeContext', () => ({
  useTheme: () => ({ colors: {}, isDark: false }),
}));

jest.mock('../src/theme/brandKit', () => ({
  BowlMark: 'BowlMark',
  GoogleGlyph: 'GoogleGlyph',
}));

jest.mock('../src/components/Input', () => ({
  __esModule: true,
  default: 'Input',
  PasswordRequirements: 'PasswordRequirements',
}));

jest.mock('../src/components/Button', () => ({ __esModule: true, default: 'Button' }));
jest.mock('../src/hooks/useGoogleSignIn', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../src/context/AuthContext', () => ({ useAuth: jest.fn() }));

import {
  getRegistrationPasswordAutofillProps,
  prepareRegistrationSubmission,
} from '../src/screens/RegisterScreen';

describe('registration password credential integrity', () => {
  const validForm = {
    name: '  Ada Cook  ',
    email: '  ada@example.com  ',
    password: 'Generated1!',
  };

  it('blocks an empty password with no payload or hidden fallback', () => {
    const submission = prepareRegistrationSubmission({ ...validForm, password: '' });
    expect(submission.fieldErrors.password).toBeTruthy();
    expect(submission.payload).toBeNull();
  });

  it('submits the exact valid password state without transforming it', () => {
    const submission = prepareRegistrationSubmission(validForm);
    expect(submission.fieldErrors).toEqual({ name: null, email: null, password: null });
    expect(submission.payload).toEqual({
      name: 'Ada Cook',
      email: 'ada@example.com',
      password: validForm.password,
    });
    expect(submission.payload.password).toBe(validForm.password);
  });

  it('blocks state cleared after an autofill-like valid value', () => {
    expect(prepareRegistrationSubmission(validForm).payload.password).toBe(validForm.password);
    const cleared = prepareRegistrationSubmission({ ...validForm, password: '' });
    expect(cleared.payload).toBeNull();
  });

  it('blocks state changed from valid to invalid', () => {
    expect(prepareRegistrationSubmission(validForm).payload).not.toBeNull();
    expect(
      prepareRegistrationSubmission({ ...validForm, password: 'Generated1' }).payload
    ).toBeNull();
  });

  it('disables only iOS registration generated-password semantics', () => {
    expect(getRegistrationPasswordAutofillProps('ios')).toEqual({ textContentType: 'none' });
    expect(getRegistrationPasswordAutofillProps('android')).toEqual({
      autoComplete: 'new-password',
    });
    expect(getRegistrationPasswordAutofillProps('web')).toEqual({
      autoComplete: 'new-password',
    });
  });
});

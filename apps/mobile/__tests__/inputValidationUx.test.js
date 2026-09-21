const mockStateSetters = [];

jest.mock('react', () => {
  const actual = jest.requireActual('react');
  return {
    ...actual,
    useState: (initialValue) => {
      const setter = jest.fn();
      mockStateSetters.push({ initialValue, setter });
      return [initialValue, setter];
    },
  };
});

jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  TextInput: 'TextInput',
  Pressable: 'Pressable',
  StyleSheet: { create: (styles) => styles },
  Platform: {
    OS: 'ios',
    select: (values) => values.ios ?? values.native ?? values.default,
  },
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

jest.mock('../src/theme/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      inkFaint: '#888',
      inkSoft: '#666',
      ink: '#222',
      paper: '#fff',
      hairline: '#ddd',
      sageDeep: '#465',
      error: '#b43',
      success: '#465',
    },
  }),
}));

import fs from 'fs';
import path from 'path';
import { Platform } from 'react-native';
import {
  NEW_PASSWORD_ERROR_MESSAGES,
  PASSWORD_MAX_UTF8_BYTES,
  utf8ByteLength,
} from '@wecooked/contracts';
import { ApiError } from '../src/api/client';
import {
  PASSWORD_TOO_LONG_MESSAGE,
  getAuthFieldErrors,
  getEmailValidationError,
  getLegacyPasswordValidationError,
  getNewPasswordValidationError,
} from '../src/api/errorMessages';
import Input, { PasswordRequirements, getInputAccessibilityProps } from '../src/components/Input';

const SRC = path.join(__dirname, '../src');
const read = (relativePath) => fs.readFileSync(path.join(SRC, relativePath), 'utf8');

function elementsOfType(node, type) {
  if (Array.isArray(node)) return node.flatMap((child) => elementsOfType(child, type));
  if (!node || typeof node !== 'object') return [];
  const matches = node.type === type ? [node] : [];
  const children = Array.isArray(node.props?.children)
    ? node.props.children
    : [node.props?.children];
  return matches.concat(children.flatMap((child) => elementsOfType(child, type)));
}

function requirementLabels(value) {
  return elementsOfType(PasswordRequirements({ value }), 'Text')
    .map((element) => element.props.accessibilityLabel)
    .filter(Boolean);
}

describe('shared Input accessibility behavior', () => {
  beforeEach(() => {
    mockStateSetters.length = 0;
    Platform.OS = 'ios';
  });

  it.each(['ios', 'android'])(
    'communicates native required/error state through supported semantics on %s',
    (platform) => {
      Platform.OS = platform;
      const tree = Input({
        label: 'Email address',
        required: true,
        error: 'Enter a valid email address.',
      });
      const props = elementsOfType(tree, 'TextInput')[0].props;
      expect(props.accessibilityLabel).toBe('Email address, required');
      expect(props.accessibilityHint).toBe('Error: Enter a valid email address.');
      expect(props).not.toHaveProperty('aria-required');
      expect(props).not.toHaveProperty('aria-invalid');
    }
  );

  it('uses ARIA required/invalid only on web', () => {
    Platform.OS = 'web';
    const tree = Input({
      label: 'Email address',
      required: true,
      error: 'Enter a valid email address.',
    });
    expect(elementsOfType(tree, 'TextInput')[0].props).toMatchObject({
      accessibilityLabel: 'Email address',
      'aria-required': true,
      'aria-invalid': true,
    });

    for (const platform of ['ios', 'android']) {
      const props = getInputAccessibilityProps({ platform, label: 'Email address' });
      expect(props).not.toHaveProperty('aria-required');
      expect(props).not.toHaveProperty('aria-invalid');
    }
  });

  it('uses the supported live region only on Android while keeping error text accessible elsewhere', () => {
    Platform.OS = 'android';
    const androidError = elementsOfType(
      Input({ label: 'Email', error: 'Enter a valid email address.' }),
      'Text'
    ).find((element) => element.props.children === 'Enter a valid email address.');
    expect(androidError.props.accessibilityLiveRegion).toBe('polite');

    mockStateSetters.length = 0;
    Platform.OS = 'ios';
    const iosError = elementsOfType(
      Input({ label: 'Email', error: 'Enter a valid email address.' }),
      'Text'
    ).find((element) => element.props.children === 'Enter a valid email address.');
    expect(iosError.props.accessibilityLiveRegion).toBeUndefined();
    expect(elementsOfType(Input({ label: 'Email', error: 'Bad email.' }), 'TextInput')[0].props)
      .toMatchObject({ accessibilityHint: 'Error: Bad email.' });
  });

  it('preserves helper text and lets an error take precedence in visible and spoken content', () => {
    const helperTree = Input({ label: 'Name', helperText: 'As shown on your profile.' });
    expect(
      elementsOfType(helperTree, 'Text').some(
        (element) => element.props.children === 'As shown on your profile.'
      )
    ).toBe(true);
    expect(
      getInputAccessibilityProps({
        platform: 'ios',
        label: 'Name',
        helperText: 'As shown on your profile.',
        accessibilityHint: 'Original hint',
      }).accessibilityHint
    ).toBe('As shown on your profile.');

    mockStateSetters.length = 0;
    const errorTree = Input({
      label: 'Name',
      helperText: 'As shown on your profile.',
      error: 'Name is required.',
    });
    const visibleSupport = elementsOfType(errorTree, 'Text').map(
      (element) => element.props.children
    );
    expect(visibleSupport).toContain('Name is required.');
    expect(visibleSupport).not.toContain('As shown on your profile.');
    expect(
      getInputAccessibilityProps({
        platform: 'ios',
        label: 'Name',
        helperText: 'As shown on your profile.',
        error: 'Name is required.',
      }).accessibilityHint
    ).toBe('Error: Name is required.');
  });

  it('executes caller focus callbacks and preserves password visibility/value behavior', () => {
    const onFocus = jest.fn();
    const onBlur = jest.fn();
    const onChangeText = jest.fn();
    const tree = Input({
      label: 'Password',
      value: 'Unchanged1!',
      secureTextEntry: true,
      onFocus,
      onBlur,
      onChangeText,
    });
    const textInput = elementsOfType(tree, 'TextInput')[0];
    const eyeToggle = elementsOfType(tree, 'Pressable').find((element) =>
      element.props.accessibilityLabel?.startsWith('Show')
    );
    const focusEvent = { nativeEvent: {} };
    const blurEvent = { nativeEvent: {} };

    textInput.props.onFocus(focusEvent);
    textInput.props.onBlur(blurEvent);
    expect(mockStateSetters[1].setter).toHaveBeenNthCalledWith(1, true);
    expect(mockStateSetters[1].setter).toHaveBeenNthCalledWith(2, false);
    expect(onFocus).toHaveBeenCalledWith(focusEvent);
    expect(onBlur).toHaveBeenCalledWith(blurEvent);

    eyeToggle.props.onPress();
    const toggle = mockStateSetters[0].setter.mock.calls[0][0];
    expect(toggle(true)).toBe(false);
    expect(toggle(false)).toBe(true);
    expect(textInput.props.value).toBe('Unchanged1!');
    expect(onChangeText).not.toHaveBeenCalled();
  });

  it('keeps callers without helper/error/required props compatible', () => {
    const tree = Input({ label: 'Nickname', value: 'Chef' });
    const textInput = elementsOfType(tree, 'TextInput')[0];
    expect(textInput.props.accessibilityLabel).toBe('Nickname');
    expect(textInput.props.accessibilityHint).toBeUndefined();
    expect(textInput.props).not.toHaveProperty('aria-required');
    expect(textInput.props).not.toHaveProperty('aria-invalid');
  });
});

describe('mobile auth validation mirrors the shared contract', () => {
  it('accepts an approved Unicode password', () => {
    expect(getNewPasswordValidationError('Ångström1!')).toBeNull();
  });

  it.each([
    ['lowercase1!', NEW_PASSWORD_ERROR_MESSAGES.UPPERCASE],
    ['UPPERCASE1!', NEW_PASSWORD_ERROR_MESSAGES.LOWERCASE],
    ['Password!', NEW_PASSWORD_ERROR_MESSAGES.DIGIT],
    ['Password1', NEW_PASSWORD_ERROR_MESSAGES.SPECIAL],
  ])('rejects a password missing one required composition rule: %s', (password, message) => {
    expect(getNewPasswordValidationError(password)).toBe(message);
  });

  it.each(['Password1 ', 'Password1😀', 'Password1^', 'Password1+'])(
    'rejects unsupported password characters: %s',
    (password) => {
      expect(getNewPasswordValidationError(password)).toBe(
        NEW_PASSWORD_ERROR_MESSAGES.UNSUPPORTED
      );
    }
  );

  it('uses the shared UTF-8 byte counter at the 72-byte boundary', () => {
    const atBoundary = `A${'a'.repeat(69)}1!`;
    const overBoundary = `${atBoundary}a`;
    expect(utf8ByteLength(atBoundary)).toBe(PASSWORD_MAX_UTF8_BYTES);
    expect(getNewPasswordValidationError(atBoundary)).toBeNull();
    expect(getNewPasswordValidationError(overBoundary)).toBe(PASSWORD_TOO_LONG_MESSAGE);
  });

  it('keeps legacy login/current passwords free of new-password composition checks', () => {
    expect(getLegacyPasswordValidationError('simple')).toBeNull();
    expect(getLegacyPasswordValidationError('legacy password with spaces')).toBeNull();
    expect(getLegacyPasswordValidationError('a'.repeat(PASSWORD_MAX_UTF8_BYTES + 1))).toBe(
      PASSWORD_TOO_LONG_MESSAGE
    );
  });

  it('validates trimmed email syntax and the shared 254-character maximum without a .com rule', () => {
    const maxEmail = `${'a'.repeat(242)}@example.dev`;
    expect(maxEmail).toHaveLength(254);
    expect(getEmailValidationError('  chef@kitchen.ph  ')).toBeNull();
    expect(getEmailValidationError(maxEmail)).toBeNull();
    expect(getEmailValidationError(`${maxEmail}x`)).toBe(
      'Email must be 254 characters or fewer.'
    );
    expect(getEmailValidationError('not-an-email')).toBe('Enter a valid email address.');
    expect(getEmailValidationError('chef..name@example.com')).toBe('Enter a valid email address.');
    expect(getEmailValidationError('chef@example.c')).toBe('Enter a valid email address.');
  });
});

describe('registration password checklist transitions', () => {
  const validPassword = 'Generated1!';

  beforeEach(() => {
    mockStateSetters.length = 0;
  });

  it('keeps an empty password incomplete', () => {
    const labels = requirementLabels('');
    expect(labels).toEqual(expect.arrayContaining([
      'Not met: At least 8 characters',
      'Not met: One uppercase letter',
      'Not met: One lowercase letter',
      'Not met: One number',
      'Not met: One of ! @ # $ % & * ? _ - .',
    ]));
    expect(
      elementsOfType(PasswordRequirements({ value: '' }), 'Text')
        .some((element) => element.props.children === 'Meets password requirements')
    ).toBe(false);
  });

  it('reflects an autofill-like valid value and then an explicit clear immediately', () => {
    expect(requirementLabels(validPassword).every((label) => label.startsWith('Met:'))).toBe(true);
    expect(requirementLabels('').some((label) => label.startsWith('Not met:'))).toBe(true);
  });

  it('updates immediately when a valid value becomes invalid', () => {
    expect(requirementLabels(validPassword).every((label) => label.startsWith('Met:'))).toBe(true);
    expect(requirementLabels('Generated1').find((label) => label.includes('One of')))
      .toBe('Not met: One of ! @ # $ % & * ? _ - .');
  });
});

describe('field-level API validation mapping', () => {
  it('maps and preserves email/password messages while ignoring unrelated fields', () => {
    const error = new ApiError('Request validation failed.', {
      code: 'VALIDATION_ERROR',
      status: 400,
      details: [
        { field: 'email', message: 'Email must be 254 characters or fewer.' },
        { field: 'password', message: 'Password must contain at least one uppercase letter.' },
        { field: 'password', message: 'Password must contain at least one number.' },
        { field: 'role', message: 'Unrecognized key.' },
      ],
    });

    expect(getAuthFieldErrors(error, ['email', 'password'])).toEqual({
      email: 'Email must be 254 characters or fewer.',
      password:
        'Password must contain at least one uppercase letter. Password must contain at least one number.',
    });
  });

  it('does not treat non-validation failures as field errors', () => {
    expect(
      getAuthFieldErrors(
        new ApiError('No', { code: 'AUTH_INVALID_CREDENTIALS', status: 401 }),
        ['email', 'password']
      )
    ).toEqual({});
  });

  it('maps backend byte-limit details to the same plain-language field message', () => {
    const error = new ApiError('Request validation failed.', {
      code: 'VALIDATION_ERROR',
      status: 400,
      details: [{ field: 'password', message: NEW_PASSWORD_ERROR_MESSAGES.MAX_BYTES }],
    });
    expect(getAuthFieldErrors(error, ['password'])).toEqual({
      password: PASSWORD_TOO_LONG_MESSAGE,
    });
  });
});

describe('shared Input and auth-screen UX invariants', () => {
  const input = read('components/Input.js');
  const register = read('screens/RegisterScreen.js');
  const login = read('screens/LoginScreen.js');
  const reset = read('screens/ResetPasswordScreen.js');
  const security = read('screens/SecurityScreen.js');

  it('renders the live shared-contract checklist with deterministic wording', () => {
    expect(input).toMatch(/validateNewPassword\(value\)/);
    expect(input).toMatch(/Password requirements/);
    expect(input).toMatch(/Meets password requirements/);
    expect(input).not.toMatch(/Strong password|Weak|Fair/);
  });

  it('registration has no confirm-password field and sends only name/email/password', () => {
    expect(register).not.toMatch(/confirmPassword|Confirm Password/);
    expect(register).toMatch(/prepareRegistrationSubmission\(\{ name, email, password \}\)/);
    expect(register).toMatch(/await signUp\(submission\.payload\)/);
    expect(register).toMatch(/<PasswordRequirements value=\{password\} \/>/);
  });

  it('login uses legacy validation and never renders the new-password checklist', () => {
    expect(login).toMatch(/getLegacyPasswordValidationError\(password\)/);
    expect(login).not.toMatch(/PasswordRequirements|getNewPasswordValidationError/);
  });

  it('reset and change-password keep confirmation frontend-only', () => {
    expect(reset).toMatch(/Passwords do not match\./);
    expect(reset).toMatch(/resetPassword\(\{ token, newPassword \}\)/);
    expect(reset).not.toMatch(/resetPassword\(\{[^}]*confirmPassword/);
    expect(security).toMatch(/Passwords do not match\./);
    expect(security).toMatch(/changePassword\(\{ currentPassword, newPassword \}\)/);
    expect(security).not.toMatch(/changePassword\(\{[^}]*confirmPassword/);
  });
});

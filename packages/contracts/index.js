const PASSWORD_MIN_CHARS = 8;
const PASSWORD_MAX_UTF8_BYTES = 72;
const PASSWORD_ALLOWED_SPECIAL_CHARS = '!@#$%&*?_-.';
const EMAIL_MAX_CHARS = 254;

const UPPERCASE_LETTER_PATTERN = /\p{Lu}/u;
const LOWERCASE_LETTER_PATTERN = /\p{Ll}/u;
const ASCII_DIGIT_PATTERN = /[0-9]/;
const APPROVED_SPECIAL_PATTERN = /[!@#$%&*?_.-]/;
const SUPPORTED_PASSWORD_PATTERN = /^[\p{L}0-9!@#$%&*?_.-]+$/u;

const NEW_PASSWORD_ERROR_MESSAGES = Object.freeze({
  MIN_CHARS: `Password must contain at least ${PASSWORD_MIN_CHARS} characters.`,
  UPPERCASE: 'Password must contain at least one uppercase letter.',
  LOWERCASE: 'Password must contain at least one lowercase letter.',
  DIGIT: 'Password must contain at least one number.',
  SPECIAL: `Password must contain at least one of: ${PASSWORD_ALLOWED_SPECIAL_CHARS
    .split('')
    .join(' ')}.`,
  UNSUPPORTED: 'Password contains unsupported characters.',
  MAX_BYTES: `Password must be ${PASSWORD_MAX_UTF8_BYTES} UTF-8 bytes or fewer.`,
});

// Dependency-free and consistent with UTF-8 encoders: lone UTF-16 surrogates
// count as the three-byte replacement character, while valid surrogate pairs
// count as one four-byte Unicode code point.
function utf8ByteLength(value) {
  let bytes = 0;

  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.codePointAt(index);
    if (codePoint <= 0x7f) {
      bytes += 1;
    } else if (codePoint <= 0x7ff) {
      bytes += 2;
    } else if (codePoint <= 0xffff) {
      bytes += 3;
    } else {
      bytes += 4;
      index += 1;
    }
  }

  return bytes;
}

function validateNewPassword(password) {
  const errors = [];

  if (Array.from(password).length < PASSWORD_MIN_CHARS) {
    errors.push(NEW_PASSWORD_ERROR_MESSAGES.MIN_CHARS);
  }
  if (!UPPERCASE_LETTER_PATTERN.test(password)) {
    errors.push(NEW_PASSWORD_ERROR_MESSAGES.UPPERCASE);
  }
  if (!LOWERCASE_LETTER_PATTERN.test(password)) {
    errors.push(NEW_PASSWORD_ERROR_MESSAGES.LOWERCASE);
  }
  if (!ASCII_DIGIT_PATTERN.test(password)) {
    errors.push(NEW_PASSWORD_ERROR_MESSAGES.DIGIT);
  }
  if (!APPROVED_SPECIAL_PATTERN.test(password)) {
    errors.push(NEW_PASSWORD_ERROR_MESSAGES.SPECIAL);
  }
  if (!SUPPORTED_PASSWORD_PATTERN.test(password)) {
    errors.push(NEW_PASSWORD_ERROR_MESSAGES.UNSUPPORTED);
  }
  if (utf8ByteLength(password) > PASSWORD_MAX_UTF8_BYTES) {
    errors.push(NEW_PASSWORD_ERROR_MESSAGES.MAX_BYTES);
  }

  return errors;
}

module.exports = {
  PASSWORD_MIN_CHARS,
  PASSWORD_MAX_UTF8_BYTES,
  PASSWORD_ALLOWED_SPECIAL_CHARS,
  EMAIL_MAX_CHARS,
  NEW_PASSWORD_ERROR_MESSAGES,
  utf8ByteLength,
  validateNewPassword,
};

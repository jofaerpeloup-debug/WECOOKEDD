import {
  EMAIL_MAX_CHARS,
  NEW_PASSWORD_ERROR_MESSAGES,
  PASSWORD_ALLOWED_SPECIAL_CHARS,
  PASSWORD_MAX_UTF8_BYTES,
  PASSWORD_MIN_CHARS,
  utf8ByteLength,
  validateNewPassword,
} from '@wecooked/contracts';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const STAFF_AUTH_ERROR_MESSAGES = Object.freeze({
  NAME_REQUIRED: 'Name is required.',
  EMAIL_REQUIRED: 'Email is required.',
  EMAIL_INVALID: 'Enter a valid email address.',
  EMAIL_MAX_CHARS: `Email must be ${EMAIL_MAX_CHARS} characters or fewer.`,
  PASSWORD_REQUIRED: 'Password is required.',
  PASSWORD_MAX_BYTES: `Password must be ${PASSWORD_MAX_UTF8_BYTES} UTF-8 bytes or fewer.`,
});

export const PASSWORD_REQUIREMENTS = Object.freeze([
  Object.freeze({
    message: NEW_PASSWORD_ERROR_MESSAGES.MIN_CHARS,
    label: `At least ${PASSWORD_MIN_CHARS} characters`,
  }),
  Object.freeze({
    message: NEW_PASSWORD_ERROR_MESSAGES.UPPERCASE,
    label: 'One uppercase letter',
  }),
  Object.freeze({
    message: NEW_PASSWORD_ERROR_MESSAGES.LOWERCASE,
    label: 'One lowercase letter',
  }),
  Object.freeze({
    message: NEW_PASSWORD_ERROR_MESSAGES.DIGIT,
    label: 'One number',
  }),
  Object.freeze({
    message: NEW_PASSWORD_ERROR_MESSAGES.SPECIAL,
    label: `One of ${PASSWORD_ALLOWED_SPECIAL_CHARS.split('').join(' ')}`,
  }),
  Object.freeze({
    message: NEW_PASSWORD_ERROR_MESSAGES.UNSUPPORTED,
    label: 'No unsupported characters',
  }),
  Object.freeze({
    message: NEW_PASSWORD_ERROR_MESSAGES.MAX_BYTES,
    label: `${PASSWORD_MAX_UTF8_BYTES} UTF-8 bytes or fewer`,
  }),
]);

export function passwordRequirementState(password) {
  const errors = new Set(validateNewPassword(password));
  return {
    requirements: PASSWORD_REQUIREMENTS.map((requirement) => ({
      ...requirement,
      met: !errors.has(requirement.message),
    })),
    errors: [...errors],
    meetsRequirements: errors.size === 0,
  };
}

export function validateStaffEmail(email) {
  const normalizedEmail = email.trim();
  if (!normalizedEmail) return [STAFF_AUTH_ERROR_MESSAGES.EMAIL_REQUIRED];
  if (normalizedEmail.length > EMAIL_MAX_CHARS) {
    return [STAFF_AUTH_ERROR_MESSAGES.EMAIL_MAX_CHARS];
  }
  return EMAIL_PATTERN.test(normalizedEmail)
    ? []
    : [STAFF_AUTH_ERROR_MESSAGES.EMAIL_INVALID];
}

export function validateStaffRegistration({ name, email, password }) {
  return {
    name: name.trim() ? [] : [STAFF_AUTH_ERROR_MESSAGES.NAME_REQUIRED],
    email: validateStaffEmail(email),
    password: validateNewPassword(password),
  };
}

export function validateStaffLogin({ email, password }) {
  const passwordErrors = [];
  if (!password) passwordErrors.push(STAFF_AUTH_ERROR_MESSAGES.PASSWORD_REQUIRED);
  if (utf8ByteLength(password) > PASSWORD_MAX_UTF8_BYTES) {
    passwordErrors.push(STAFF_AUTH_ERROR_MESSAGES.PASSWORD_MAX_BYTES);
  }

  return {
    email: validateStaffEmail(email),
    password: passwordErrors,
  };
}

export function hasStaffAuthErrors(fieldErrors) {
  return Object.values(fieldErrors).some((messages) => messages.length > 0);
}

export const staffPaths = Object.freeze({
  state: '/staff/me',
  applications: '/staff/moderator-applications',
  forgotPassword: '/auth/forgot-password',
  approve: (applicationId) => `/staff/moderator-applications/${encodeURIComponent(applicationId)}/approve`,
  reject: (applicationId) => `/staff/moderator-applications/${encodeURIComponent(applicationId)}/reject`,
  demote: (userId) => `/staff/moderators/${encodeURIComponent(userId)}/demote`,
});

export function registrationPayload({ name, email, password }) {
  return { name: name.trim(), email: email.trim(), password };
}

export function loginPayload({ email, password }) {
  return { email: email.trim(), password };
}

export function emptyStaffActionBody() {
  return {};
}

export function rejectionPayload(reason) {
  return { reason: reason.trim() };
}

export const staffRequests = Object.freeze({
  apply: () => ({
    method: 'POST',
    path: staffPaths.applications,
    body: emptyStaffActionBody(),
  }),
  approve: (applicationId) => ({
    method: 'POST',
    path: staffPaths.approve(applicationId),
    body: emptyStaffActionBody(),
  }),
  reject: (applicationId, reason) => ({
    method: 'POST',
    path: staffPaths.reject(applicationId),
    body: rejectionPayload(reason),
  }),
  demote: (userId) => ({
    method: 'POST',
    path: staffPaths.demote(userId),
    body: emptyStaffActionBody(),
  }),
  forgotPassword: (email) => ({
    method: 'POST',
    path: staffPaths.forgotPassword,
    auth: false,
    body: { email: email.trim().toLowerCase() },
  }),
});

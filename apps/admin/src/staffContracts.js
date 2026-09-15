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

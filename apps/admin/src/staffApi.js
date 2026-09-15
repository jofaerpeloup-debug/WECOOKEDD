import { api } from './apiClient.js';
import { staffPaths, staffRequests } from './staffContracts.js';

function execute({ path, ...options }) {
  return api.request(path, options);
}

export function getStaffState() {
  return api.get(staffPaths.state);
}

export function applyAsModerator() {
  return execute(staffRequests.apply());
}

export function listModeratorApplications({ status = 'pending', page = 1, limit = 20 } = {}) {
  return api.get(staffPaths.applications, { query: { status, page, limit } });
}

export async function listAllModeratorApplications({ status, limit = 100 }) {
  const first = await listModeratorApplications({ status, page: 1, limit });
  const totalPages = first.pagination?.totalPages || 1;
  if (totalPages <= 1) return first;

  const remaining = await Promise.all(
    Array.from({ length: totalPages - 1 }, (_, index) =>
      listModeratorApplications({ status, page: index + 2, limit })),
  );

  return {
    applications: [
      ...first.applications,
      ...remaining.flatMap((result) => result.applications),
    ],
    pagination: first.pagination,
  };
}

export function approveModeratorApplication(applicationId) {
  return execute(staffRequests.approve(applicationId));
}

export function rejectModeratorApplication(applicationId, reason) {
  return execute(staffRequests.reject(applicationId, reason));
}

export function demoteModerator(userId) {
  return execute(staffRequests.demote(userId));
}

export function requestBackendPasswordReset(email) {
  return execute(staffRequests.forgotPassword(email));
}

export function resendBackendVerification(email) {
  return api.post('/auth/resend-verification', {
    auth: false,
    body: { email: email.trim() },
  });
}

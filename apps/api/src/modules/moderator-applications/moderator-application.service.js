const applicationRepository = require('./moderator-application.repository');
const userRepository = require('../users/user.repository');
const { AppError } = require('../../shared/errors/app-error');

const DUPLICATE_KEY_ERROR_CODE = 11000;

function appError(message, statusCode, code) {
  return new AppError(message, { statusCode, code });
}

function hasLocalPassword(user) {
  return typeof user?.passwordHash === 'string' && user.passwordHash.trim().length > 0;
}

function applicationNotFound() {
  return appError('Moderator application not found.', 404, 'MODERATOR_APPLICATION_NOT_FOUND');
}

function applicationNotPending() {
  return appError(
    'Moderator application is no longer pending.',
    409,
    'MODERATOR_APPLICATION_NOT_PENDING'
  );
}

async function apply(userId) {
  const user = await userRepository.findModeratorApplicantById(userId);
  if (!user || user.status !== 'active' || user.role !== 'user') {
    throw appError(
      'This account is not eligible to apply for Moderator.',
      409,
      'MODERATOR_APPLICATION_NOT_ELIGIBLE'
    );
  }
  if (!hasLocalPassword(user)) {
    throw appError(
      'A local password is required to apply for Moderator.',
      409,
      'MODERATOR_APPLICATION_PASSWORD_REQUIRED'
    );
  }

  if (await applicationRepository.findPendingByUserId(userId)) {
    throw appError(
      'A Moderator application is already pending.',
      409,
      'MODERATOR_APPLICATION_ALREADY_PENDING'
    );
  }

  try {
    return await applicationRepository.createPending(userId);
  } catch (error) {
    // The unique partial index is authoritative for concurrent requests. Do
    // not expose Mongo's index name/key payload.
    if (error?.code === DUPLICATE_KEY_ERROR_CODE) {
      throw appError(
        'A Moderator application is already pending.',
        409,
        'MODERATOR_APPLICATION_ALREADY_PENDING'
      );
    }
    throw error;
  }
}

async function getStaffState(userId) {
  const user = await userRepository.findById(userId);
  if (!user || user.status !== 'active') {
    throw appError('Session is no longer valid.', 401, 'AUTH_SESSION_INVALID');
  }

  if (user.role === 'admin') return { mode: 'admin', application: null };
  if (user.role === 'moderator') return { mode: 'moderator', application: null };

  const pending = await applicationRepository.findPendingByUserId(userId);
  if (pending) {
    return {
      mode: user.emailVerified ? 'pending' : 'verify_email',
      application: pending,
    };
  }

  const latest = await applicationRepository.findLatestByUserId(userId);
  if (latest?.status === 'rejected') return { mode: 'rejected', application: latest };
  return { mode: 'consumer', application: null };
}

async function list({ status, page, limit }) {
  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    applicationRepository.findManyForAdmin({ status, skip, limit }),
    applicationRepository.countByStatus(status),
  ]);
  return { items, total, page, limit };
}

async function loadPendingDecision(applicationId) {
  const application = await applicationRepository.findById(applicationId);
  if (!application) throw applicationNotFound();
  if (application.status !== 'pending') throw applicationNotPending();
  return application;
}

async function approve({ applicationId, reviewedBy }) {
  const application = await loadPendingDecision(applicationId);
  const user = await userRepository.findModeratorApplicantById(application.userId);

  if (!user || user.status !== 'active' || user.role !== 'user') {
    throw appError(
      'The applicant is no longer eligible for approval.',
      409,
      'MODERATOR_APPLICATION_NOT_ELIGIBLE'
    );
  }
  if (!user.emailVerified) {
    throw appError(
      'The applicant must verify their email before approval.',
      409,
      'MODERATOR_APPLICATION_EMAIL_UNVERIFIED'
    );
  }
  if (!hasLocalPassword(user)) {
    throw appError(
      'The applicant no longer has a required local password.',
      409,
      'MODERATOR_APPLICATION_PASSWORD_REQUIRED'
    );
  }

  const reviewedAt = new Date();
  const approved = await applicationRepository.approvePending(applicationId, {
    reviewedAt,
    reviewedBy,
  });
  if (!approved) throw applicationNotPending();

  try {
    const promoted = await userRepository.promoteEligibleUserToModerator(application.userId);
    if (!promoted) {
      throw appError(
        'The applicant is no longer eligible for approval.',
        409,
        'MODERATOR_APPLICATION_NOT_ELIGIBLE'
      );
    }
    return { application: approved, user: promoted };
  } catch (promotionError) {
    try {
      const rolledBack = await applicationRepository.rollbackApproval(applicationId, {
        reviewedAt,
        reviewedBy,
      });
      if (!rolledBack) {
        console.error('[moderator-applications] approval compensation did not match', {
          applicationId: String(applicationId),
          reviewedBy: String(reviewedBy),
        });
      }
    } catch {
      console.error('[moderator-applications] approval compensation failed', {
        applicationId: String(applicationId),
        reviewedBy: String(reviewedBy),
      });
    }

    if (promotionError instanceof AppError) throw promotionError;
    throw appError(
      'Moderator approval could not be completed.',
      500,
      'MODERATOR_APPROVAL_FAILED'
    );
  }
}

async function reject({ applicationId, reviewedBy, reason }) {
  await loadPendingDecision(applicationId);
  const rejected = await applicationRepository.rejectPending(applicationId, {
    reviewedAt: new Date(),
    reviewedBy,
    rejectionReason: reason,
  });
  if (!rejected) throw applicationNotPending();
  return rejected;
}

async function demote(userId) {
  const demoted = await userRepository.demoteModeratorToUser(userId);
  if (!demoted) {
    throw appError(
      'The target is not a current Moderator.',
      409,
      'MODERATOR_TARGET_INVALID'
    );
  }
  return demoted;
}

module.exports = { apply, getStaffState, list, approve, reject, demote, hasLocalPassword };

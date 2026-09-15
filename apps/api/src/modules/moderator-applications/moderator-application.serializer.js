function toApplication(application) {
  return {
    id: String(application._id),
    status: application.status,
    createdAt: application.createdAt,
    reviewedAt: application.reviewedAt ?? null,
    rejectionReason: application.rejectionReason ?? null,
  };
}

function toApplicantState(application) {
  return {
    ...toApplication(application),
    updatedAt: application.updatedAt,
  };
}

function toAdminApplication(application) {
  const applicant = application.userId;
  return {
    ...toApplication(application),
    applicant: applicant
      ? {
          id: String(applicant._id),
          name: applicant.name,
          email: applicant.email,
          emailVerified: applicant.emailVerified,
          role: applicant.role,
          status: applicant.status,
        }
      : null,
    reviewedBy: application.reviewedBy ? String(application.reviewedBy) : null,
  };
}

module.exports = { toApplication, toApplicantState, toAdminApplication };

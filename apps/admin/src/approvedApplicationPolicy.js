// `applications` must be the complete approved result set in the backend's
// deterministic newest-first order ({ createdAt: -1, _id: -1 }). Application
// history never grants authority: the current User.role remains authoritative,
// and at most the newest approval for that user may expose demotion.
export function classifyApprovedApplications(applications) {
  const seenApplicants = new Set();

  return applications.map((application) => {
    const applicantId = application.applicant?.id || null;
    const isLatestApproval = Boolean(applicantId) && !seenApplicants.has(applicantId);
    if (applicantId) seenApplicants.add(applicantId);

    const isCurrentAuthority =
      isLatestApproval && application.applicant?.role === 'moderator';

    return {
      application,
      isLatestApproval,
      isCurrentAuthority,
      isHistorical: !isCurrentAuthority,
    };
  });
}

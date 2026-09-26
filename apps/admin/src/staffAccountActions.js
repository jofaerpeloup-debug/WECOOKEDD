export async function updateStaffName({ requestUpdate, refreshUser }, name) {
  await requestUpdate(name);
  return refreshUser();
}

export async function completeStaffPasswordChange(
  { requestChange, clearSession, signOutFirebase },
  { currentPassword, newPassword },
) {
  await requestChange(currentPassword, newPassword);
  // The REST success means all backend sessions are already revoked. Clear the
  // local session before doing any best-effort Firebase mirror cleanup.
  clearSession();
  try {
    await signOutFirebase();
  } catch {
    // Firebase is not credential authority and must not prevent re-login.
  }
}

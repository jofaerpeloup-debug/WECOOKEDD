export async function registerModeratorApplicant({ register, apply, refresh }, details) {
  const user = await register(details);
  try {
    await apply();
  } catch (applicationError) {
    return { user, applicationSubmitted: false, applicationError };
  }
  const staffState = await refresh();
  return { user, applicationSubmitted: true, staffState };
}

export async function retryModeratorApplication({ apply, refresh }) {
  await apply();
  return refresh();
}

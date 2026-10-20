export function getSubstitutionErrorMessage(error) {
  if (!process.env.EXPO_PUBLIC_API_BASE_URL) return 'Substitutions are unavailable until the API service is configured.';
  if (error?.status === 404) return 'No substitutions are available for this ingredient.';
  if (error?.status >= 500) return 'The substitution service is having trouble. Please try again.';
  return error?.message || 'Could not load substitutions. Check your connection and try again.';
}

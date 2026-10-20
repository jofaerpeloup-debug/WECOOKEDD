const API_BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL || '').replace(/\/$/, '');

export async function getSubstitutesFor(sourceIngredientId) {
  if (!API_BASE_URL) throw new Error('Substitution service is not configured.');
  const response = await fetch(`${API_BASE_URL}/api/v1/substitutions?sourceIngredientId=${encodeURIComponent(sourceIngredientId)}`);
  if (!response.ok) {
    const error = new Error(`Substitution request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  const data = await response.json();
  if (!Array.isArray(data.substitutes)) throw new Error('The substitution service returned an invalid response.');
  return { substitutes: data.substitutes };
}

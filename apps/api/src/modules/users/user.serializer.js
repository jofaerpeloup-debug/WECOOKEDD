/**
 * Linked social identities as the account's OWNER may see them. Built
 * field-by-field from `provider` + `linkedAt` only: the provider-stable
 * `subject` is the durable authentication identity and is never public, so it
 * must not appear here even though it sits on the same embedded document.
 * Returns [] when the caller passed a document without identities.
 */
function toPublicAuthIdentities(authIdentities) {
  if (!Array.isArray(authIdentities)) {
    return [];
  }
  return authIdentities.map((identity) => ({
    provider: identity.provider,
    linkedAt: identity.linkedAt,
  }));
}

/**
 * Maps a User document to the public API representation. Never touches
 * passwordHash — it is excluded from the query projection upstream (model
 * has select: false) and is not read here even if a caller passed a
 * document that included it.
 *
 * `authIdentities` is the self-view of linked providers, reduced to provider +
 * linkedAt. Every response built with this serializer carries it, not only the
 * account screens: GET /users/me, PATCH /users/me, POST /auth/social/google/link,
 * and the register / login / Google-login session responses.
 */
function toPublicUser(user) {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    avatarUrl: user.avatar?.url ?? null,
    bio: user.bio ?? '',
    cookingLevel: user.cookingLevel ?? 'beginner',
    role: user.role,
    status: user.status,
    preferences: {
      dietaryPreferences: user.preferences?.dietaryPreferences ?? [],
      allergies: user.preferences?.allergies ?? [],
      notifications: {
        enabled: user.preferences?.notifications?.enabled ?? true,
      },
    },
    authIdentities: toPublicAuthIdentities(user.authIdentities),
    emailVerified: user.emailVerified,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

/**
 * Admin user-management representation, used by GET /api/v1/users and the
 * PATCH /api/v1/users/:userId response. Deliberately narrower than
 * toPublicUser: it omits `preferences` (dietary/allergy data is user-private
 * and has no bearing on role/status management — data minimisation). Builds a
 * plain object field-by-field, so `passwordHash`, `authIdentities`, `__v`, and
 * any other schema field can never leak even if a raw Mongoose document with
 * extra fields is passed in. `passwordHash` additionally never reaches here at
 * all — the model declares it `select: false` and no admin-users query opts
 * back in.
 */
function toAdminUserSummary(user) {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    emailVerified: user.emailVerified,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

module.exports = { toPublicUser, toAdminUserSummary };

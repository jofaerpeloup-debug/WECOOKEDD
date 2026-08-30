/**
 * Maps a User document to the public API representation. Never touches
 * passwordHash — it is excluded from the query projection upstream (model
 * has select: false) and is not read here even if a caller passed a
 * document that included it.
 */
function toPublicUser(user) {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    preferences: {
      dietaryPreferences: user.preferences?.dietaryPreferences ?? [],
      allergies: user.preferences?.allergies ?? [],
      notifications: {
        enabled: user.preferences?.notifications?.enabled ?? true,
      },
    },
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
 * plain object field-by-field, so `passwordHash`, `authProviders`, `__v`, and
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

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

module.exports = { toPublicUser };

const User = require('./user.model');

function createUser({ name, email, passwordHash }) {
  return User.create({ name, email, passwordHash });
}

function findById(id) {
  return User.findById(id);
}

function findByEmail(email) {
  return User.findOne({ email });
}

// The only path that ever loads passwordHash, used for login/credential
// verification — kept separate from findByEmail so nothing else can
// accidentally pull the hash into a response.
function findByEmailWithPassword(email) {
  return User.findOne({ email }).select('+passwordHash');
}

// Admin user-management list. Pure query mechanics — the caller (service)
// owns the filter/sort/skip/limit values and every policy decision. The
// model's `select: false` on passwordHash means the digest is never in the
// result set here.
function findMany({ filter, sort, skip, limit }) {
  return User.find(filter).sort(sort).skip(skip).limit(limit);
}

function countByFilter(filter) {
  return User.countDocuments(filter);
}

// runValidators re-checks the role/status enums on write; { new: true }
// returns the post-update document for the response. Returns null when no
// document matches the id (e.g. deleted between read and write).
function updateById(id, update) {
  return User.findByIdAndUpdate(id, update, { new: true, runValidators: true });
}

module.exports = {
  createUser,
  findById,
  findByEmail,
  findByEmailWithPassword,
  findMany,
  countByFilter,
  updateById,
};

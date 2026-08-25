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

module.exports = {
  createUser,
  findById,
  findByEmail,
  findByEmailWithPassword,
};

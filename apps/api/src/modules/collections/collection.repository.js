const Collection = require('./collection.model');

function createCollection(data) {
  return Collection.create(data);
}

function findManyByUser(userId) {
  return Collection.find({ userId }).sort({ createdAt: -1 });
}

// Every owned-lookup is scoped by { _id, userId } in one atomic query —
// never findById followed by a manual ownership check — so a collection
// belonging to another user reads as not-found, never as a permission error.
function findOwnedById(id, userId) {
  return Collection.findOne({ _id: id, userId });
}

function updateOwnedById(id, userId, update) {
  return Collection.findOneAndUpdate(
    { _id: id, userId },
    { $set: update },
    { returnDocument: 'after', runValidators: true }
  );
}

function deleteOwnedById(id, userId) {
  return Collection.findOneAndDelete({ _id: id, userId });
}

module.exports = {
  createCollection,
  findManyByUser,
  findOwnedById,
  updateOwnedById,
  deleteOwnedById,
};

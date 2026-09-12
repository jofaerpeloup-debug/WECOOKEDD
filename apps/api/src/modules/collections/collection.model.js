const mongoose = require('mongoose');

// A user-created Collection. Kept separate from Favorite (see favorite.model.js)
// even though both are personal recipe lists: Favorites is one implicit
// system list per user, while a Collection is a named, user-owned resource a
// person can create/rename/delete many of. Membership lives in its own
// document (collection-recipe.model.js), not an embedded array here, for the
// same reason Favorite is its own collection rather than a User field —
// unbounded per-collection growth and independent membership rows.
const NAME_MAX_LENGTH = 60;
const DESCRIPTION_MAX_LENGTH = 300;

const collectionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: NAME_MAX_LENGTH,
    },
    description: {
      type: String,
      trim: true,
      maxlength: DESCRIPTION_MAX_LENGTH,
    },
  },
  { timestamps: true }
);

// Backs "list my collections, newest first" (CollectionService#listCollections).
// Duplicate names for the same user are deliberately allowed — see
// collection.service.js — so there is no uniqueness constraint on name.
collectionSchema.index({ userId: 1, createdAt: -1 });

const Collection = mongoose.model('Collection', collectionSchema);

module.exports = Collection;
module.exports.NAME_MAX_LENGTH = NAME_MAX_LENGTH;
module.exports.DESCRIPTION_MAX_LENGTH = DESCRIPTION_MAX_LENGTH;

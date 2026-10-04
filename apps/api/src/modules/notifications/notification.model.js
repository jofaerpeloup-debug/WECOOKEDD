const mongoose = require('mongoose');

const NOTIFICATION_TYPES = Object.freeze([
  'savedRecipe',
  'cookCompleted',
  'collectionCreated',
  'cookReminder',
  'communityLike',
  'communityComment',
  'communityFollow',
]);
const ACTION_KINDS = Object.freeze(['none', 'recipe', 'communityPost', 'mealPlan']);
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

const contentSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, minlength: 1, maxlength: 120 },
    body: { type: String, required: true, trim: true, minlength: 1, maxlength: 500 },
  },
  { _id: false, strict: 'throw' }
);

const actionSchema = new mongoose.Schema(
  {
    kind: { type: String, required: true, enum: ACTION_KINDS },
    recipeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Recipe' },
    postId: { type: mongoose.Schema.Types.ObjectId, ref: 'CommunityPost' },
    entryId: { type: mongoose.Schema.Types.ObjectId, ref: 'MealPlanEntry' },
  },
  { _id: false, strict: 'throw' }
);

actionSchema.pre('validate', function validateDiscriminator() {
  const targets = ['recipeId', 'postId', 'entryId'].filter((field) => this[field] != null);
  const expected = {
    none: [],
    recipe: ['recipeId'],
    communityPost: ['postId'],
    mealPlan: ['entryId'],
  }[this.kind];
  if (!expected || targets.length !== expected.length || targets.some((field) => !expected.includes(field))) {
    this.invalidate('kind', 'Notification action does not match its discriminator.');
  }
});

const notificationSchema = new mongoose.Schema(
  {
    recipientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true,
    },
    type: { type: String, required: true, enum: NOTIFICATION_TYPES, immutable: true },
    eventKey: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 200,
      immutable: true,
    },
    content: { type: contentSchema, required: true, immutable: true },
    action: { type: actionSchema, required: true, immutable: true },
    readAt: { type: Date, default: null },
    archivedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true, immutable: true },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    strict: 'throw',
    autoIndex: false,
  }
);

notificationSchema.pre('validate', function setAndValidateExpiry() {
  if (!this.isNew) return;
  if (!this.createdAt) this.createdAt = new Date();
  const exactExpiry = new Date(this.createdAt.getTime() + RETENTION_MS);
  if (!this.expiresAt) this.expiresAt = exactExpiry;
  if (!(this.expiresAt instanceof Date) || this.expiresAt.getTime() !== exactExpiry.getTime()) {
    this.invalidate('expiresAt', 'expiresAt must be exactly 90 days after createdAt.');
  }
});

const Notification = mongoose.model('Notification', notificationSchema);

module.exports = Notification;
module.exports.NOTIFICATION_TYPES = NOTIFICATION_TYPES;
module.exports.ACTION_KINDS = ACTION_KINDS;
module.exports.RETENTION_MS = RETENTION_MS;

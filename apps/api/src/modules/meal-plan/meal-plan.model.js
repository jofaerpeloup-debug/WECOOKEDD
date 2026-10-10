const mongoose = require('mongoose');
const { isValidDateKey } = require('./meal-plan.validation');

const mealPlanEntrySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    dateKey: {
      type: String,
      required: true,
      validate: { validator: isValidDateKey, message: 'dateKey must be a real YYYY-MM-DD calendar date.' },
    },
    recipeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Recipe', required: true },
    reminder: {
      type: new mongoose.Schema({
        localTime: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
        timeZone: { type: String, required: true },
        fireAt: { type: Date, required: true },
      }, { _id: false, strict: 'throw' }),
      default: null,
    },
    reminderRevision: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
  },
  { timestamps: true }
);

// A day can contain many recipes, but the same recipe appears at most once on that day for one user.
mealPlanEntrySchema.index({ userId: 1, dateKey: 1, recipeId: 1 }, { unique: true });
// Backs owner-scoped range reads in stable card order.
mealPlanEntrySchema.index({ userId: 1, dateKey: 1, createdAt: 1, _id: 1 });

module.exports = mongoose.model('MealPlanEntry', mealPlanEntrySchema);

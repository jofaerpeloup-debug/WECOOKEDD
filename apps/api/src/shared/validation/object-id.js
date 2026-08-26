const mongoose = require('mongoose');
const { z } = require('zod');

// Shared by any Zod schema that needs to validate a Mongo ObjectId at the
// HTTP boundary (route params, or an id referenced from a request body).
const objectIdSchema = z.string().refine(mongoose.Types.ObjectId.isValid, 'Invalid id.');

module.exports = { objectIdSchema };
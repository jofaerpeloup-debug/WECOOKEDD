const mongoose = require('mongoose');

const pushInstallationSchema = new mongoose.Schema(
  {
    installationId: {
      type: String,
      required: true,
      immutable: true,
      lowercase: true,
      match: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    },
    bindingCredentialHash: {
      type: String,
      required: true,
      select: false,
      match: /^[0-9a-f]{64}$/,
    },
    recipientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session', required: true },
    provider: { type: String, required: true, enum: ['expo'], immutable: true },
    platform: { type: String, required: true, enum: ['ios', 'android'] },
    expoPushToken: {
      type: String,
      default: null,
      select: false,
      maxlength: 255,
      validate: {
        validator(value) {
          return value == null || /^(?:Expo|Exponent)PushToken\[[A-Za-z0-9_-]{1,200}\]$/.test(value);
        },
        message: 'Invalid Expo push token.',
      },
    },
    bindingGeneration: {
      type: Number,
      required: true,
      min: 1,
      validate: { validator: Number.isSafeInteger, message: 'Generation must be a safe integer.' },
    },
    status: { type: String, required: true, enum: ['active', 'unregistered'] },
    unregisteredAt: { type: Date, default: null },
  },
  { timestamps: true, strict: 'throw', autoIndex: false }
);

pushInstallationSchema.pre('validate', function validateState() {
  if (this.status === 'active' && (typeof this.expoPushToken !== 'string' || this.unregisteredAt != null)) {
    this.invalidate('status', 'Active installations require a token and no unregisteredAt.');
  }
  if (this.status === 'unregistered' && (this.expoPushToken != null || !(this.unregisteredAt instanceof Date))) {
    this.invalidate('status', 'Unregistered installations require a timestamp and no token.');
  }
});

module.exports = mongoose.model('PushInstallation', pushInstallationSchema);

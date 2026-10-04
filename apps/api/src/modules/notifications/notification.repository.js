const Notification = require('./notification.model');

function activeFilter(recipientId, now) {
  return { recipientId, archivedAt: null, expiresAt: { $gt: now } };
}

function olderThan({ createdAt, id }) {
  return {
    $or: [
      { createdAt: { $lt: createdAt } },
      { createdAt, _id: { $lt: id } },
    ],
  };
}

function atOrOlderThan({ createdAt, id }) {
  return {
    $or: [
      { createdAt: { $lt: createdAt } },
      { createdAt, _id: { $lte: id } },
    ],
  };
}

function findPage({ recipientId, now, cursor, limit }) {
  const filter = { ...activeFilter(recipientId, now) };
  if (cursor) Object.assign(filter, olderThan(cursor));
  return Notification.find(filter).sort({ createdAt: -1, _id: -1 }).limit(limit + 1);
}

function countUnread(recipientId, now) {
  return Notification.countDocuments({ ...activeFilter(recipientId, now), readAt: null });
}

function findOwnedActiveById(notificationId, recipientId, now) {
  return Notification.findOne({ _id: notificationId, ...activeFilter(recipientId, now) });
}

function markReadIfUnread(notificationId, recipientId, now) {
  return Notification.findOneAndUpdate(
    { _id: notificationId, ...activeFilter(recipientId, now), readAt: null },
    { $set: { readAt: now } },
    { returnDocument: 'after', runValidators: true }
  );
}

function markReadThrough(recipientId, anchor, now) {
  return Notification.updateMany(
    { ...activeFilter(recipientId, now), readAt: null, ...atOrOlderThan(anchor) },
    { $set: { readAt: now } }
  );
}

function archiveThrough(recipientId, anchor, now) {
  return Notification.updateMany(
    { ...activeFilter(recipientId, now), ...atOrOlderThan(anchor) },
    { $set: { archivedAt: now } }
  );
}

module.exports = {
  activeFilter,
  olderThan,
  atOrOlderThan,
  findPage,
  countUnread,
  findOwnedActiveById,
  markReadIfUnread,
  markReadThrough,
  archiveThrough,
};

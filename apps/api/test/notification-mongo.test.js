process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'notification-live-secret-at-least-32-characters';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const { migrateCollections, assertApplyTarget } = require('../scripts/migrate-notifications-v1');
const Notification = require('../src/modules/notifications/notification.model');
const User = require('../src/modules/users/user.model');
const service = require('../src/modules/notifications/notification.service');
const repository = require('../src/modules/notifications/notification.repository');

const uri = process.env.NOTIF1_MONGODB_URI || '';
let safe = false;
if (uri) {
  try {
    assertApplyTarget({ nodeEnv: 'test', mongodbUri: uri });
    safe = true;
  } catch {
    safe = false;
  }
}

test('isolated live Mongo proves migration, physical indexes, uniqueness, pagination, and anchored races', { skip: !safe }, async () => {
  await mongoose.connect(uri);
  try {
    await mongoose.connection.db.dropDatabase();
    const owner = new mongoose.Types.ObjectId();
    const other = new mongoose.Types.ObjectId();
    const readRaceOwner = new mongoose.Types.ObjectId();
    const archiveRaceOwner = new mongoose.Types.ObjectId();
    await User.collection.insertMany([
      { _id: owner, email: 'notification-owner@example.test', preferences: { notifications: { enabled: false } } },
      { _id: other, email: 'notification-other@example.test' },
      { _id: readRaceOwner, email: 'notification-read-race@example.test' },
      { _id: archiveRaceOwner, email: 'notification-archive-race@example.test' },
    ]);

    const first = await migrateCollections({
      userCollection: User.collection,
      notificationCollection: Notification.collection,
      apply: true,
      logger: { log() {} },
    });
    assert.equal(first.pending, 0);
    const second = await migrateCollections({
      userCollection: User.collection,
      notificationCollection: Notification.collection,
      apply: true,
      logger: { log() {} },
    });
    assert.equal(second.changed, 0);
    assert.equal(second.indexesCreated, 0);

    const indexes = await Notification.collection.listIndexes().toArray();
    const applicationIndexes = indexes
      .filter((index) => index.name !== '_id_')
      .map((index) => ({
        name: index.name,
        key: index.key,
        unique: index.unique === true,
        expireAfterSeconds: index.expireAfterSeconds ?? null,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
    assert.deepEqual(applicationIndexes, [
      {
        name: 'notification_expiry_ttl',
        key: { expiresAt: 1 },
        unique: false,
        expireAfterSeconds: 0,
      },
      {
        name: 'notification_inbox_page',
        key: { recipientId: 1, archivedAt: 1, createdAt: -1, _id: -1 },
        unique: false,
        expireAfterSeconds: null,
      },
      {
        name: 'notification_unread_count',
        key: { recipientId: 1, archivedAt: 1, readAt: 1 },
        unique: false,
        expireAfterSeconds: null,
      },
      {
        name: 'uniq_notification_recipient_event',
        key: { recipientId: 1, eventKey: 1 },
        unique: true,
        expireAfterSeconds: null,
      },
    ]);

    const createdAt = new Date('2026-10-04T00:00:00.000Z');
    const documents = await Notification.create([
      { recipientId: owner, type: 'savedRecipe', eventKey: 'a', content: { title: 'A', body: 'A' }, action: { kind: 'none' }, createdAt },
      { recipientId: owner, type: 'savedRecipe', eventKey: 'b', content: { title: 'B', body: 'B' }, action: { kind: 'none' }, createdAt },
      { recipientId: owner, type: 'savedRecipe', eventKey: 'c', content: { title: 'C', body: 'C' }, action: { kind: 'none' }, createdAt },
      { recipientId: other, type: 'savedRecipe', eventKey: 'a', content: { title: 'Other', body: 'Other' }, action: { kind: 'none' }, createdAt },
    ]);
    await assert.rejects(() => Notification.create({
      recipientId: owner, type: 'savedRecipe', eventKey: 'a',
      content: { title: 'Duplicate', body: 'Duplicate' }, action: { kind: 'none' }, createdAt,
    }), (error) => error.code === 11000);

    const originalOwnerIds = new Set(documents
      .filter((document) => String(document.recipientId) === String(owner))
      .map((document) => String(document._id)));
    const pageOne = await service.listNotifications({ recipientId: owner, limit: 2 });
    assert.deepEqual(pageOne.notifications.map((row) => row.id), [
      String(documents[2]._id),
      String(documents[1]._id),
    ]);
    const insertedNewer = await Notification.create({
      recipientId: owner, type: 'savedRecipe', eventKey: 'newer', content: { title: 'New', body: 'New' },
      action: { kind: 'none' }, createdAt: new Date(createdAt.getTime() + 1000),
    });
    const pageTwo = await service.listNotifications({ recipientId: owner, limit: 2, cursor: pageOne.pageInfo.nextCursor });
    const traversedIds = [...pageOne.notifications, ...pageTwo.notifications].map((row) => row.id);
    assert.deepEqual(new Set(traversedIds), originalOwnerIds);
    assert.equal(traversedIds.includes(String(insertedNewer._id)), false);
    assert.equal(new Set(traversedIds).size, traversedIds.length);
    assert.equal(pageOne.unreadCount, 3);

    const raceBase = new Date('2026-10-04T01:00:00.000Z');
    const readRows = await Notification.create([
      {
        recipientId: readRaceOwner, type: 'savedRecipe', eventKey: 'read-older',
        content: { title: 'Read older', body: 'Read older' }, action: { kind: 'none' },
        createdAt: raceBase,
      },
      {
        recipientId: readRaceOwner, type: 'savedRecipe', eventKey: 'read-anchor',
        content: { title: 'Read anchor', body: 'Read anchor' }, action: { kind: 'none' },
        createdAt: new Date(raceBase.getTime() + 1000),
      },
    ]);
    const readAnchor = readRows.find((document) => document.eventKey === 'read-anchor');
    const originalMarkReadThrough = repository.markReadThrough;
    let markReadThroughReached;
    const markReadThroughBarrier = new Promise((resolve) => { markReadThroughReached = resolve; });
    let releaseMarkReadThrough;
    const markReadThroughRelease = new Promise((resolve) => { releaseMarkReadThrough = resolve; });
    repository.markReadThrough = async (...args) => {
      markReadThroughReached();
      await markReadThroughRelease;
      return originalMarkReadThrough(...args);
    };
    let readResult;
    try {
      const readPromise = service.markAllRead({
        recipientId: readRaceOwner,
        throughNotificationId: readAnchor._id,
      });
      await markReadThroughBarrier;
      await Notification.create({
        recipientId: readRaceOwner, type: 'savedRecipe', eventKey: 'read-newer',
        content: { title: 'Read newer', body: 'Read newer' }, action: { kind: 'none' },
        createdAt: new Date(raceBase.getTime() + 2000),
      });
      releaseMarkReadThrough();
      readResult = await readPromise;
    } finally {
      releaseMarkReadThrough();
      repository.markReadThrough = originalMarkReadThrough;
    }
    assert.equal(readResult.unreadCount, 1);
    const afterRead = await Notification.find({ recipientId: readRaceOwner }).sort({ createdAt: 1 }).lean();
    assert.deepEqual(afterRead.map((row) => row.eventKey), ['read-older', 'read-anchor', 'read-newer']);
    assert.equal(afterRead[0].readAt instanceof Date, true);
    assert.equal(afterRead[1].readAt instanceof Date, true);
    assert.equal(afterRead[2].readAt, null);
    assert.equal(afterRead[0].archivedAt, null);
    assert.equal(afterRead[1].archivedAt, null);
    assert.equal(afterRead[2].archivedAt, null);
    assert.equal(await repository.countUnread(readRaceOwner, new Date()), 1);

    const establishedReadAts = afterRead.map((row) => row.readAt?.toISOString() ?? null);
    const repeatedReadResult = await service.markAllRead({
      recipientId: readRaceOwner,
      throughNotificationId: readAnchor._id,
    });
    const afterRepeatedRead = await Notification.find({ recipientId: readRaceOwner }).sort({ createdAt: 1 }).lean();
    assert.equal(repeatedReadResult.unreadCount, 1);
    assert.deepEqual(
      afterRepeatedRead.map((row) => row.readAt?.toISOString() ?? null),
      establishedReadAts
    );
    assert.deepEqual(afterRepeatedRead.map((row) => row.archivedAt), [null, null, null]);
    assert.equal(await repository.countUnread(readRaceOwner, new Date()), 1);

    const archiveRows = await Notification.create([
      {
        recipientId: archiveRaceOwner, type: 'savedRecipe', eventKey: 'archive-older',
        content: { title: 'Archive older', body: 'Archive older' }, action: { kind: 'none' },
        createdAt: raceBase,
      },
      {
        recipientId: archiveRaceOwner, type: 'savedRecipe', eventKey: 'archive-anchor',
        content: { title: 'Archive anchor', body: 'Archive anchor' }, action: { kind: 'none' },
        createdAt: new Date(raceBase.getTime() + 1000),
      },
    ]);
    const archiveAnchor = archiveRows.find((document) => document.eventKey === 'archive-anchor');
    const originalArchiveThrough = repository.archiveThrough;
    let archiveThroughReached;
    const archiveThroughBarrier = new Promise((resolve) => { archiveThroughReached = resolve; });
    let releaseArchiveThrough;
    const archiveThroughRelease = new Promise((resolve) => { releaseArchiveThrough = resolve; });
    repository.archiveThrough = async (...args) => {
      archiveThroughReached();
      await archiveThroughRelease;
      return originalArchiveThrough(...args);
    };
    let archiveResult;
    try {
      const archivePromise = service.archiveAll({
        recipientId: archiveRaceOwner,
        throughNotificationId: archiveAnchor._id,
      });
      await archiveThroughBarrier;
      await Notification.create({
        recipientId: archiveRaceOwner, type: 'savedRecipe', eventKey: 'archive-newer',
        content: { title: 'Archive newer', body: 'Archive newer' }, action: { kind: 'none' },
        createdAt: new Date(raceBase.getTime() + 2000),
      });
      releaseArchiveThrough();
      archiveResult = await archivePromise;
    } finally {
      releaseArchiveThrough();
      repository.archiveThrough = originalArchiveThrough;
    }
    assert.equal(archiveResult.unreadCount, 1);
    const afterArchive = await Notification.find({ recipientId: archiveRaceOwner }).sort({ createdAt: 1 }).lean();
    assert.deepEqual(afterArchive.map((row) => row.eventKey), ['archive-older', 'archive-anchor', 'archive-newer']);
    assert.equal(afterArchive[0].archivedAt instanceof Date, true);
    assert.equal(afterArchive[1].archivedAt instanceof Date, true);
    assert.equal(afterArchive[2].archivedAt, null);
    assert.deepEqual(afterArchive.map((row) => row.readAt), [null, null, null]);

    const archiveInbox = await service.listNotifications({ recipientId: archiveRaceOwner, limit: 20 });
    assert.deepEqual(archiveInbox.notifications.map((row) => row.id), [String(afterArchive[2]._id)]);
    assert.equal(archiveInbox.unreadCount, 1);

    const archiveStateBeforeRepeat = afterArchive.map((row) => ({
      id: String(row._id),
      readAt: row.readAt?.toISOString() ?? null,
      archivedAt: row.archivedAt?.toISOString() ?? null,
    }));
    await assert.rejects(
      () => service.archiveAll({
        recipientId: archiveRaceOwner,
        throughNotificationId: archiveAnchor._id,
      }),
      (error) => error.statusCode === 404 && error.code === 'NOTIFICATION_NOT_FOUND'
    );
    const afterRepeatedArchive = await Notification.find({ recipientId: archiveRaceOwner })
      .sort({ createdAt: 1 })
      .lean();
    assert.deepEqual(afterRepeatedArchive.map((row) => ({
      id: String(row._id),
      readAt: row.readAt?.toISOString() ?? null,
      archivedAt: row.archivedAt?.toISOString() ?? null,
    })), archiveStateBeforeRepeat);
    const repeatedArchiveInbox = await service.listNotifications({ recipientId: archiveRaceOwner, limit: 20 });
    assert.deepEqual(repeatedArchiveInbox.notifications.map((row) => row.id), [String(afterArchive[2]._id)]);
    assert.equal(repeatedArchiveInbox.unreadCount, 1);

    const newer = await Notification.findOne({ recipientId: owner, eventKey: 'newer' });
    assert.equal(newer.readAt, null);
    const visible = await service.listNotifications({ recipientId: owner, limit: 20 });
    assert.equal(visible.notifications.some((row) => row.id === String(newer._id)), true);
    assert.equal(await Notification.countDocuments({ recipientId: other, archivedAt: null }), 1);
  } finally {
    await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
  }
});

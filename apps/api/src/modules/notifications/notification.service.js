const crypto = require('crypto');
const mongoose = require('mongoose');
const notificationRepository = require('./notification.repository');
const { toPublicNotification } = require('./notification.serializer');
const { loadEnv } = require('../../config/env');
const { AppError } = require('../../shared/errors/app-error');

const CURSOR_VERSION = 1;

function notFoundError() {
  return new AppError('Notification not found.', {
    statusCode: 404,
    code: 'NOTIFICATION_NOT_FOUND',
  });
}

function invalidCursorError() {
  return new AppError('Request validation failed.', {
    statusCode: 400,
    code: 'VALIDATION_ERROR',
  });
}

function encodeCursor(notification, secret = loadEnv().jwtAccessSecret) {
  const value = {
    v: CURSOR_VERSION,
    c: new Date(notification.createdAt).toISOString(),
    i: String(notification._id),
  };
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function decodeCursor(cursor, secret = loadEnv().jwtAccessSecret) {
  try {
    const parts = cursor.split('.');
    if (parts.length !== 2) throw new Error('shape');
    const [payload, signatureText] = parts;
    const expected = crypto.createHmac('sha256', secret).update(payload).digest();
    const actual = Buffer.from(signatureText, 'base64url');
    if (actual.toString('base64url') !== signatureText
      || actual.length !== expected.length
      || !crypto.timingSafeEqual(actual, expected)) {
      throw new Error('signature');
    }
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!parsed || Object.keys(parsed).join(',') !== 'v,c,i' || parsed.v !== CURSOR_VERSION) {
      throw new Error('version');
    }
    if (typeof parsed.c !== 'string' || typeof parsed.i !== 'string') throw new Error('types');
    const createdAt = new Date(parsed.c);
    if (Number.isNaN(createdAt.getTime()) || createdAt.toISOString() !== parsed.c) throw new Error('date');
    if (!mongoose.Types.ObjectId.isValid(parsed.i)) throw new Error('id');
    const id = new mongoose.Types.ObjectId(parsed.i);
    if (id.toString() !== parsed.i) throw new Error('canonical id');
    const canonical = Buffer.from(JSON.stringify({ v: CURSOR_VERSION, c: parsed.c, i: parsed.i })).toString('base64url');
    if (canonical !== payload) throw new Error('canonical payload');
    return { createdAt, id };
  } catch {
    throw invalidCursorError();
  }
}

async function listNotifications({ recipientId, limit, cursor }) {
  const now = new Date();
  const decodedCursor = cursor ? decodeCursor(cursor) : null;
  const [rows, unreadCount] = await Promise.all([
    notificationRepository.findPage({ recipientId, now, cursor: decodedCursor, limit }),
    notificationRepository.countUnread(recipientId, now),
  ]);
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  return {
    notifications: pageRows.map(toPublicNotification),
    unreadCount,
    pageInfo: {
      nextCursor: hasMore ? encodeCursor(pageRows[pageRows.length - 1]) : null,
      hasMore,
    },
  };
}

async function resolveAnchor(recipientId, notificationId, now) {
  const row = await notificationRepository.findOwnedActiveById(notificationId, recipientId, now);
  if (!row) throw notFoundError();
  return { createdAt: row.createdAt, id: row._id };
}

async function markRead({ recipientId, notificationId }) {
  const now = new Date();
  let notification = await notificationRepository.markReadIfUnread(notificationId, recipientId, now);
  if (!notification) {
    notification = await notificationRepository.findOwnedActiveById(notificationId, recipientId, now);
  }
  if (!notification) throw notFoundError();
  return {
    notification: toPublicNotification(notification),
    unreadCount: await notificationRepository.countUnread(recipientId, new Date()),
  };
}

async function markAllRead({ recipientId, throughNotificationId }) {
  const now = new Date();
  const anchor = await resolveAnchor(recipientId, throughNotificationId, now);
  await notificationRepository.markReadThrough(recipientId, anchor, now);
  return { unreadCount: await notificationRepository.countUnread(recipientId, new Date()) };
}

async function archiveAll({ recipientId, throughNotificationId }) {
  const now = new Date();
  const anchor = await resolveAnchor(recipientId, throughNotificationId, now);
  await notificationRepository.archiveThrough(recipientId, anchor, now);
  return { unreadCount: await notificationRepository.countUnread(recipientId, new Date()) };
}

module.exports = {
  CURSOR_VERSION,
  encodeCursor,
  decodeCursor,
  listNotifications,
  markRead,
  markAllRead,
  archiveAll,
};

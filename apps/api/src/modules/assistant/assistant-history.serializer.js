function toConversation(row) {
  return {
    id: String(row._id), createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(), expiresAt: new Date(row.expiresAt).toISOString(),
    version: row.version,
  };
}

function toMessage(row) {
  const message = {
    id: String(row._id), role: row.role, content: row.content,
    sequence: row.sequence, createdAt: new Date(row.createdAt).toISOString(),
  };
  if (row.role === 'user') message.status = row.status;
  return message;
}

module.exports = { toConversation, toMessage };

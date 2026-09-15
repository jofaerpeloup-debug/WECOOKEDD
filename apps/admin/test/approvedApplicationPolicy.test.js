import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyApprovedApplications } from '../src/approvedApplicationPolicy.js';

function approved(id, userId, role = 'moderator') {
  return {
    id,
    status: 'approved',
    applicant: { id: userId, role, status: 'active' },
  };
}

test('one approved application for a current moderator is actionable', () => {
  const rows = classifyApprovedApplications([approved('a1', 'u1')]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].isCurrentAuthority, true);
  assert.equal(rows[0].isHistorical, false);
});

test('only the newest of multiple approvals for a current moderator is actionable', () => {
  const rows = classifyApprovedApplications([
    approved('newest', 'u1'),
    approved('older', 'u1'),
    approved('oldest', 'u1'),
  ]);
  assert.deepEqual(
    rows.map(({ application, isCurrentAuthority, isHistorical }) => ({
      id: application.id, isCurrentAuthority, isHistorical,
    })),
    [
      { id: 'newest', isCurrentAuthority: true, isHistorical: false },
      { id: 'older', isCurrentAuthority: false, isHistorical: true },
      { id: 'oldest', isCurrentAuthority: false, isHistorical: true },
    ],
  );
});

test('approved history for a current ordinary user has no actionable approval', () => {
  const rows = classifyApprovedApplications([
    approved('newest', 'u1', 'user'),
    approved('older', 'u1', 'user'),
  ]);
  assert.equal(rows.filter((row) => row.isCurrentAuthority).length, 0);
  assert.ok(rows.every((row) => row.isHistorical));
});

test('an active moderator never receives duplicate demote actions', () => {
  const rows = classifyApprovedApplications([
    approved('u1-new', 'u1'),
    approved('u2-new', 'u2'),
    approved('u1-old', 'u1'),
    approved('u2-old', 'u2'),
  ]);
  const actionableApplicantIds = rows
    .filter((row) => row.isCurrentAuthority)
    .map((row) => row.application.applicant.id);

  assert.deepEqual(actionableApplicantIds, ['u1', 'u2']);
  assert.equal(new Set(actionableApplicantIds).size, actionableApplicantIds.length);
});

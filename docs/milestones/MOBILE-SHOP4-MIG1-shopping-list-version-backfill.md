# MOBILE-SHOP4-MIG1 — Shopping List Version Backfill

## 1. Status and authority

- Audit: **COMPLETE**
- Contract: **FROZEN**
- Implementation: **COMPLETE**
- Independent review: **COMPLETE**
- Closure review: **PASS**
- Status: **READY FOR FINALIZATION AFTER INTEGRATION CHECK**
- SHOP4: **BLOCKED BY MIG1 RELEASE GATES**
- Baseline: `origin/main` at `11e788427166f5c2e7c5b456bef80b205639a61f`

This document is the implementation authority for MOBILE-SHOP4-MIG1. Authority
is, in order: `/AGENTS.md`, the live repository at the baseline above, this
frozen contract, the completed MOBILE-SHOP4-MIG1 audit, and the frozen
MOBILE-SHOP4 contract.

This frozen contract does not authorize a production database mutation or claim
that SHOP4 is complete. The status below records MIG1 implementation and
automated closure evidence only; its runtime and production gates remain
explicitly unpassed unless stated otherwise.

## 2. Purpose and independence

MIG1 backfills the Mongoose version key on legacy Shopping List documents that
do not have one. A document hydrated before it has `__v` cannot safely enforce
the first optimistic-concurrency save: concurrent first saves can both match
without a version predicate. A numeric zero establishes the version baseline
required by SHOP4's document-level optimistic concurrency.

MIG1 must be implemented, reviewed, and merged independently before SHOP4. It
must be based on current `main` and must not import, assume, or depend on
uncommitted SHOP4 model, service, controller, route, mobile, or test changes.
MIG1 does not enable SHOP4 behavior.

## 3. Exact migration mutation

The only target collection is:

```text
shoppinglists
```

The only authorized document mutation is:

```js
filter: { __v: { $exists: false } }
update: { $set: { __v: 0 } }
```

Apply this with one acknowledged raw-collection `updateMany` operation. A
majority write concern may be required as an execution option, but it does not
change the frozen filter or update document.

The migration must not modify:

- `updatedAt`;
- `createdAt`;
- `items` or any embedded item field;
- `owner`;
- indexes; or
- any other field.

It must not create missing Shopping Lists, select a user/list subset, repair a
present version value, unset a version, or perform a rollback mutation.

## 4. Raw `__v` preflight classification

Preflight must inspect the raw stored BSON field and preserve both field
presence and BSON type. It must not hydrate through the ShoppingList Mongoose
schema or use schema/default casting. It must not use blanket coercion such as
`Number`, `parseInt`, string conversion, truthiness, or fallback-to-zero.

Every `shoppinglists` document must be classified as exactly one of:

- **missing** — the `__v` field does not exist; this is the only migration
  candidate;
- **valid** — the present raw BSON value is numeric and represents exactly a
  non-negative safe integer; this value is left untouched; or
- **invalid** — any other present value.

Invalid present values include, without limitation:

- `null`;
- every non-numeric BSON value, including strings;
- `NaN`, positive infinity, and negative infinity;
- negative numbers;
- fractional numbers; and
- integers outside JavaScript's safe-integer range.

The implementation must handle BSON numeric representations explicitly and
compare their exact mathematical value; it must not silently narrow, round, or
otherwise coerce a value into validity. Invalid values are never rewritten by
MIG1.

Preflight reports at least `scanned`, `missing`, `valid`, and `invalid`. Apply
is blocked before every write when `invalid > 0`. If production contains any
invalid present `__v`, stop and require a separate, inspected, targeted repair
contract.

## 5. Command and postcondition contract

The command is dry-run by default. Mutation requires an explicit `--apply`.
Follow existing migration conventions by requiring an explicit environment,
checking the exact connected database name before the first read, and
connecting with `autoIndex: false` and `autoCreate: false`.

Dry-run performs no writes. Apply may run only after a complete valid
preflight, and must report `matched` and `modified` from the raw update result.
For the quiesced apply, both counts must equal the preflight `missing` count.

After apply, a complete raw postcheck must prove:

```text
missing=0
invalid=0
```

The report must also make any pending work explicit. A second apply is the
required idempotency check and must report:

```text
matched=0
modified=0
```

On a failed or partially acknowledged apply, retain already established
versions, diagnose from the migration report and snapshot, then rerun the same
idempotent migration. Never unset `__v`. A SHOP4 rollback does not roll back
this backfill.

## 6. Timestamp-preservation decision

Use the native/raw `shoppinglists` collection mutation so Mongoose document and
query timestamp middleware cannot add `updatedAt` or any other field. If an
implementation instead goes through a Mongoose model, it must explicitly
disable timestamps for the update and prove the generated mutation remains
exactly the frozen `$set` above. Raw collection mutation is the frozen default.

Tests must compare each migrated document before and after and prove that only
the previously missing `__v` field changed to numeric `0`; `updatedAt`,
`createdAt`, `items`, `owner`, and all other fields remain byte/value
equivalent.

## 7. Production write quiescence

No online or live-write production migration is authorized.

Before production apply, stop every process capable of writing Shopping Lists
and drain all in-flight ShoppingList API requests. Keep those writers stopped
through the snapshot, repeated dry-run, apply, postcheck, idempotent second
apply, and SHOP4 backend deployment.

This is mandatory because a process may have hydrated a legacy document while
`__v === undefined`. Backfilling that stored document does not update the
already-hydrated in-memory instance; a later save by that process can still use
an unsafe first-save predicate. Production is not safe until no pre-migration
API writer or stale hydrated Shopping List remains alive.

## 8. Implementation allowlists

Only these production paths may change for MIG1 implementation:

- `apps/api/scripts/migrate-shopping-list-versions.js` — new migration command;
- `apps/api/package.json` — command registration only; and
- `docs/milestones/MOBILE-SHOP4-MIG1-shopping-list-version-backfill.md`.

Only this test path may change:

- `apps/api/test/shopping-list-version-migration.test.js` — new.

`apps/api/test/shopping-list-mongo.test.js` does not exist on the frozen
`origin/main` baseline and is excluded. It must not be introduced or copied
from uncommitted SHOP4 work for MIG1.

MIG1 authorizes no Shopping model, repository, service, controller, route,
serializer, validation, mobile, lockfile, index, startup migration, startup
verifier, required-index registry, or unrelated package change. If another
path proves necessary, stop and amend this contract before editing it.

## 9. Independent test strategy

The dedicated migration test must import only the MIG1 migration command and
current-main dependencies. Unit-level proof must cover:

- type-sensitive raw classification of missing, valid, and every frozen
  invalid class;
- no coercion of invalid present values;
- dry-run purity and invalid-preflight zero-write blocking;
- exact collection, filter, and update documents;
- exact environment/database binding and disabled automatic index creation;
- result-count enforcement, complete postconditions, partial-failure
  reporting, and idempotent rerun; and
- preservation of timestamps and every non-`__v` field.

Where Mongo behavior is required, that same dedicated test must use an
isolated, environment-gated non-production database and a test-local Mongoose
schema with `optimisticConcurrency: true`. It must not import the uncommitted
SHOP4 ShoppingList model or require SHOP4 OCC production changes.

The isolated proof must establish that a representative raw legacy document
missing `__v` has the audited unsafe concurrent-first-save behavior, the
migration changes only `__v` to `0`, and after migration two independently
hydrated concurrent saves produce exactly one success and one Mongoose
`VersionError`, with the winner's state intact. It must also prove valid
versions remain untouched, invalid present versions block with zero writes,
new current-main repository upserts establish `__v: 0`, and a second apply
matches and modifies zero documents.

The real ShoppingList model's OCC integration is deliberately not a MIG1
dependency. It must be re-proven when SHOP4 resumes.

## 10. Frozen release order

The only authorized order is:

1. implement, independently review, and merge MIG1;
2. run the production dry-run;
3. inspect invalid and missing counts;
4. stop all ShoppingList API writers and drain in-flight requests;
5. take a production snapshot;
6. repeat the production dry-run while writes remain stopped;
7. apply MIG1;
8. postcheck `missing=0` and `invalid=0`;
9. run a second apply and require `matched=0` and `modified=0`;
10. deploy the SHOP4 backend while writes remain stopped;
11. restart and smoke-test the API; and
12. release the compatible SHOP4 mobile work afterward.

If either production dry-run finds any invalid present `__v`, stop. Do not
apply MIG1, deploy SHOP4, or repair those values under this contract. Freeze a
separate targeted repair contract first.

## 11. SHOP4 unblock condition

SHOP4 remains blocked until all of the following are true:

- production reports `missing=0`;
- production reports `invalid=0`;
- the idempotent second apply reports `matched=0` and `modified=0`;
- no pre-migration API writer or stale hydrated Shopping List remains alive;
  and
- the isolated post-migration OCC proof passes.

After those conditions are met, SHOP4 must still re-prove real ShoppingList
model OCC integration and satisfy every remaining SHOP4 implementation,
automated, live-Mongo, device, accessibility, and release gate. MIG1 must not
claim SHOP4 complete.

## 12. Closure evidence, runtime gates, and verdict

Implementation is complete. Independent review is complete. Closure review
passes with the frozen implementation and test scope unchanged.

Verified evidence:

- 14 focused tests passed;
- 1 isolated-Mongo test skipped;
- BSON validation: **PASS**;
- migration safety: **PASS**;
- partial-failure reporting: **PASS**;
- mutation-resistant tests: **PASS**;
- exact frozen scope: **PASS**; and
- `git diff --check`: **PASS**.

No production or shared-development Mongo instance was accessed or mutated.

Isolated live-Mongo:
**DEFERRED BY PROJECT DECISION — NOT PASSED — NOT CLAIMED AS PASS**

Production migration:
**NOT RUN — NOT CLAIMED AS PASS**

The production ShoppingList write-quiescence requirements in section 7 and the
frozen SHOP4 deployment order in section 10 remain mandatory. They are not
satisfied by automated evidence and are not changed by this closure status.

The remaining finalization action is controlled current-main integration that
preserves both registered migration commands without changing the frozen MIG1
implementation. SHOP4 remains subject to every release gate in this contract.

**MOBILE-SHOP4-MIG1 DOCUMENTATION COMPLETE — READY FOR CONTROLLED FINALIZATION**

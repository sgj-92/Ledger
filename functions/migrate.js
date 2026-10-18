// Ledger — moving Partner Sharing requests into Home (one-off, re-runnable).
//
// Shaun asks for it from Settings → Home, which writes ledger_meta/homeMigration
// { status: 'requested', requestedBy: <his uid> } (ledger_meta is owner-only). The function
// in index.js calls migrate() with the Admin SDK, because the history it copies was written
// by both people and keeps their names on it — no client could write that.
//
// For each of his ledger_shared_requests (the same id in ledger_home_requests, so a linked
// Action's sourceRequestId still matches and nothing private is touched):
//   requesterUid = partnerUid, assigneeUid = ownerUid, createdByUid = createdByUid or partnerUid,
//   participants = those people, visibility 'private' (only Shaun and Abi, as before; the
//   nanny never sees them), status, dates, link, summary, read marks and soft deletion carried
//   over. Its Updates are copied into the request's updates, keeping who and when.
// The old record is marked migratedTo (server-only), never deleted, so rolling back is
// pointing the app at it again. Running it twice copies nothing twice.

const STATUS = { requested: 'requested', planned: 'planned', in_progress: 'in_progress', done: 'done',
  dismissed: 'dismissed', withdrawn: 'withdrawn' };
const TYPE = { request_created: 'created' };

function createMigrator(deps) {
  const db = deps.db;
  const now = deps.now || (() => new Date().toISOString());

  async function migrate(ownerUid) {
    const out = { migrated: 0, skipped: 0, updates: 0, errors: [] };
    const user = await db.collection('ledger_users').doc(ownerUid).get();
    if (!user.exists || (user.data() || {}).role !== 'owner') throw new Error('Not an owner');
    const home = await db.collection('ledger_homes').doc(ownerUid).get();
    if (!home.exists || (home.data() || {}).ownerUid !== ownerUid) throw new Error('No Home yet');
    const legacy = await db.collection('ledger_shared_requests').where('ownerUid', '==', ownerUid).get();
    for (const doc of legacy.docs) {
      const o = doc.data() || {};
      try {
        const partnerMember = await db.collection('ledger_home_members').doc(o.partnerUid).get();
        if (!partnerMember.exists || (partnerMember.data() || {}).homeId !== ownerUid) {
          out.errors.push(doc.id + ': ' + o.partnerUid + ' is not at Home');
          continue;
        }
        const target = db.collection('ledger_home_requests').doc(doc.id);
        if ((await target.get()).exists) {
          if (!o.migratedTo) await doc.ref.update({ migratedTo: doc.id, migratedAt: now() });
          out.skipped++;
          continue;
        }
        const creator = o.createdByUid || o.partnerUid;
        const byRole = (role) => role === 'partner' ? o.partnerUid : (role === 'owner' || role === 'system' ? ownerUid : null);
        const readAt = {};
        if (o.ownerLastReadAt) readAt[ownerUid] = o.ownerLastReadAt;
        if (o.partnerLastReadAt) readAt[o.partnerUid] = o.partnerLastReadAt;
        const r = {
          homeId: ownerUid, text: o.text || '', note: o.note || null,
          requestedTiming: o.requestedTiming || 'none', requestedDate: o.requestedDate || null,
          requesterUid: o.partnerUid, assigneeUid: ownerUid, createdByUid: creator,
          participants: Array.from(new Set([o.partnerUid, ownerUid, creator])),
          visibility: 'private', status: STATUS[o.status] || 'requested',
          plannedDate: o.plannedDate || null, linkedActionId: o.linkedActionId || null,
          linkedByUid: o.linkedActionId ? ownerUid : null, processedAt: o.processedAt || null,
          createdAt: o.createdAt || now(), updatedAt: o.updatedAt || now(),
          latestUpdateAt: o.latestUpdateAt || null, latestUpdateByUid: byRole(o.latestUpdateBy), latestUpdateType: o.latestUpdateType || null,
          latestCommentAt: o.latestCommentAt || null, latestCommentByUid: byRole(o.latestCommentBy), latestCommentText: o.latestCommentText || null,
          readAt, legacy: { from: 'ledger_shared_requests', renewedFrom: o.renewedFrom || null, renewedAs: o.renewedAs || null }
        };
        if (o.deletedAt) { r.deletedAt = o.deletedAt; r.deletedByUid = o.deletedByUid || null; }
        if (o.partnerHiddenAt) r.hiddenFor = { [o.partnerUid]: o.partnerHiddenAt };
        const ups = await db.collection('ledger_shared_request_updates').where('requestId', '==', doc.id).where('ownerUid', '==', ownerUid).get();
        const batch = db.batch();
        batch.set(target, r);
        ups.docs.forEach((u) => {
          const e = u.data() || {};
          batch.set(target.collection('updates').doc(u.id), {
            type: TYPE[e.type] || e.type, actorUid: e.actorUid, text: e.text || null, createdAt: e.createdAt || null,
            metadata: Object.assign({}, e.metadata || {}, { legacyRole: e.actorRole || null })
          });
        });
        batch.update(doc.ref, { migratedTo: doc.id, migratedAt: now() });
        await batch.commit();
        out.migrated++; out.updates += ups.size;
      } catch (e) {
        out.errors.push(doc.id + ': ' + ((e && e.message) || e));
      }
    }
    return out;
  }
  return { migrate };
}

module.exports = { createMigrator };

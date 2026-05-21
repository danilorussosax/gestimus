/// <reference path="../pb_data/types.d.ts" />

// Fixes the JSON max size on `criteri` (and related json fields added by previous migrations).
// In PB v0.22, json fields created via migration with empty options default to maxSize=0, rejecting all data.
// We bump them to 1 MB explicitly.

migrate((db) => {
  const dao = new Dao(db);

  const fasi = dao.findCollectionByNameOrId('fasi');
  let dirty = false;
  ['criteri', 'pesi', 'commissari_ids'].forEach((name) => {
    const f = fasi.schema.getFieldByName(name);
    if (f && f.type === 'json') {
      f.options = { maxSize: 1048576 };
      dirty = true;
    }
  });
  if (dirty) dao.saveCollection(fasi);

  const candidati = dao.findCollectionByNameOrId('candidati');
  const dp = candidati.schema.getFieldByName('docenti_preparatori');
  if (dp && dp.type === 'json') {
    dp.options = { maxSize: 1048576 };
    dao.saveCollection(candidati);
  }
}, (db) => {
  // No rollback needed (we only relax the limit)
});

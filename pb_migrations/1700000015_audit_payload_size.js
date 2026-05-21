/// <reference path="../pb_data/types.d.ts" />

// Fix: in PocketBase 0.22, i campi JSON creati con options={} hanno maxSize=0
// (= 0 bytes ammessi). Stesso pattern di 1700000005_fix_criteri_size.
// Imposta payload di audit_log a 1 MB.

migrate((db) => {
  const dao = new Dao(db);
  const c = dao.findCollectionByNameOrId('audit_log');
  const f = c.schema.getFieldByName('payload');
  if (f && f.type === 'json') {
    f.options = { maxSize: 1048576 };
    dao.saveCollection(c);
  }
}, (db) => {
  // Nessun rollback: riportare a 0 ricreerebbe il bug.
});

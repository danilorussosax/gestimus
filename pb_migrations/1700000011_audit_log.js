/// <reference path="../pb_data/types.d.ts" />

// Collezione audit_log: traccia le azioni admin/commissario significative.
// Solo admin autenticati possono leggere; tutti gli account autenticati possono creare.

migrate((db) => {
  const dao = new Dao(db);

  const audit = new Collection({
    name: 'audit_log',
    type: 'base',
    listRule: '@request.auth.role = "admin"',
    viewRule: '@request.auth.role = "admin"',
    createRule: '@request.auth.id != ""',
    updateRule: null,
    deleteRule: '@request.auth.role = "admin"',
    schema: [
      new SchemaField({ name: 'actor_email', type: 'text', options: { max: 255 } }),
      new SchemaField({ name: 'actor_role',  type: 'text', options: { max: 50 } }),
      new SchemaField({ name: 'action',      type: 'text', required: true, options: { max: 100 } }),
      new SchemaField({ name: 'target_type', type: 'text', options: { max: 50 } }),
      new SchemaField({ name: 'target_id',   type: 'text', options: { max: 50 } }),
      new SchemaField({ name: 'target_label', type: 'text', options: { max: 255 } }),
      new SchemaField({ name: 'concorso_id', type: 'text', options: { max: 50 } }),
      new SchemaField({ name: 'payload',     type: 'json', options: {} }),
    ],
    indexes: [
      'CREATE INDEX `idx_audit_created` ON `audit_log` (`created`)',
      'CREATE INDEX `idx_audit_concorso` ON `audit_log` (`concorso_id`)',
    ],
  });
  dao.saveCollection(audit);
}, (db) => {
  const dao = new Dao(db);
  try {
    const c = dao.findCollectionByNameOrId('audit_log');
    dao.deleteCollection(c);
  } catch (e) { /* ignore */ }
});

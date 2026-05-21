/// <reference path="../pb_data/types.d.ts" />

// Aggiunge il ruolo 'superadmin' alla collection accounts
// e crea la collection `tenants` per gestire i tenant dalla piattaforma.

migrate((db) => {
  const dao = new Dao(db);

  // 1. Aggiungi 'superadmin' ai valori del campo role in accounts
  try {
    const accounts = dao.findCollectionByNameOrId('accounts');
    const roleField = accounts.schema.getFieldByName('role');
    if (roleField) {
      const vals = roleField.options?.values || [];
      if (!vals.includes('superadmin')) {
        roleField.options.values = [...vals, 'superadmin'];
        dao.saveCollection(accounts);
      }
    }
  } catch {}

  // 2. Crea collection tenants (se non esiste già)
  try {
    const existing = dao.findCollectionByNameOrId('tenants');
    return; // già esistente
  } catch {}

  const tenants = new Collection({
    name: 'tenants',
    type: 'base',
    listRule: '@request.auth.role = "superadmin"',
    viewRule: '@request.auth.role = "superadmin"',
    createRule: '@request.auth.role = "superadmin"',
    updateRule: '@request.auth.role = "superadmin"',
    deleteRule: '@request.auth.role = "superadmin"',
    schema: [
      new SchemaField({ name: 'slug',        type: 'text', required: true, options: { max: 100, unique: true } }),
      new SchemaField({ name: 'nome',         type: 'text', required: true, options: { max: 255 } }),
      new SchemaField({ name: 'dominio',      type: 'text', options: { max: 255 } }),
      new SchemaField({ name: 'porta_pb',     type: 'number', required: true, options: { min: 1, max: 65535, noDecimal: true } }),
      new SchemaField({ name: 'stato',        type: 'select', required: true, options: { maxSelect: 1, values: ['attivo','sospeso','archiviato'] } }),
      new SchemaField({ name: 'note',         type: 'text', options: {} }),
    ],
  });
  dao.saveCollection(tenants);
}, (db) => {
  const dao = new Dao(db);
  // Non rimuovere il ruolo superadmin per evitare breaking changes
  try {
    const c = dao.findCollectionByNameOrId('tenants');
    dao.deleteCollection(c);
  } catch {}
});
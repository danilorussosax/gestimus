/// <reference path="../pb_data/types.d.ts" />

// Aggiunge campi statistici e credenziali admin alla collection tenants.
// Campi: num_concorsi, num_commissari, num_candidati, email_admin, ultimo_refresh

migrate((db) => {
  const dao = new Dao(db);
  try {
    const c = dao.findCollectionByNameOrId('tenants');

    const addIfMissing = (name, type, opts) => {
      if (!c.schema.getFieldByName(name)) {
        c.schema.addField(new SchemaField({ name, type, options: opts }));
      }
    };

    addIfMissing('num_concorsi',   'number', { min: 0, noDecimal: true });
    addIfMissing('num_commissari', 'number', { min: 0, noDecimal: true });
    addIfMissing('num_candidati',  'number', { min: 0, noDecimal: true });
    addIfMissing('email_admin',    'email',  {});
    addIfMissing('ultimo_refresh', 'date',   {});

    dao.saveCollection(c);
  } catch {}
}, (db) => {
  // no rollback
});
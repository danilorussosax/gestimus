/// <reference path="../pb_data/types.d.ts" />

// Auth collection `accounts` con role (admin/commissario) e link opzionale al record commissario.
// Le rules sono volutamente permissive per il prototipo locale.
// In produzione: lock-down via admin UI / migration successiva.

migrate((db) => {
  const dao = new Dao(db);
  const commissari = dao.findCollectionByNameOrId('commissari');

  const accounts = new Collection({
    name: 'accounts',
    type: 'auth',
    listRule:   '@request.auth.id != ""',
    viewRule:   '@request.auth.id != ""',
    createRule: '',                         // open, per bootstrap del primo admin
    updateRule: '',                         // open per ora — ammette reset password lato client
    deleteRule: '@request.auth.role = "admin"',
    options: {
      allowEmailAuth: true,
      allowOAuth2Auth: false,
      allowUsernameAuth: false,
      requireEmail: true,
      minPasswordLength: 6,
      onlyEmailDomains: null,
      exceptEmailDomains: null,
    },
    schema: [
      new SchemaField({ name: 'nome',        type: 'text', options: { max: 255 } }),
      new SchemaField({ name: 'cognome',     type: 'text', options: { max: 255 } }),
      new SchemaField({ name: 'role',        type: 'select', required: true, options: { maxSelect: 1, values: ['admin','commissario'] } }),
      new SchemaField({ name: 'commissario', type: 'relation', options: { collectionId: commissari.id, cascadeDelete: false, maxSelect: 1, minSelect: 0 } }),
      new SchemaField({ name: 'attivo',      type: 'bool', options: {} }),
    ],
  });
  dao.saveCollection(accounts);
}, (db) => {
  const dao = new Dao(db);
  try {
    const c = dao.findCollectionByNameOrId('accounts');
    dao.deleteCollection(c);
  } catch (e) {}
});

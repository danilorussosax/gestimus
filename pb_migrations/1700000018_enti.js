/// <reference path="../pb_data/types.d.ts" />

// Collection singleton `enti`: un solo record per istanza PocketBase.
// Contiene branding e impostazioni dell'ente organizzatore.
// Schema: nome, descrizione, logo, contatti, colori, impostazioni JSON libere.

migrate((db) => {
  const dao = new Dao(db);

  const enti = new Collection({
    name: 'enti',
    type: 'base',
    listRule: '',
    viewRule: '',
    createRule: '@request.auth.role = "admin"',
    updateRule: '@request.auth.role = "admin"',
    deleteRule: null,
    schema: [
      new SchemaField({ name: 'nome',              type: 'text', required: true, options: { max: 255 } }),
      new SchemaField({ name: 'descrizione',       type: 'text', options: {} }),
      new SchemaField({ name: 'logo',              type: 'file', options: { maxSelect: 1, maxSize: 5242880, mimeTypes: ['image/png','image/jpeg','image/webp','image/svg+xml'] } }),
      new SchemaField({ name: 'sito_web',           type: 'url', options: { max: 500 } }),
      new SchemaField({ name: 'email_contatto',     type: 'email', options: {} }),
      new SchemaField({ name: 'telefono',           type: 'text', options: { max: 50 } }),
      new SchemaField({ name: 'indirizzo',          type: 'text', options: { max: 500 } }),
      new SchemaField({ name: 'colore_primario',    type: 'text', options: { max: 7 } }),
      new SchemaField({ name: 'colore_secondario',  type: 'text', options: { max: 7 } }),
      new SchemaField({ name: 'impostazioni',       type: 'json', options: { maxSize: 65536 } }),
    ],
  });
  dao.saveCollection(enti);
}, (db) => {
  const dao = new Dao(db);
  try {
    dao.deleteCollection(dao.findCollectionByNameOrId('enti'));
  } catch {}
});
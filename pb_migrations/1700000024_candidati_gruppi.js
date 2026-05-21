/// <reference path="../pb_data/types.d.ts" />

// Aggiunge il supporto per gruppi/ensemble (quartetti, orchestre, etc.)
// 1. Campo `tipo` su candidati: 'individuale' o 'gruppo'
// 2. Collezione `candidati_gruppo`: relazione molti-a-molti con strumento per membro

migrate((db) => {
  const dao = new Dao(db);
  const candidati = dao.findCollectionByNameOrId('candidati');

  // 1. Aggiungi campo tipo ai candidati
  if (!candidati.schema.getFieldByName('tipo')) {
    candidati.schema.addField(new SchemaField({
      name: 'tipo',
      type: 'select',
      required: true,
      options: {
        maxSelect: 1,
        values: ['individuale', 'gruppo'],
      },
    }));
    dao.saveCollection(candidati);
  }

  // 2. Crea collection candidati_gruppo
  try {
    dao.findCollectionByNameOrId('candidati_gruppo');
    return;
  } catch {}

  const gruppi = new Collection({
    name: 'candidati_gruppo',
    type: 'base',
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.role = "admin" || @request.auth.role = "superadmin"',
    updateRule: '@request.auth.role = "admin" || @request.auth.role = "superadmin"',
    deleteRule: '@request.auth.role = "admin" || @request.auth.role = "superadmin"',
    schema: [
      new SchemaField({
        name: 'gruppo', type: 'relation', required: true,
        options: { collectionId: candidati.id, cascadeDelete: true, maxSelect: 1 },
      }),
      new SchemaField({
        name: 'candidato', type: 'relation', required: true,
        options: { collectionId: candidati.id, cascadeDelete: false, maxSelect: 1 },
      }),
      new SchemaField({
        name: 'strumento_gruppo', type: 'text',
        options: { max: 255 },
      }),
    ],
  });
  dao.saveCollection(gruppi);
}, (db) => {
  const dao = new Dao(db);
  try { dao.deleteCollection(dao.findCollectionByNameOrId('candidati_gruppo')); } catch {}
});
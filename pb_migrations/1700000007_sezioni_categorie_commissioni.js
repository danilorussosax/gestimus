/// <reference path="../pb_data/types.d.ts" />

// Adds:
//  • sezioni        (per concorso)
//  • categorie      (per sezione)
//  • commissioni    (per concorso, con membri multi-select e assegnazioni a sezioni/categorie)
//  • candidati.sezioni (relation multi)
//  • candidati.categorie (relation multi)

migrate((db) => {
  const dao = new Dao(db);
  const concorsi = dao.findCollectionByNameOrId('concorsi');
  const commissari = dao.findCollectionByNameOrId('commissari');
  const candidati = dao.findCollectionByNameOrId('candidati');

  // ---- sezioni ----
  const sezioni = new Collection({
    name: 'sezioni',
    type: 'base',
    listRule: '', viewRule: '', createRule: '', updateRule: '', deleteRule: '',
    schema: [
      new SchemaField({ name: 'concorso', type: 'relation', required: true, options: { collectionId: concorsi.id, cascadeDelete: true, maxSelect: 1 } }),
      new SchemaField({ name: 'nome', type: 'text', required: true, options: { max: 255 } }),
      new SchemaField({ name: 'descrizione', type: 'text', options: {} }),
      new SchemaField({ name: 'ordine', type: 'number', options: { noDecimal: true, min: 1 } }),
      new SchemaField({ name: 'legacy_id', type: 'number', options: { noDecimal: true } }),
    ],
  });
  dao.saveCollection(sezioni);

  // ---- categorie ----
  const categorie = new Collection({
    name: 'categorie',
    type: 'base',
    listRule: '', viewRule: '', createRule: '', updateRule: '', deleteRule: '',
    schema: [
      new SchemaField({ name: 'sezione', type: 'relation', required: true, options: { collectionId: sezioni.id, cascadeDelete: true, maxSelect: 1 } }),
      new SchemaField({ name: 'nome', type: 'text', required: true, options: { max: 255 } }),
      new SchemaField({ name: 'descrizione', type: 'text', options: {} }),
      new SchemaField({ name: 'ordine', type: 'number', options: { noDecimal: true, min: 1 } }),
      new SchemaField({ name: 'legacy_id', type: 'number', options: { noDecimal: true } }),
    ],
  });
  dao.saveCollection(categorie);

  // ---- commissioni ----
  const commissioni = new Collection({
    name: 'commissioni',
    type: 'base',
    listRule: '', viewRule: '', createRule: '', updateRule: '', deleteRule: '',
    schema: [
      new SchemaField({ name: 'concorso', type: 'relation', required: true, options: { collectionId: concorsi.id, cascadeDelete: true, maxSelect: 1 } }),
      new SchemaField({ name: 'nome', type: 'text', required: true, options: { max: 255 } }),
      new SchemaField({ name: 'descrizione', type: 'text', options: {} }),
      new SchemaField({ name: 'commissari', type: 'relation', options: { collectionId: commissari.id, cascadeDelete: false, maxSelect: 99, minSelect: 0 } }),
      new SchemaField({ name: 'sezioni', type: 'relation', options: { collectionId: sezioni.id, cascadeDelete: false, maxSelect: 99, minSelect: 0 } }),
      new SchemaField({ name: 'categorie', type: 'relation', options: { collectionId: categorie.id, cascadeDelete: false, maxSelect: 99, minSelect: 0 } }),
      new SchemaField({ name: 'include_tutte_categorie', type: 'bool', options: {} }),
      new SchemaField({ name: 'legacy_id', type: 'number', options: { noDecimal: true } }),
    ],
  });
  dao.saveCollection(commissioni);

  // ---- candidati.sezioni / categorie ----
  if (!candidati.schema.getFieldByName('sezioni')) {
    candidati.schema.addField(new SchemaField({
      name: 'sezioni', type: 'relation',
      options: { collectionId: sezioni.id, cascadeDelete: false, maxSelect: 99, minSelect: 0 },
    }));
  }
  if (!candidati.schema.getFieldByName('categorie')) {
    candidati.schema.addField(new SchemaField({
      name: 'categorie', type: 'relation',
      options: { collectionId: categorie.id, cascadeDelete: false, maxSelect: 99, minSelect: 0 },
    }));
  }
  dao.saveCollection(candidati);
}, (db) => {
  const dao = new Dao(db);
  ['commissioni','categorie','sezioni'].forEach(n => {
    try { dao.deleteCollection(dao.findCollectionByNameOrId(n)); } catch(e) {}
  });
  const candidati = dao.findCollectionByNameOrId('candidati');
  ['sezioni','categorie'].forEach(name => {
    const f = candidati.schema.getFieldByName(name);
    if (f) candidati.schema.removeField(f.id);
  });
  dao.saveCollection(candidati);
});

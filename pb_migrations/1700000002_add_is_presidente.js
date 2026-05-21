/// <reference path="../pb_data/types.d.ts" />

// Adds the `is_presidente` boolean to the commissari collection.
// A presidente is a special commissario (one per concorso) who can start/end phases.

migrate((db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId('commissari');
  collection.schema.addField(new SchemaField({
    name: 'is_presidente',
    type: 'bool',
    options: {},
  }));
  dao.saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId('commissari');
  const f = collection.schema.getFieldByName('is_presidente');
  if (f) {
    collection.schema.removeField(f.id);
    dao.saveCollection(collection);
  }
});

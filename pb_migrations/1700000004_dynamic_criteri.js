/// <reference path="../pb_data/types.d.ts" />

// Adds dynamic criteri config:
//   • fasi.criteri (json) — array of {key, label, peso} per fase
//   • valutazioni.criterio: select → text (allow arbitrary criterion keys)

migrate((db) => {
  const dao = new Dao(db);

  // 1. Add `criteri` json to fasi
  const fasi = dao.findCollectionByNameOrId('fasi');
  if (!fasi.schema.getFieldByName('criteri')) {
    fasi.schema.addField(new SchemaField({
      name: 'criteri',
      type: 'json',
      options: { maxSize: 1048576 },
    }));
    dao.saveCollection(fasi);
  }

  // 2. Convert valutazioni.criterio from select → text.
  //    PB requires drop + re-add; existing values in that column will be cleared.
  const val = dao.findCollectionByNameOrId('valutazioni');
  const old = val.schema.getFieldByName('criterio');
  if (old && old.type !== 'text') {
    val.schema.removeField(old.id);
    val.schema.addField(new SchemaField({
      name: 'criterio',
      type: 'text',
      required: true,
      options: { max: 50 },
    }));
    dao.saveCollection(val);
  }
}, (db) => {
  const dao = new Dao(db);
  const fasi = dao.findCollectionByNameOrId('fasi');
  const fc = fasi.schema.getFieldByName('criteri');
  if (fc) { fasi.schema.removeField(fc.id); dao.saveCollection(fasi); }
  const val = dao.findCollectionByNameOrId('valutazioni');
  const old = val.schema.getFieldByName('criterio');
  if (old && old.type === 'text') {
    val.schema.removeField(old.id);
    val.schema.addField(new SchemaField({
      name: 'criterio',
      type: 'select',
      required: true,
      options: { maxSelect: 1, values: ['tecnica','interpretazione','intonazione','musicalita'] },
    }));
    dao.saveCollection(val);
  }
});

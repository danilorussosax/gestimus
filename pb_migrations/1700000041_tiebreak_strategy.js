/// <reference path="../pb_data/types.d.ts" />

// Tiebreak: cascata di regole per risolvere parità di punteggio.
// Schema:
//   - concorsi.default_tiebreak_strategy (JSON) — array ordinato di step, ognuno
//     con {key, enabled}. Cascata standard:
//       [{key:'scomposizione',enabled:true},
//        {key:'presidente',enabled:true},
//        {key:'eta',enabled:true},
//        {key:'ex_aequo',enabled:true}]
//   - fasi.tiebreak_strategy (JSON, nullable) — stessa struttura. Null = eredita
//     dal concorso. Permette override per fase (es. ex aequo solo in finale).
//   - candidati_fase.posizione_finale (number, nullable) — classifica congelata
//     al CONCLUDI fase.
//   - candidati_fase.tiebreak_log (JSON, nullable) — array di passi della cascata
//     applicati a questo candidato: [{step, vinto:bool, motivazione, ts}].
//   - candidati_fase.ex_aequo_group (text, nullable) — id condiviso tra i
//     candidati che terminano la cascata in pari (es. uuid corto). Vuoto = niente
//     ex aequo per questo candidato.

migrate((db) => {
  const dao = new Dao(db);

  const concorsi = dao.findCollectionByNameOrId('concorsi');
  if (!concorsi.schema.getFieldByName('default_tiebreak_strategy')) {
    concorsi.schema.addField(new SchemaField({
      name: 'default_tiebreak_strategy',
      type: 'json',
      options: { maxSize: 5000 },
    }));
    dao.saveCollection(concorsi);
  }

  const fasi = dao.findCollectionByNameOrId('fasi');
  if (!fasi.schema.getFieldByName('tiebreak_strategy')) {
    fasi.schema.addField(new SchemaField({
      name: 'tiebreak_strategy',
      type: 'json',
      options: { maxSize: 5000 },
    }));
    dao.saveCollection(fasi);
  }

  const cf = dao.findCollectionByNameOrId('candidati_fase');
  if (!cf.schema.getFieldByName('posizione_finale')) {
    cf.schema.addField(new SchemaField({
      name: 'posizione_finale',
      type: 'number',
      options: { min: 1 },
    }));
  }
  if (!cf.schema.getFieldByName('tiebreak_log')) {
    cf.schema.addField(new SchemaField({
      name: 'tiebreak_log',
      type: 'json',
      options: { maxSize: 10000 },
    }));
  }
  if (!cf.schema.getFieldByName('ex_aequo_group')) {
    cf.schema.addField(new SchemaField({
      name: 'ex_aequo_group',
      type: 'text',
      options: { max: 64 },
    }));
  }
  dao.saveCollection(cf);
}, (db) => {
  const dao = new Dao(db);
  const removeField = (collName, fieldName) => {
    try {
      const c = dao.findCollectionByNameOrId(collName);
      const f = c.schema.getFieldByName(fieldName);
      if (f) { c.schema.removeField(f.id); dao.saveCollection(c); }
    } catch (e) { /* skip */ }
  };
  removeField('concorsi', 'default_tiebreak_strategy');
  removeField('fasi', 'tiebreak_strategy');
  removeField('candidati_fase', 'posizione_finale');
  removeField('candidati_fase', 'tiebreak_log');
  removeField('candidati_fase', 'ex_aequo_group');
});

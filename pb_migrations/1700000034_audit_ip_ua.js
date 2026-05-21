/// <reference path="../pb_data/types.d.ts" />

// GDPR — aggiunge IP anonimizzato + User-Agent all'audit_log.
// L'IP viene memorizzato CON LE ULTIME DUE OTTETTI AZZERATI (es. 192.168.0.0)
// per essere conforme alla raccomandazione GDPR (Art. 4.5 — pseudonimizzazione).
// L'anonimizzazione avviene lato server nel hook (pb_hooks/iscrizioni.pb.js).

migrate((db) => {
  const dao = new Dao(db);
  const c = dao.findCollectionByNameOrId('audit_log');
  const addIfMissing = (name, type, options) => {
    if (!c.schema.getFieldByName(name)) {
      c.schema.addField(new SchemaField({ name, type, options: options || {} }));
    }
  };
  addIfMissing('ip_anon',    'text', { max: 64 });   // IP anonimizzato (es. "1.2.3.0" o "2001:db8::")
  addIfMissing('user_agent', 'text', { max: 500 });
  dao.saveCollection(c);
}, (db) => {
  const dao = new Dao(db);
  const c = dao.findCollectionByNameOrId('audit_log');
  ['ip_anon','user_agent'].forEach(name => {
    const f = c.schema.getFieldByName(name);
    if (f) c.schema.removeField(f.id);
  });
  dao.saveCollection(c);
});

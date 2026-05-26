import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { toast } from 'sonner';
import { Minus, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { fileUrl, httpErrorMessage } from '@/lib/api';
import { iconaPerSezione } from '@/lib/sezione-icon';
import {
  useCandidati,
  candidatiApi,
  type CandidatoFull,
  type MembroGruppo,
} from '@/api/candidati';
import type { Sezione, Categoria } from '@/types';
import {
  displayName,
  readImageResized,
  syncMembriGruppo,
  NATIONALITIES,
  type MembroDraft,
} from '../candidati-utils';

export interface FormDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  concorsoId: string;
  sezioni: Sezione[];
  categorie: Categoria[];
  existing?: CandidatoFull;
  onSaved?: () => void;
}

export type Tipo = 'individuale' | 'gruppo' | 'orchestra';

export function CandidatoFormDialog({
  open,
  onOpenChange,
  concorsoId,
  sezioni,
  categorie,
  existing,
  onSaved,
}: FormDialogProps) {
  const isEdit = !!existing;
  const { createMutation, updateMutation } = useCandidati(concorsoId);

  // Backward compat: split legacy combined nome.
  const splitInit = useMemo(() => {
    let n = existing?.nome ?? '';
    let cg = existing?.cognome ?? '';
    if (existing && !cg && n.includes(' ')) {
      const parts = n.split(/\s+/);
      n = parts[0] ?? '';
      cg = parts.slice(1).join(' ');
    }
    return { nome: n, cognome: cg };
  }, [existing]);

  // ── Form state (controllato) ──────────────────────────────────────────────
  const [nome, setNome] = useState('');
  const [cognome, setCognome] = useState('');
  const [strumento, setStrumento] = useState('');
  const [dataNascita, setDataNascita] = useState('');
  const [tipo, setTipo] = useState<Tipo>('individuale');
  const [nazionalita, setNazionalita] = useState('');
  const [sesso, setSesso] = useState('');
  const [luogoNascita, setLuogoNascita] = useState('');
  const [codiceFiscale, setCodiceFiscale] = useState('');
  const [gruppoNome, setGruppoNome] = useState('');
  const [email, setEmail] = useState('');
  const [telefono, setTelefono] = useState('');
  const [indirizzo, setIndirizzo] = useState('');
  const [citta, setCitta] = useState('');
  const [cap, setCap] = useState('');
  const [provincia, setProvincia] = useState('');
  const [paese, setPaese] = useState('Italia');
  const [anniStudio, setAnniStudio] = useState('');
  const [scuolaProvenienza, setScuolaProvenienza] = useState('');
  const [docenti, setDocenti] = useState('');
  const [noteLibere, setNoteLibere] = useState('');
  const [sezioneId, setSezioneId] = useState('');
  const [categoriaId, setCategoriaId] = useState('');

  // Foto: blob da uploadare + preview + flag rimozione esplicita
  const [fotoBlob, setFotoBlob] = useState<Blob | null>(null);
  const [fotoPreview, setFotoPreview] = useState<string | null>(null);
  const [fotoRemoved, setFotoRemoved] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const fotoInputRef = useRef<HTMLInputElement>(null);

  // Editor membri inline
  const [initialMembri, setInitialMembri] = useState<MembroDraft[]>([]);
  const [membri, setMembri] = useState<MembroDraft[]>([]);

  const isGroupLike = tipo === 'gruppo' || tipo === 'orchestra';
  const isOrchestra = tipo === 'orchestra';

  const filteredCategorie = useMemo(
    () => (sezioneId ? categorie.filter((c) => c.sezioneId === sezioneId) : []),
    [categorie, sezioneId],
  );

  const todayISO = new Date().toISOString().slice(0, 10);

  // (Re)inizializza il form all'apertura / cambio candidato
  useEffect(() => {
    if (!open) return;
    setNome(splitInit.nome);
    setCognome(splitInit.cognome);
    setStrumento(existing?.strumento ?? '');
    setDataNascita(existing?.dataNascita ?? '');
    const t: Tipo = existing?.tipo ?? 'individuale';
    setTipo(t === 'gruppo' || t === 'orchestra' ? t : 'individuale');
    setNazionalita(existing?.nazionalita ?? '');
    setSesso(existing?.sesso ?? '');
    setLuogoNascita(existing?.luogoNascita ?? '');
    setCodiceFiscale(existing?.codiceFiscale ?? '');
    setGruppoNome(existing?.gruppoNome ?? '');
    setEmail(existing?.email ?? '');
    setTelefono(existing?.telefono ?? '');
    setIndirizzo(existing?.indirizzo ?? '');
    setCitta(existing?.citta ?? '');
    setCap(existing?.cap ?? '');
    setProvincia(existing?.provincia ?? '');
    setPaese(existing?.paese ?? 'Italia');
    setAnniStudio(existing?.anniStudio != null ? String(existing.anniStudio) : '');
    setScuolaProvenienza(existing?.scuolaProvenienza ?? '');
    setDocenti((existing?.docentiPreparatori ?? []).join('\n'));
    setNoteLibere(existing?.noteLibere ?? '');
    setSezioneId(existing?.sezioneId ?? '');
    setCategoriaId(existing?.categoriaId ?? '');
    setFotoBlob(null);
    setFotoPreview(null);
    setFotoRemoved(false);
    setInitialMembri([]);
    setMembri([]);
  }, [open, existing, splitInit]);

  // Carica i membri esistenti (solo edit di gruppo/orchestra)
  useEffect(() => {
    if (!open) return;
    const t: Tipo = existing?.tipo ?? 'individuale';
    if (!existing || (t !== 'gruppo' && t !== 'orchestra')) return;
    let alive = true;
    candidatiApi
      .membri(existing.id)
      .then((rows: MembroGruppo[]) => {
        if (!alive) return;
        const drafts: MembroDraft[] = rows.map((m) => ({
          id: m.id,
          nome: m.nome || '',
          cognome: m.cognome ?? '',
          strumento: m.strumento ?? '',
          dataNascita: m.dataNascita ?? '',
        }));
        setInitialMembri(drafts);
        setMembri(drafts.map((m) => ({ ...m })));
      })
      .catch(() => {
        /* best-effort: senza membri il form resta utilizzabile */
      });
    return () => {
      alive = false;
    };
  }, [open, existing]);

  const currentFotoUrl = fotoRemoved
    ? null
    : (fotoPreview ?? (existing?.fotoUrl ? fileUrl(existing.fotoUrl) : null));

  const handleFotoChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { blob, dataUrl } = await readImageResized(file, 480, 0.85);
      setFotoBlob(blob);
      setFotoPreview(dataUrl);
      setFotoRemoved(false);
    } catch {
      toast.error("Impossibile elaborare l'immagine selezionata");
    }
  }, []);

  // Membri inline: helpers
  const updateMembro = (idx: number, field: keyof MembroDraft, value: string) => {
    setMembri((prev) =>
      prev.map((m, i) => (i === idx ? { ...m, [field]: value } : m)),
    );
  };
  const addMembroRow = () => {
    setMembri((prev) => [...prev, { id: null, nome: '', cognome: '', strumento: '', dataNascita: '' }]);
  };
  const removeMembroRow = (idx: number) => {
    setMembri((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    const docentiLines = docenti
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    const anni = anniStudio.trim() === '' ? null : Number(anniStudio);
    const tipoGruppo: 'orchestra' | 'ensemble' | null =
      tipo === 'orchestra' ? 'orchestra' : tipo === 'gruppo' ? 'ensemble' : null;

    const baseFields = {
      nome: nome.trim(),
      cognome: cognome.trim() || null,
      strumento: strumento.trim(),
      dataNascita: dataNascita || null,
      nazionalita: nazionalita.trim() || null,
      sesso: sesso.trim() || null,
      luogoNascita: luogoNascita.trim() || null,
      codiceFiscale: codiceFiscale.trim().toUpperCase() || null,
      email: email.trim() || null,
      telefono: telefono.trim() || null,
      indirizzo: indirizzo.trim() || null,
      citta: citta.trim() || null,
      cap: cap.trim() || null,
      provincia: provincia.trim().toUpperCase() || null,
      paese: paese.trim() || null,
      anniStudio: anni != null && Number.isFinite(anni) ? anni : null,
      scuolaProvenienza: scuolaProvenienza.trim() || null,
      docentiPreparatori: docentiLines,
      noteLibere: noteLibere.trim() || null,
      sezioneId: sezioneId || null,
      categoriaId: sezioneId ? categoriaId || null : null,
      gruppoNome: isGroupLike ? gruppoNome.trim() || null : null,
      tipo,
      tipoGruppo,
    };

    // Validazione: la sezione con categorie esige una categoria
    if (sezioneId && filteredCategorie.length > 0 && !categoriaId) {
      toast.error('Scegli una categoria della sezione selezionata');
      return;
    }
    // Required dinamici per tipo
    const missingIndividual =
      !baseFields.nome ||
      !baseFields.cognome ||
      !baseFields.strumento ||
      !baseFields.dataNascita ||
      !baseFields.nazionalita;
    const missingGruppo = !baseFields.nome || !baseFields.strumento;
    if ((tipo === 'individuale' && missingIndividual) || (isGroupLike && missingGruppo)) {
      toast.error('Compila i campi obbligatori');
      return;
    }

    setIsBusy(true);
    try {
      let savedId: string | undefined = existing?.id;
      if (isEdit && existing) {
        await updateMutation.mutateAsync({ id: existing.id, data: baseFields });
        savedId = existing.id;
        toast.success('Candidato aggiornato');
      } else {
        const created = await createMutation.mutateAsync({ concorsoId, ...baseFields });
        savedId = created.id;
        toast.success('Candidato aggiunto');
      }

      // Foto: upload nuovo blob, oppure rimozione esplicita
      if (savedId) {
        if (fotoBlob) {
          try {
            await candidatiApi.uploadFoto(savedId, fotoBlob);
          } catch {
            toast.warning('Candidato salvato, ma errore nel caricamento della foto');
          }
        } else if (fotoRemoved && existing?.fotoUrl) {
          try {
            await candidatiApi.deleteFoto(savedId);
          } catch {
            /* best-effort */
          }
        }
      }

      // Sync membri inline (gruppo/orchestra) — best-effort
      if (savedId) {
        try {
          await syncMembriGruppo(savedId, isGroupLike, initialMembri, membri);
        } catch (eMembri) {
          toast.error('Errore nella sincronizzazione dei membri: ' + httpErrorMessage(eMembri));
        }
      }

      onSaved?.();
      onOpenChange(false);
    } catch (e2) {
      toast.error(httpErrorMessage(e2));
    } finally {
      setIsBusy(false);
    }
  };

  const inputCls = 'c-input';
  const selectCls = 'c-select';
  const textareaCls = 'c-textarea';

  const gruppoNomeLabel = isOrchestra ? "Nome dell'orchestra" : 'Nome del gruppo / ensemble';
  const gruppoNomePlaceholder = isOrchestra
    ? 'es. Orchestra Giovanile di Milano'
    : 'es. Quartetto Brillante';
  const membriSectionLabel = isOrchestra ? "Membri dell'orchestra" : 'Membri del gruppo';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90dvh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Modifica candidato' : 'Nuovo candidato'}</DialogTitle>
          {isEdit && existing && (
            <DialogDescription>{displayName(existing)}</DialogDescription>
          )}
        </DialogHeader>

        <form
          onSubmit={handleSubmit}
          className="space-y-5 overflow-y-auto flex-1 pr-1"
          autoComplete="off"
        >
          {/* ---- Anagrafica base ---- */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="c-field">
              <span className="c-field__label">
                Nome <span className="text-rose-500">*</span>
              </span>
              <input
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                className={inputCls}
                placeholder="Mario"
              />
            </label>

            <label className="c-field">
              <span className="c-field__label">
                Cognome {!isGroupLike && <span className="text-rose-500">*</span>}
              </span>
              <input
                value={cognome}
                onChange={(e) => setCognome(e.target.value)}
                className={inputCls}
                placeholder="Rossi"
              />
            </label>

            <label className="c-field">
              <span className="c-field__label">
                Strumento <span className="text-rose-500">*</span>
              </span>
              <input
                value={strumento}
                onChange={(e) => setStrumento(e.target.value)}
                className={inputCls}
                placeholder="es. Pianoforte, Violino, Canto..."
              />
            </label>

            <label className="c-field">
              <span className="c-field__label">
                Data di nascita {!isGroupLike && <span className="text-rose-500">*</span>}
              </span>
              <input
                type="date"
                value={dataNascita}
                onChange={(e) => setDataNascita(e.target.value)}
                className={inputCls}
                max={todayISO}
              />
            </label>

            <label className="c-field">
              <span className="c-field__label">Tipo candidato</span>
              <select
                value={tipo}
                onChange={(e) => {
                  const v = e.target.value as Tipo;
                  setTipo(v);
                  if (v === 'individuale') setGruppoNome('');
                }}
                className={selectCls}
              >
                <option value="individuale">Individuale</option>
                <option value="gruppo">Gruppo / Ensemble</option>
                <option value="orchestra">Orchestra</option>
              </select>
            </label>

            <label className="c-field sm:col-span-2">
              <span className="c-field__label">
                Nazionalità {!isGroupLike && <span className="text-rose-500">*</span>}
              </span>
              <input
                value={nazionalita}
                onChange={(e) => setNazionalita(e.target.value)}
                className={inputCls}
                list="naz-list"
                placeholder="es. Italiana"
              />
              <datalist id="naz-list">
                {NATIONALITIES.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            </label>

            <label className="c-field">
              <span className="c-field__label">Sesso</span>
              <select value={sesso} onChange={(e) => setSesso(e.target.value)} className={selectCls}>
                <option value="">— Seleziona —</option>
                <option value="M">Maschio</option>
                <option value="F">Femmina</option>
                <option value="altro">Altro / preferisco non specificare</option>
              </select>
            </label>

            <label className="c-field">
              <span className="c-field__label">Luogo di nascita</span>
              <input
                value={luogoNascita}
                onChange={(e) => setLuogoNascita(e.target.value)}
                className={inputCls}
                placeholder="Città (Provincia)"
              />
            </label>

            <label className="c-field sm:col-span-2">
              <span className="c-field__label">Codice fiscale</span>
              <input
                value={codiceFiscale}
                onChange={(e) => setCodiceFiscale(e.target.value.toUpperCase())}
                className={`${inputCls} font-mono uppercase`}
                maxLength={16}
                placeholder="RSSMRA80A01H501U"
              />
            </label>
          </div>

          {/* ---- Gruppo/Orchestra: nome + membri inline ---- */}
          {isGroupLike && (
            <div className="pt-4 border-t border-slate-200 space-y-4">
              <label className="c-field">
                <span className="c-field__label">{gruppoNomeLabel}</span>
                <input
                  value={gruppoNome}
                  onChange={(e) => setGruppoNome(e.target.value)}
                  className={inputCls}
                  placeholder={gruppoNomePlaceholder}
                />
              </label>

              <div>
                <div className="flex items-baseline justify-between gap-2 mb-2">
                  <span className="text-sm font-medium text-slate-700">{membriSectionLabel}</span>
                  <span className="text-[11px] text-slate-500">{membri.length} membri</span>
                </div>
                <p className="text-[11px] text-slate-500 mb-2">
                  Elenco dei componenti (nome, cognome, strumento, data di nascita). Le modifiche
                  vengono salvate insieme al candidato.
                </p>
                <div className="space-y-2">
                  {membri.length === 0 ? (
                    <p className="text-xs text-slate-400 italic">Nessun membro inserito.</p>
                  ) : (
                    membri.map((m, i) => (
                      <div key={i} className="grid grid-cols-12 gap-2 items-start">
                        <input
                          className={`${inputCls} col-span-3`}
                          placeholder="Nome"
                          value={m.nome}
                          onChange={(e) => updateMembro(i, 'nome', e.target.value)}
                        />
                        <input
                          className={`${inputCls} col-span-3`}
                          placeholder="Cognome"
                          value={m.cognome}
                          onChange={(e) => updateMembro(i, 'cognome', e.target.value)}
                        />
                        <input
                          className={`${inputCls} col-span-3`}
                          placeholder="Strumento"
                          value={m.strumento}
                          onChange={(e) => updateMembro(i, 'strumento', e.target.value)}
                        />
                        <input
                          type="date"
                          className={`${inputCls} col-span-2 text-xs`}
                          value={m.dataNascita}
                          onChange={(e) => updateMembro(i, 'dataNascita', e.target.value)}
                        />
                        <button
                          type="button"
                          className="col-span-1 text-xs text-rose-600 hover:bg-rose-50 rounded-lg px-2 py-2 self-stretch font-medium"
                          title="Rimuovi membro"
                          onClick={() => removeMembroRow(i)}
                        >
                          <Minus className="h-4 w-4 mx-auto" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
                <button
                  type="button"
                  className="mt-2 text-xs font-medium text-brand-700 hover:text-brand-900"
                  onClick={addMembroRow}
                >
                  + Aggiungi membro
                </button>
              </div>
            </div>
          )}

          {/* ---- Foto ---- */}
          <div className="pt-4 border-t border-slate-200">
            <span className="text-sm font-medium text-slate-700 block mb-2">Foto del candidato</span>
            <div className="flex items-center gap-3">
              <div className="w-20 h-20 rounded-full bg-slate-100 border-2 border-slate-200 overflow-hidden flex items-center justify-center shrink-0">
                {currentFotoUrl ? (
                  <img src={currentFotoUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-3xl text-slate-400">👤</span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <button
                  type="button"
                  className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-brand-700 bg-brand-50 hover:bg-brand-100 rounded-lg transition"
                  onClick={() => fotoInputRef.current?.click()}
                >
                  {currentFotoUrl ? 'Cambia foto' : 'Carica foto'}
                </button>
                {currentFotoUrl && (
                  <button
                    type="button"
                    className="ml-1 text-xs font-medium text-rose-600 hover:text-rose-800"
                    onClick={() => {
                      setFotoBlob(null);
                      setFotoPreview(null);
                      setFotoRemoved(true);
                    }}
                  >
                    Rimuovi
                  </button>
                )}
                <input
                  ref={fotoInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFotoChange}
                />
                <p className="text-[10px] text-slate-500 mt-1.5">
                  JPG, PNG o WebP. Verrà ridimensionata automaticamente.
                </p>
              </div>
            </div>
          </div>

          {/* ---- Contatti ---- */}
          <div className="pt-4 border-t border-slate-200">
            <header className="mb-2">
              <h4 className="text-sm font-semibold text-slate-700">Contatti</h4>
              <p className="text-[11px] text-slate-500">
                Email e recapiti per comunicazioni dell'organizzazione.
              </p>
            </header>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="c-field">
                <span className="c-field__label">Email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputCls}
                  placeholder="nome@esempio.it"
                />
              </label>
              <label className="c-field">
                <span className="c-field__label">Telefono</span>
                <input
                  type="tel"
                  value={telefono}
                  onChange={(e) => setTelefono(e.target.value)}
                  className={inputCls}
                  placeholder="+39 ..."
                />
              </label>
              <label className="c-field sm:col-span-2">
                <span className="c-field__label">Indirizzo</span>
                <input
                  value={indirizzo}
                  onChange={(e) => setIndirizzo(e.target.value)}
                  className={inputCls}
                  placeholder="Via, civico"
                />
              </label>
              <label className="c-field">
                <span className="c-field__label">Città</span>
                <input value={citta} onChange={(e) => setCitta(e.target.value)} className={inputCls} />
              </label>
              <label className="c-field">
                <span className="c-field__label">CAP</span>
                <input
                  value={cap}
                  onChange={(e) => setCap(e.target.value)}
                  className={inputCls}
                  maxLength={10}
                />
              </label>
              <label className="c-field">
                <span className="c-field__label">Provincia</span>
                <input
                  value={provincia}
                  onChange={(e) => setProvincia(e.target.value.toUpperCase())}
                  className={inputCls}
                  maxLength={3}
                  placeholder="MI"
                />
              </label>
              <label className="c-field">
                <span className="c-field__label">Paese</span>
                <input value={paese} onChange={(e) => setPaese(e.target.value)} className={inputCls} />
              </label>
            </div>
          </div>

          {/* ---- Studi musicali ---- */}
          <div className="pt-4 border-t border-slate-200">
            <header className="mb-2">
              <h4 className="text-sm font-semibold text-slate-700">Studi musicali</h4>
              <p className="text-[11px] text-slate-500">Esperienza e provenienza.</p>
            </header>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="c-field">
                <span className="c-field__label">Anni di studio</span>
                <input
                  type="number"
                  min={0}
                  max={80}
                  value={anniStudio}
                  onChange={(e) => setAnniStudio(e.target.value)}
                  className={inputCls}
                />
              </label>
              <label className="c-field sm:col-span-2">
                <span className="c-field__label">Scuola / Conservatorio di provenienza</span>
                <input
                  value={scuolaProvenienza}
                  onChange={(e) => setScuolaProvenienza(e.target.value)}
                  className={inputCls}
                />
              </label>
            </div>
          </div>

          {/* ---- Docenti preparatori ---- */}
          <div className="pt-4 border-t border-slate-200">
            <label className="c-field">
              <span className="c-field__label">
                Docenti preparatori{' '}
                <span className="text-[11px] text-slate-500 font-normal">(uno per riga)</span>
              </span>
              <textarea
                value={docenti}
                onChange={(e) => setDocenti(e.target.value)}
                rows={3}
                className={textareaCls}
                placeholder={'Prof. Mario Rossi\nProf.ssa Anna Bianchi'}
              />
            </label>
          </div>

          {/* ---- Sezione e categoria (radio-card, auto-derive sezione) ---- */}
          <div className="pt-4 border-t border-slate-200">
            <header className="mb-2">
              <h4 className="text-sm font-semibold text-slate-700">Iscrizione a sezione</h4>
              <p className="text-[11px] text-slate-500">Assegna il candidato a una sezione del concorso.</p>
            </header>
            {sezioni.length === 0 ? (
              <p className="text-xs text-slate-400 italic">
                Nessuna sezione disponibile. Creane una nella tab Sezioni.
              </p>
            ) : (
              <>
                <p className="text-[11px] text-slate-500 mb-2">
                  Un candidato appartiene a una sola sezione e a una sola categoria all'interno di essa.
                </p>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer border border-slate-200 rounded-lg p-2 bg-white">
                    <input
                      type="radio"
                      name="sezione_id"
                      checked={!sezioneId}
                      onChange={() => {
                        setSezioneId('');
                        setCategoriaId('');
                      }}
                      className="w-4 h-4"
                    />
                    <span className="text-sm text-slate-600 italic">— Nessuna sezione —</span>
                  </label>
                  {sezioni.map((s) => {
                    const cats = categorie.filter((c) => c.sezioneId === s.id);
                    const isSelected = sezioneId === s.id;
                    return (
                      <div
                        key={s.id}
                        className={[
                          'border rounded-lg p-2.5 bg-slate-50',
                          isSelected ? 'border-brand-300 ring-1 ring-brand-200' : 'border-slate-200',
                        ].join(' ')}
                      >
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="sezione_id"
                            checked={isSelected}
                            onChange={() => {
                              setSezioneId(s.id);
                              setCategoriaId('');
                            }}
                            className="w-4 h-4"
                          />
                          <span className="text-sm font-semibold text-slate-800">
                            {iconaPerSezione(s.nome)} {s.nome}
                          </span>
                          <span className="text-[10px] text-slate-500">
                            {cats.length} categori{cats.length === 1 ? 'a' : 'e'}
                          </span>
                        </label>
                        {isSelected && cats.length > 0 && (
                          <div className="mt-2 ml-6 grid grid-cols-1 sm:grid-cols-2 gap-1">
                            {cats.map((c) => (
                              <label
                                key={c.id}
                                className="flex items-center gap-2 bg-white hover:bg-brand-50 border border-slate-200 rounded-md px-2 py-1 cursor-pointer"
                              >
                                <input
                                  type="radio"
                                  name="categoria_id"
                                  checked={categoriaId === c.id}
                                  onChange={() => {
                                    // Auto-derive: scegliere una categoria seleziona la sua sezione
                                    setSezioneId(s.id);
                                    setCategoriaId(c.id);
                                  }}
                                  className="w-3.5 h-3.5"
                                />
                                <span className="text-xs text-slate-700">{c.nome}</span>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* ---- Note libere ---- */}
          <div className="pt-4 border-t border-slate-200">
            <label className="c-field">
              <span className="c-field__label">
                Note libere{' '}
                <span className="text-[11px] text-slate-500 font-normal">(opzionale)</span>
              </span>
              <textarea
                value={noteLibere}
                onChange={(e) => setNoteLibere(e.target.value)}
                rows={2}
                className={textareaCls}
                placeholder="Qualsiasi informazione utile all'organizzazione"
              />
            </label>
          </div>

          <DialogFooter className="pt-2">
            <button type="button" className="c-btn c-btn--outline" onClick={() => onOpenChange(false)}>
              Annulla
            </button>
            <button type="submit" className="c-btn c-btn--primary" disabled={isBusy}>
              {isBusy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Salvataggio…
                </>
              ) : isEdit ? (
                'Salva modifiche'
              ) : (
                'Aggiungi candidato'
              )}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

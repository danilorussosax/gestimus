// =============================================================================
// CandidatiTab — gestione candidati di un concorso (admin)
//
// Rebuild FEDELE del sorgente vanilla js/views/admin/candidati.js:
//  - Toolbar: conteggio + import CSV (placeholder coerente) + aggiungi
//  - Card candidato: avatar foto / icona gruppo-orchestra, numero, badge tipo,
//    nazionalità, strumento + età, pill membri gruppo, conteggio membri,
//    data di nascita, badge sezione (iconaPerSezione) + categoria, badge docenti
//  - Pulsanti card: Modifica, Membri (gruppo), Storico (individuale), Elimina
//  - Form create/edit completo: anagrafica estesa, contatti, studi musicali,
//    foto (resize client-side), docenti, sezione/categoria a radio-card con
//    auto-derive sezione da categoria, editor inline membri gruppo, note libere,
//    required dinamici per tipo
//  - Modale "Membri del gruppo": aggiungi/rimuovi membri (dati piatti)
//  - Modale "Storico": partecipazioni cross-concorso per stessa identità
//  - Delete con conferma
//
// Design system: c-btn/c-field/c-input/c-select/c-textarea, palette brand/ink,
//   icone lucide-react, iconaPerSezione da @/lib/sezione-icon, toast 'sonner',
//   fileUrl da @/lib/api.
// =============================================================================

import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { toast } from 'sonner';
import {
  Plus, Pencil, Trash2, Search, GraduationCap, Users, Music,
  X, Upload, History, Minus, Loader2,
} from 'lucide-react';

import { fileUrl, httpErrorMessage } from '@/lib/api';
import { iconaPerSezione } from '@/lib/sezione-icon';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';

import {
  useCandidati,
  candidatiApi,
  type CandidatoFull,
  type MembroGruppo,
} from '@/api/candidati';
import { useConcorsi } from '@/api/concorsi';
import type { Sezione, Categoria } from '@/types';
import ImportCsvDialog from '@/components/admin/ImportCsvDialog';

// ---------------------------------------------------------------------------
// Helpers (port da js/utils.js)
// ---------------------------------------------------------------------------

/** displayName: per gruppi/orchestre solo il nome; altrimenti "Nome Cognome". */
function displayName(
  c: Pick<CandidatoFull, 'nome' | 'cognome' | 'tipo'> | null | undefined,
): string {
  if (!c) return '—';
  if (c.tipo === 'gruppo' || c.tipo === 'orchestra') return c.nome || '—';
  return `${c.nome || ''} ${c.cognome || ''}`.trim() || '—';
}

function ageFromDate(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - d.getFullYear();
  const m = today.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--;
  return age >= 0 ? age : null;
}

/** fmtDate: gg mmm aaaa (it-IT) come il vanilla. */
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('it-IT', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso ?? '—';
  }
}

const NATIONALITIES = [
  'Italiana', 'Albanese', 'Argentina', 'Australiana', 'Austriaca', 'Belga', 'Brasiliana',
  'Britannica', 'Bulgara', 'Canadese', 'Cinese', 'Coreana', 'Croata', 'Danese', 'Estone',
  'Finlandese', 'Francese', 'Giapponese', 'Greca', 'Indiana', 'Iraniana', 'Irlandese',
  'Israeliana', 'Lettone', 'Lituana', 'Maltese', 'Messicana', 'Moldava', 'Norvegese',
  'Olandese', 'Polacca', 'Portoghese', 'Rumena', 'Russa', 'Serba', 'Slovacca', 'Slovena',
  'Spagnola', 'Statunitense', 'Svedese', 'Svizzera', 'Tedesca', 'Turca', 'Ucraina', 'Ungherese',
];

/**
 * Resize client-side dell'immagine (port di readImageResized): preserva il
 * formato sorgente (PNG/WebP con alpha, JPEG ricompresso) e ridimensiona al
 * lato massimo `maxDim`. Restituisce un Blob da inviare via multipart upload.
 */
async function readImageResized(
  file: File,
  maxDim = 480,
  quality = 0.85,
): Promise<{ blob: Blob; dataUrl: string }> {
  const dataURL: string = await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
  const inputMime = (file.type || '').toLowerCase();
  const outputMime =
    inputMime === 'image/jpeg' || inputMime === 'image/jpg'
      ? 'image/jpeg'
      : inputMime === 'image/webp'
        ? 'image/webp'
        : 'image/png';
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const ratio = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width * ratio);
      const h = Math.round(img.height * ratio);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('canvas context non disponibile'));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL(outputMime, quality);
      canvas.toBlob(
        (blob) => {
          if (blob) resolve({ blob, dataUrl });
          else reject(new Error('toBlob fallito'));
        },
        outputMime,
        quality,
      );
    };
    img.onerror = reject;
    img.src = dataURL;
  });
}

/** Normalizza per il match identità dello storico (accenti + case insensitive). */
function norm(s: string | null | undefined): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

// ---------------------------------------------------------------------------
// Membro inline (stato editabile nel form gruppo/orchestra)
// ---------------------------------------------------------------------------

interface MembroDraft {
  id: string | null;
  nome: string;
  cognome: string;
  strumento: string;
  dataNascita: string;
}

/**
 * Diff idempotente dei membri inline dopo create/update del candidato
 * (port di syncMembriGruppo):
 *  - se non è più gruppo/orchestra → cancella tutti i membri originali;
 *  - altrimenti elimina gli assenti, aggiorna quelli con id rimasti se cambiati,
 *    crea i nuovi (senza id). Le righe senza nome vengono scartate.
 */
async function syncMembriGruppo(
  candidatoId: string,
  isGroupLike: boolean,
  original: MembroDraft[],
  current: MembroDraft[],
): Promise<void> {
  const sanitized = (current || [])
    .map((m) => ({
      id: m.id || null,
      nome: (m.nome || '').trim(),
      cognome: (m.cognome || '').trim(),
      strumento: (m.strumento || '').trim(),
      dataNascita: (m.dataNascita || '').trim(),
    }))
    .filter((m) => m.nome);

  if (!isGroupLike) {
    for (const o of original) {
      if (o.id) await candidatiApi.removeMembro(o.id);
    }
    return;
  }

  const keptIds = new Set(sanitized.filter((m) => m.id).map((m) => m.id));
  for (const o of original) {
    if (o.id && !keptIds.has(o.id)) {
      await candidatiApi.removeMembro(o.id);
    }
  }
  for (const m of sanitized) {
    if (m.id) {
      const old = original.find((o) => o.id === m.id);
      const changed =
        !old ||
        (old.nome || '') !== m.nome ||
        (old.cognome || '') !== m.cognome ||
        (old.strumento || '') !== m.strumento ||
        (old.dataNascita || '') !== m.dataNascita;
      if (changed) {
        await candidatiApi.updateMembro(m.id, {
          nome: m.nome,
          cognome: m.cognome || undefined,
          strumento: m.strumento || undefined,
          dataNascita: m.dataNascita || undefined,
        });
      }
    } else {
      await candidatiApi.addMembro({
        candidatoId,
        nome: m.nome,
        cognome: m.cognome || undefined,
        strumento: m.strumento || undefined,
        dataNascita: m.dataNascita || undefined,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// CandidatoFormDialog
// ---------------------------------------------------------------------------

interface FormDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  concorsoId: string;
  sezioni: Sezione[];
  categorie: Categoria[];
  existing?: CandidatoFull;
  onSaved?: () => void;
}

type Tipo = 'individuale' | 'gruppo' | 'orchestra';

function CandidatoFormDialog({
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
    let n = existing?.nome || '';
    let cg = existing?.cognome || '';
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
          cognome: m.cognome || '',
          strumento: m.strumento || '',
          dataNascita: m.dataNascita || '',
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

  const handleSubmit = async (e: React.FormEvent) => {
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

// ---------------------------------------------------------------------------
// MembriGruppoModal — aggiungi/rimuovi membri (dati piatti)
// ---------------------------------------------------------------------------

interface MembriModalProps {
  open: boolean;
  gruppo: CandidatoFull | null;
  onClose: () => void;
}

function MembriGruppoModal({ open, gruppo, onClose }: MembriModalProps) {
  const [membri, setMembri] = useState<MembroGruppo[]>([]);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState({ nome: '', cognome: '', strumento: '', dataNascita: '' });
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!gruppo) return;
    setLoading(true);
    try {
      const rows = await candidatiApi.membri(gruppo.id);
      setMembri(rows);
    } catch (e) {
      toast.error(httpErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [gruppo]);

  useEffect(() => {
    if (open && gruppo) {
      setDraft({ nome: '', cognome: '', strumento: '', dataNascita: '' });
      void reload();
    }
  }, [open, gruppo, reload]);

  const addMembro = async () => {
    if (!gruppo || !draft.nome.trim()) {
      toast.error('Il nome del membro è obbligatorio');
      return;
    }
    setBusy(true);
    try {
      await candidatiApi.addMembro({
        candidatoId: gruppo.id,
        nome: draft.nome.trim(),
        cognome: draft.cognome.trim() || undefined,
        strumento: draft.strumento.trim() || undefined,
        dataNascita: draft.dataNascita.trim() || undefined,
      });
      setDraft({ nome: '', cognome: '', strumento: '', dataNascita: '' });
      await reload();
    } catch (e) {
      toast.error(httpErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const removeMembro = async (id: string) => {
    setBusy(true);
    try {
      await candidatiApi.removeMembro(id);
      await reload();
    } catch (e) {
      toast.error(httpErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const isGroup = gruppo?.tipo === 'gruppo' || gruppo?.tipo === 'orchestra';

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Membri di {gruppo ? displayName(gruppo) : ''}</DialogTitle>
        </DialogHeader>

        {!isGroup ? (
          <p className="text-sm text-rose-600">Questo candidato non è un gruppo.</p>
        ) : (
          <div className="space-y-4">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                Membri attuali ({membri.length})
              </p>
              {loading ? (
                <p className="text-sm text-slate-400 italic">Caricamento…</p>
              ) : membri.length === 0 ? (
                <p className="text-sm text-slate-500 italic">Nessun membro inserito.</p>
              ) : (
                <div className="space-y-2">
                  {membri.map((m) => (
                    <div
                      key={m.id}
                      className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-3 py-2"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-medium text-slate-800 text-sm truncate">
                          {[m.nome, m.cognome].filter(Boolean).join(' ')}
                        </span>
                        {m.strumento && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-purple-50 text-purple-700 rounded-full">
                            {m.strumento}
                          </span>
                        )}
                      </div>
                      <button
                        className="text-xs text-rose-600 hover:bg-rose-50 px-2 py-1 rounded-lg font-medium shrink-0"
                        disabled={busy}
                        onClick={() => removeMembro(m.id)}
                      >
                        Elimina
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-slate-200">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                Aggiungi membro
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  className="c-input"
                  placeholder="Nome *"
                  value={draft.nome}
                  onChange={(e) => setDraft((d) => ({ ...d, nome: e.target.value }))}
                />
                <input
                  className="c-input"
                  placeholder="Cognome"
                  value={draft.cognome}
                  onChange={(e) => setDraft((d) => ({ ...d, cognome: e.target.value }))}
                />
                <input
                  className="c-input"
                  placeholder="Strumento"
                  value={draft.strumento}
                  onChange={(e) => setDraft((d) => ({ ...d, strumento: e.target.value }))}
                />
                <input
                  type="date"
                  className="c-input"
                  value={draft.dataNascita}
                  onChange={(e) => setDraft((d) => ({ ...d, dataNascita: e.target.value }))}
                />
              </div>
              <button
                type="button"
                className="c-btn c-btn--sm c-btn--primary mt-2"
                disabled={busy}
                onClick={addMembro}
              >
                <Plus className="h-4 w-4" /> Aggiungi
              </button>
            </div>
          </div>
        )}

        <DialogFooter>
          <button className="c-btn c-btn--outline" onClick={onClose}>
            Chiudi
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// StoricoModal — partecipazioni cross-concorso per stessa identità
// ---------------------------------------------------------------------------

interface StoricoRow {
  cand: CandidatoFull;
  concorsoNome: string;
  concorsoAnno: number | null;
  fasi: number;
  esibizioni: number;
  valutazioni: number;
}

interface StoricoModalProps {
  open: boolean;
  candidato: CandidatoFull | null;
  onClose: () => void;
}

function StoricoModal({ open, candidato, onClose }: StoricoModalProps) {
  const { data: concorsi = [] } = useConcorsi();
  const [rows, setRows] = useState<StoricoRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !candidato) return;
    let alive = true;
    setLoading(true);
    setRows([]);
    (async () => {
      try {
        const all = await candidatiApi.listAll();
        const key = `${norm(candidato.nome)}|${norm(candidato.cognome)}`;
        const matches = all.filter(
          (c) =>
            c.id !== candidato.id &&
            `${norm(c.nome)}|${norm(c.cognome)}` === key,
        );
        const concorsoById = new Map(concorsi.map((c) => [c.id, c]));
        // Conteggi reali (bounded ai pochi match): fasi del concorso →
        // candidati-fase del candidato → valutazioni di ciascun cf.
        const built: StoricoRow[] = [];
        for (const c of matches) {
          const concorso = concorsoById.get(c.concorsoId);
          let fasiCount = 0;
          let esibizioni = 0;
          let valutazioni = 0;
          try {
            const fasi = await candidatiApi.fasi(c.concorsoId);
            fasiCount = fasi.length;
            for (const f of fasi) {
              const cfs = await candidatiApi.candidatiFase(f.id);
              const mine = cfs.filter((cf) => cf.candidatoId === c.id);
              esibizioni += mine.length;
              for (const cf of mine) {
                const vs = await candidatiApi.valutazioni(cf.id);
                valutazioni += vs.length;
              }
            }
          } catch {
            /* conteggi best-effort */
          }
          built.push({
            cand: c,
            concorsoNome: concorso?.nome ?? '—',
            concorsoAnno: concorso?.anno ?? null,
            fasi: fasiCount,
            esibizioni,
            valutazioni,
          });
        }
        built.sort((a, b) => (b.concorsoAnno ?? 0) - (a.concorsoAnno ?? 0));
        if (alive) setRows(built);
      } catch (e) {
        if (alive) toast.error(httpErrorMessage(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, candidato, concorsi]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[85dvh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Storico di {candidato ? displayName(candidato) : ''}</DialogTitle>
          <DialogDescription>
            Partecipazioni dello stesso candidato in altri concorsi.
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto flex-1">
          {loading ? (
            <p className="text-sm text-slate-500 italic text-center py-8">Caricamento…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-slate-500 italic text-center py-8">
              Nessuna partecipazione storica trovata.
            </p>
          ) : (
            <div className="space-y-3">
              {rows.map((r) => (
                <div key={r.cand.id} className="bg-white border border-slate-200 rounded-xl p-4">
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div>
                      <span className="font-semibold text-slate-900">{r.concorsoNome}</span>
                      <span className="text-xs text-slate-500 ml-2">{r.concorsoAnno ?? '—'}</span>
                    </div>
                    <span className="text-xs text-slate-500">
                      #{r.cand.numeroCandidato ?? '—'}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-xs">
                    <div className="bg-slate-50 rounded-lg px-2 py-1.5 text-center">
                      <div className="text-slate-500">fasi</div>
                      <div className="font-bold text-slate-800">{r.fasi}</div>
                    </div>
                    <div className="bg-slate-50 rounded-lg px-2 py-1.5 text-center">
                      <div className="text-slate-500">esibizioni</div>
                      <div className="font-bold text-slate-800">{r.esibizioni}</div>
                    </div>
                    <div className="bg-slate-50 rounded-lg px-2 py-1.5 text-center">
                      <div className="text-slate-500">valutazioni</div>
                      <div className="font-bold text-slate-800">{r.valutazioni}</div>
                    </div>
                    <div className="bg-slate-50 rounded-lg px-2 py-1.5 text-center">
                      <div className="text-slate-500">strumento</div>
                      <div className="font-bold text-slate-800 truncate text-[11px]">
                        {r.cand.strumento || '—'}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <button className="c-btn c-btn--outline" onClick={onClose}>
            Chiudi
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// DeleteConfirmDialog
// ---------------------------------------------------------------------------

interface DeleteConfirmProps {
  open: boolean;
  candidato: CandidatoFull | null;
  onCancel: () => void;
  onConfirm: () => void;
  isPending: boolean;
}

function DeleteConfirmDialog({ open, candidato, onCancel, onConfirm, isPending }: DeleteConfirmProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Elimina candidato</DialogTitle>
          <DialogDescription>
            Eliminare definitivamente <strong>{candidato ? displayName(candidato) : ''}</strong>?
            L&apos;operazione non è reversibile.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <button className="c-btn c-btn--outline" onClick={onCancel}>
            Annulla
          </button>
          <button className="c-btn c-btn--danger" onClick={onConfirm} disabled={isPending}>
            {isPending ? 'Eliminazione…' : 'Elimina'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// CandidatoCard  (port fedele di candidatoCardHtml)
// ---------------------------------------------------------------------------

interface CandidatoCardProps {
  candidato: CandidatoFull;
  sezione?: Sezione;
  categoria?: Categoria;
  membri: MembroGruppo[];
  onEdit: () => void;
  onManageMembers: () => void;
  onHistory: () => void;
  onDelete: () => void;
}

function CandidatoCard({
  candidato: c,
  sezione,
  categoria,
  membri,
  onEdit,
  onManageMembers,
  onHistory,
  onDelete,
}: CandidatoCardProps) {
  const isOrchestra = c.tipo === 'orchestra';
  const isGruppo = c.tipo === 'gruppo' || isOrchestra;
  const age = ageFromDate(c.dataNascita);
  const fotoSrc = c.fotoUrl ? fileUrl(c.fotoUrl) : null;
  const docenti = c.docentiPreparatori ?? [];
  const gruppoBadgeLabel = isOrchestra ? 'ORCHESTRA' : 'GRUPPO';

  return (
    <div
      className={[
        'bg-white border rounded-2xl p-4 flex items-start gap-3 hover:border-slate-300 transition',
        isGruppo ? 'border-purple-200 bg-purple-50/30' : 'border-slate-200',
      ].join(' ')}
    >
      {/* Avatar */}
      <div
        className={[
          'w-14 h-14 rounded-full overflow-hidden flex items-center justify-center text-2xl text-slate-400 shrink-0 ring-2 ring-white shadow-soft',
          isGruppo ? 'bg-purple-100' : 'bg-slate-100',
        ].join(' ')}
      >
        {fotoSrc ? (
          <img src={fotoSrc} alt="" className="w-full h-full object-cover" />
        ) : isGruppo ? (
          isOrchestra ? (
            <Music className="h-6 w-6 text-purple-500" />
          ) : (
            <Users className="h-6 w-6 text-purple-500" />
          )
        ) : (
          <span>👤</span>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {c.numeroCandidato != null && (
            <span className="font-mono text-[11px] text-slate-500">
              #{String(c.numeroCandidato).padStart(3, '0')}
            </span>
          )}
          {isGruppo && (
            <span className="text-[10px] px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded-full font-bold uppercase tracking-wider">
              {gruppoBadgeLabel}
            </span>
          )}
          {!isGruppo && c.nazionalita && (
            <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-700 rounded-full font-medium">
              {c.nazionalita}
            </span>
          )}
        </div>

        <h4 className="font-semibold text-slate-900 truncate mt-0.5">{displayName(c)}</h4>

        <p className="text-xs text-slate-600 truncate">
          {c.strumento || '—'}
          {!isGruppo && age != null && ` · ${age} anni`}
        </p>

        {/* Pill membri (gruppo) */}
        {isGruppo && membri.length > 0 && (
          <div className="mt-1.5 flex items-center gap-1 flex-wrap">
            {membri.map((m) => (
              <span
                key={m.id}
                className="text-[10px] px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded-full font-medium"
              >
                {m.nome || ''} {m.cognome || ''}
                {m.strumento ? ` · ${m.strumento}` : ''}
              </span>
            ))}
          </div>
        )}

        {/* Conteggio membri */}
        {membri.length > 0 && (
          <p className="text-[10px] text-purple-600 mt-0.5 font-medium">
            {membri.length} membr{membri.length === 1 ? 'o' : 'i'}
          </p>
        )}

        {/* Data di nascita (individuale) */}
        {!isGruppo && c.dataNascita && (
          <p className="text-[11px] text-slate-500 mt-0.5">Nato/a il {fmtDate(c.dataNascita)}</p>
        )}

        {/* Sezione / categoria */}
        {(sezione || categoria) && (
          <div className="mt-1.5 flex items-center gap-1 flex-wrap">
            {sezione && (
              <span className="text-[10px] px-1.5 py-0.5 bg-brand-50 text-brand-700 rounded-full font-medium">
                {iconaPerSezione(sezione.nome)} {sezione.nome}
              </span>
            )}
            {categoria && (
              <span className="text-[10px] px-1.5 py-0.5 bg-cyan-50 text-cyan-700 rounded-full font-medium">
                📑 {categoria.nome}
              </span>
            )}
          </div>
        )}

        {/* Docenti */}
        {docenti.length > 0 && (
          <div className="mt-2 flex items-center gap-1.5 flex-wrap">
            <span
              className="text-[10px] px-1.5 py-0.5 bg-violet-50 text-violet-700 rounded-full font-medium"
              title={docenti.join(' · ')}
            >
              {docenti.length === 1
                ? '1 docente preparatore'
                : `${docenti.length} docenti preparatori`}
            </span>
          </div>
        )}
      </div>

      {/* Azioni */}
      <div className="flex flex-col gap-1 shrink-0">
        <button
          className="text-xs text-brand-600 hover:bg-brand-50 px-2 py-1 rounded-lg font-medium"
          onClick={onEdit}
        >
          <Pencil className="inline h-3 w-3 mr-0.5" />
          Modifica
        </button>
        {isGruppo && (
          <button
            className="text-xs text-purple-600 hover:bg-purple-50 px-2 py-1 rounded-lg font-medium"
            onClick={onManageMembers}
          >
            <Users className="inline h-3 w-3 mr-0.5" />
            Membri
          </button>
        )}
        {!isGruppo && (
          <button
            className="text-xs text-amber-600 hover:bg-amber-50 px-2 py-1 rounded-lg font-medium"
            onClick={onHistory}
          >
            <History className="inline h-3 w-3 mr-0.5" />
            Storico
          </button>
        )}
        <button
          className="text-xs text-rose-600 hover:bg-rose-50 px-2 py-1 rounded-lg font-medium"
          onClick={onDelete}
        >
          <Trash2 className="inline h-3 w-3 mr-0.5" />
          Elimina
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CandidatiTab (exported)
// ---------------------------------------------------------------------------

export function CandidatiTab({ concorsoId }: { concorsoId: string }) {
  const {
    candidati,
    sezioni,
    categorie,
    isLoading,
    isError,
    deleteMutation,
    refetch,
  } = useCandidati(concorsoId);

  // Filtri (toolbar)
  const [search, setSearch] = useState('');
  const [filterSezioneId, setFilterSezioneId] = useState('');
  const [filterCategoriaId, setFilterCategoriaId] = useState('');
  const [filterTipo, setFilterTipo] = useState('');

  const [dialog, setDialog] = useState<{ open: boolean; existing?: CandidatoFull }>({ open: false });
  const [importCsvOpen, setImportCsvOpen] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; candidato?: CandidatoFull }>({
    open: false,
  });
  const [membriModal, setMembriModal] = useState<{ open: boolean; gruppo: CandidatoFull | null }>({
    open: false,
    gruppo: null,
  });
  const [storicoModal, setStoricoModal] = useState<{ open: boolean; candidato: CandidatoFull | null }>({
    open: false,
    candidato: null,
  });

  // Membri per le card gruppo/orchestra (caricamento lazy a blocco)
  const [membriByGruppo, setMembriByGruppo] = useState<Record<string, MembroGruppo[]>>({});

  const groupIds = useMemo(
    () => candidati.filter((c) => c.tipo === 'gruppo' || c.tipo === 'orchestra').map((c) => c.id),
    [candidati],
  );
  const groupIdsKey = groupIds.join(',');

  useEffect(() => {
    if (groupIds.length === 0) {
      setMembriByGruppo({});
      return;
    }
    let alive = true;
    Promise.all(
      groupIds.map(async (id) => {
        try {
          const rows = await candidatiApi.membri(id);
          return [id, rows] as const;
        } catch {
          return [id, [] as MembroGruppo[]] as const;
        }
      }),
    ).then((entries) => {
      if (alive) setMembriByGruppo(Object.fromEntries(entries));
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupIdsKey]);

  const filteredCategorieForFilter = useMemo(
    () => (filterSezioneId ? categorie.filter((c) => c.sezioneId === filterSezioneId) : []),
    [categorie, filterSezioneId],
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return candidati.filter((c) => {
      if (filterSezioneId && c.sezioneId !== filterSezioneId) return false;
      if (filterCategoriaId && c.categoriaId !== filterCategoriaId) return false;
      if (filterTipo && c.tipo !== filterTipo) return false;
      if (q) {
        const text = [c.nome, c.cognome, c.strumento, c.email, c.nazionalita, c.gruppoNome]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });
  }, [candidati, search, filterSezioneId, filterCategoriaId, filterTipo]);

  const sezioneMap = useMemo(() => new Map(sezioni.map((s) => [s.id, s])), [sezioni]);
  const categoriaMap = useMemo(() => new Map(categorie.map((c) => [c.id, c])), [categorie]);

  const handleDelete = async () => {
    if (!deleteDialog.candidato) return;
    try {
      await deleteMutation.mutateAsync(deleteDialog.candidato.id);
      toast.success('Candidato eliminato');
      setDeleteDialog({ open: false });
    } catch (e) {
      toast.error(httpErrorMessage(e));
    }
  };

  // ── Loading / error ──────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-white border border-slate-200 rounded-2xl p-4 h-24 animate-pulse" />
        ))}
      </div>
    );
  }
  if (isError) {
    return <p className="text-sm text-rose-600">Errore nel caricamento dei candidati.</p>;
  }

  const hasFilters = !!(search || filterSezioneId || filterCategoriaId || filterTipo);

  return (
    <div className="space-y-4 view-fade">
      {/* ---- Toolbar: conteggio + import + aggiungi ---- */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <p className="text-sm text-slate-600">
          {candidati.length} candidat{candidati.length === 1 ? 'o' : 'i'}
          {filtered.length !== candidati.length &&
            ` · ${filtered.length} mostrat${filtered.length === 1 ? 'o' : 'i'}`}
        </p>
        <div className="flex items-center gap-2">
          <button
            className="c-btn c-btn--sm c-btn--outline"
            onClick={() => setImportCsvOpen(true)}
            title="Importazione massiva da CSV"
          >
            <Upload className="h-4 w-4" />
            Importa CSV
          </button>
          <button className="c-btn c-btn--sm c-btn--primary" onClick={() => setDialog({ open: true })}>
            <Plus className="h-4 w-4" />
            Aggiungi candidato
          </button>
        </div>
      </div>

      {/* ---- Filtri ---- */}
      <div className="flex flex-wrap gap-2 mb-2">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cerca per nome, strumento…"
            className="c-input pl-8 h-9 text-sm"
          />
          {search && (
            <button
              type="button"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              onClick={() => setSearch('')}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {sezioni.length > 0 && (
          <select
            value={filterSezioneId}
            onChange={(e) => {
              setFilterSezioneId(e.target.value);
              setFilterCategoriaId('');
            }}
            className="c-select h-9 text-sm w-44"
          >
            <option value="">Tutte le sezioni</option>
            {sezioni.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nome}
              </option>
            ))}
          </select>
        )}

        {filteredCategorieForFilter.length > 0 && (
          <select
            value={filterCategoriaId}
            onChange={(e) => setFilterCategoriaId(e.target.value)}
            className="c-select h-9 text-sm w-44"
          >
            <option value="">Tutte le categorie</option>
            {filteredCategorieForFilter.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        )}

        <select
          value={filterTipo}
          onChange={(e) => setFilterTipo(e.target.value)}
          className="c-select h-9 text-sm w-40"
        >
          <option value="">Tutti i tipi</option>
          <option value="individuale">Individuale</option>
          <option value="gruppo">Gruppo</option>
          <option value="orchestra">Orchestra</option>
        </select>

        {hasFilters && (
          <button
            type="button"
            className="c-btn c-btn--sm c-btn--ghost text-slate-500"
            onClick={() => {
              setSearch('');
              setFilterSezioneId('');
              setFilterCategoriaId('');
              setFilterTipo('');
            }}
          >
            <X className="h-3.5 w-3.5" />
            Reset
          </button>
        )}
      </div>

      {/* ---- Empty / lista ---- */}
      {candidati.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl py-12 text-center">
          <GraduationCap className="mx-auto h-10 w-10 text-slate-300 mb-2" />
          <p className="text-sm text-slate-500 italic">Nessun candidato — aggiungine uno.</p>
          <button className="c-btn c-btn--sm c-btn--outline mt-4" onClick={() => setDialog({ open: true })}>
            <Plus className="h-4 w-4" />
            Aggiungi il primo candidato
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl py-10 text-center">
          <Search className="mx-auto h-8 w-8 text-slate-300 mb-2" />
          <p className="text-sm text-slate-500 italic">
            Nessun candidato corrisponde ai filtri selezionati.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map((c) => (
            <CandidatoCard
              key={c.id}
              candidato={c}
              sezione={c.sezioneId ? sezioneMap.get(c.sezioneId) : undefined}
              categoria={c.categoriaId ? categoriaMap.get(c.categoriaId) : undefined}
              membri={membriByGruppo[c.id] ?? []}
              onEdit={() => setDialog({ open: true, existing: c })}
              onManageMembers={() => setMembriModal({ open: true, gruppo: c })}
              onHistory={() => setStoricoModal({ open: true, candidato: c })}
              onDelete={() => setDeleteDialog({ open: true, candidato: c })}
            />
          ))}
        </div>
      )}

      {/* ---- Form dialog ---- */}
      <CandidatoFormDialog
        open={dialog.open}
        onOpenChange={(v) => setDialog((p) => ({ ...p, open: v }))}
        concorsoId={concorsoId}
        sezioni={sezioni}
        categorie={categorie}
        existing={dialog.existing}
        onSaved={() => {
          setDialog({ open: false });
          void refetch();
        }}
      />

      {/* ---- Membri gruppo ---- */}
      <MembriGruppoModal
        open={membriModal.open}
        gruppo={membriModal.gruppo}
        onClose={() => {
          setMembriModal({ open: false, gruppo: null });
          // Ricarica le pill membri delle card
          const id = membriModal.gruppo?.id;
          if (id) {
            void candidatiApi
              .membri(id)
              .then((rows) => setMembriByGruppo((prev) => ({ ...prev, [id]: rows })))
              .catch(() => undefined);
          }
        }}
      />

      {/* ---- Storico ---- */}
      <StoricoModal
        open={storicoModal.open}
        candidato={storicoModal.candidato}
        onClose={() => setStoricoModal({ open: false, candidato: null })}
      />

      {/* ---- Delete confirm ---- */}
      <DeleteConfirmDialog
        open={deleteDialog.open}
        candidato={deleteDialog.candidato ?? null}
        onCancel={() => setDeleteDialog({ open: false })}
        onConfirm={handleDelete}
        isPending={deleteMutation.isPending}
      />

      {/* ---- Import CSV dialog ---- */}
      <ImportCsvDialog
        concorsoId={concorsoId}
        kind="candidati"
        open={importCsvOpen}
        onOpenChange={setImportCsvOpen}
        onDone={() => void refetch()}
      />
    </div>
  );
}

export default CandidatiTab;

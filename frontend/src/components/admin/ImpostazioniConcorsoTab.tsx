// =============================================================================
// ImpostazioniConcorsoTab — settings panel for a single concorso (admin)
//
// Faithful React port of js/views/admin/impostazioni-concorso.js
// Sections (matching vanilla exactly):
//   1. Logo upload (resize+preview, 5 MB guard, readImageResized 800px/0.85q)
//   2. Anagrafica (nome, anno, dataInizio, stato: ATTIVO | ARCHIVIATO)
//   3. Modalità di valutazione (anonimo toggle)
//   4. Iscrizioni pubbliche (iscrizioni_aperte toggle + iscrizioni_chiusura datetime-local)
//   5. Tiebreak default cascade — rich card rows (number badge + emoji + title + breve)
//   6. Save bar sticky bottom (Annulla modifiche + Salva impostazioni)
//   7. Statistiche (fasi / candidati / commissari counts + data inizio)
//   8. Zona pericolosa — double-confirm: window.confirm first, then type-to-confirm modal
// =============================================================================

import { useState, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Trash2, AlertTriangle, Upload, X } from 'lucide-react';

import { http, fileUrl, httpErrorMessage } from '@/lib/api';
import {
  useConcorso,
  useUpdateConcorso,
  useDeleteConcorso,
  CONCORSI_QUERY_KEY,
  concorsoQueryKey,
} from '@/api/concorsi';
import type { Concorso } from '@/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FaseCountRaw { id: string }
interface CandidatoCountRaw { id: string }
interface CommissarioCountRaw { id: string }

interface TiebreakStepField {
  key: string;
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// Tiebreak step definitions (mirrors common.js STEPS array exactly)
// ---------------------------------------------------------------------------

const TIEBREAK_STEPS_DEF: {
  key: string;
  icon: string;
  titolo: string;
  breve: string;
}[] = [
  {
    key: 'scomposizione',
    icon: '🧩',
    titolo: 'Scomposizione del voto',
    breve: 'Confronta i criteri uno per uno, in ordine di peso decrescente. Vince chi ha la media più alta sul criterio più importante che li differenzia.',
  },
  {
    key: 'presidente',
    icon: '🎯',
    titolo: 'Voto del Presidente di giuria',
    breve: 'Il voto del Presidente diventa decisivo: vince chi ha la media più alta calcolata sui soli voti del Presidente.',
  },
  {
    key: 'eta',
    icon: '🌱',
    titolo: 'Criterio anagrafico',
    breve: "Vince il candidato più giovane al momento dell'esibizione. Per i gruppi si usa la media delle date di nascita dei membri.",
  },
  {
    key: 'ex_aequo',
    icon: '🤝',
    titolo: 'Ex aequo (extrema ratio)',
    breve: 'Se nessuna regola precedente risolve la parità, viene dichiarato ex aequo: stessa posizione ai candidati, la posizione successiva non viene assegnata; il premio si divide in parti uguali.',
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert ISO datetime string → datetime-local input value (local time). */
function isoToLocalDatetime(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return '';
  }
}

/** Resize an image file to maxPx on its longest side, return dataURL. */
function readImageResized(file: File, maxPx: number, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const ratio = Math.min(1, maxPx / Math.max(img.width, img.height));
      const w = Math.round(img.width * ratio);
      const h = Math.round(img.height * ratio);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('canvas context')); return; }
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL(file.type === 'image/svg+xml' ? 'image/png' : file.type, quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('load')); };
    img.src = url;
  });
}

/** Build tiebreak step list from saved strategy (or all-enabled defaults). */
function buildStepsFromStrategy(strategy: unknown): TiebreakStepField[] {
  const saved: TiebreakStepField[] = Array.isArray(strategy) ? strategy : [];
  const savedMap = new Map(saved.map((s) => [s.key, s.enabled]));
  return TIEBREAK_STEPS_DEF.map((def) => ({
    key: def.key,
    enabled: savedMap.has(def.key) ? (savedMap.get(def.key) ?? true) : true,
  }));
}

// ---------------------------------------------------------------------------
// Form state type (uncontrolled-style, mirroring vanilla's direct DOM reads)
// ---------------------------------------------------------------------------

interface FormState {
  nome: string;
  anno: string;
  dataInizio: string;
  stato: 'ATTIVO' | 'ARCHIVIATO';
  anonimo: boolean;
  iscrizioniAperte: boolean;
  iscrizioniChiusura: string; // datetime-local value
  tiebreakSteps: TiebreakStepField[];
  tbTouched: boolean;
}

function concorsoToFormState(c: Concorso): FormState {
  return {
    nome: c.nome ?? '',
    anno: c.anno != null ? String(c.anno) : '',
    dataInizio: c.dataInizio ?? '',
    stato: (c.stato === 'ATTIVO' ? 'ATTIVO' : 'ARCHIVIATO'),
    anonimo: c.anonimo ?? false,
    iscrizioniAperte: c.iscrizioniAperte ?? false,
    iscrizioniChiusura: isoToLocalDatetime(c.iscrizioniChiusura),
    tiebreakSteps: buildStepsFromStrategy(c.defaultTiebreakStrategy),
    // tbTouched: pre-touch if there's a saved strategy (mirrors vanilla's startTouched)
    tbTouched: Array.isArray(c.defaultTiebreakStrategy) && c.defaultTiebreakStrategy.length > 0,
  };
}

// ---------------------------------------------------------------------------
// Stats mini-query
// ---------------------------------------------------------------------------

function useStats(concorsoId: string) {
  const fasi = useQuery({
    queryKey: ['fasi', concorsoId, 'count'],
    queryFn: () => http.get<FaseCountRaw[]>('fasi', { concorsoId, limit: 1000 }),
    enabled: !!concorsoId,
    staleTime: 60_000,
  });
  const candidati = useQuery({
    queryKey: ['candidati', concorsoId, 'count'],
    queryFn: () => http.get<CandidatoCountRaw[]>('candidati', { concorsoId, limit: 1000 }),
    enabled: !!concorsoId,
    staleTime: 60_000,
  });
  const commissari = useQuery({
    queryKey: ['commissari', concorsoId, 'count'],
    queryFn: () => http.get<CommissarioCountRaw[]>('commissari', { concorsoId, limit: 1000 }),
    enabled: !!concorsoId,
    staleTime: 60_000,
  });

  return {
    nFasi: fasi.data?.length ?? 0,
    nCandidati: candidati.data?.length ?? 0,
    nCommissari: commissari.data?.length ?? 0,
  };
}

// ---------------------------------------------------------------------------
// TiebreakEditor — rich card rows (mirrors tiebreakStrategyHtml in common.js)
// ---------------------------------------------------------------------------

interface TiebreakEditorProps {
  steps: TiebreakStepField[];
  onChange: (steps: TiebreakStepField[]) => void;
}

function TiebreakEditor({ steps, onChange }: TiebreakEditorProps) {
  const toggle = useCallback(
    (key: string) => {
      onChange(steps.map((s) => (s.key === key ? { ...s, enabled: !s.enabled } : s)));
    },
    [steps, onChange],
  );

  return (
    <div className="space-y-2">
      {steps.map((step, i) => {
        const def = TIEBREAK_STEPS_DEF.find((d) => d.key === step.key);
        if (!def) return null;
        return (
          <label
            key={step.key}
            className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 hover:border-brand-200 transition cursor-pointer"
          >
            <input
              type="checkbox"
              className="mt-1 w-4 h-4"
              checked={step.enabled}
              onChange={() => toggle(step.key)}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="w-6 h-6 rounded-full bg-brand-100 text-brand-700 text-[11px] font-bold inline-flex items-center justify-center">
                  {i + 1}
                </span>
                <span className="text-base" aria-hidden="true">{def.icon}</span>
                <span className="font-semibold text-sm text-slate-900">{def.titolo}</span>
              </div>
              <p className="text-[12px] text-slate-600 mt-1 leading-relaxed">{def.breve}</p>
            </div>
          </label>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DeleteConfirmModal — type-to-confirm (second step of the double-confirm flow)
// Mirrors openDeleteConfirmModal() in vanilla.
// ---------------------------------------------------------------------------

interface DeleteConfirmModalProps {
  concorso: Concorso;
  nFasi: number;
  nCandidati: number;
  nCommissari: number;
  onClose: () => void;
  onDeleted: () => void;
}

function DeleteConfirmModal({
  concorso,
  nFasi,
  nCandidati,
  nCommissari,
  onClose,
  onDeleted,
}: DeleteConfirmModalProps) {
  const [confirmText, setConfirmText] = useState('');
  const deleteMutation = useDeleteConcorso();
  const match = confirmText.trim() === concorso.nome.trim();

  const handleDelete = async () => {
    if (!match) {
      toast.error('Il nome inserito non corrisponde. Operazione annullata.');
      return;
    }
    try {
      await deleteMutation.mutateAsync({ id: concorso.id, force: true });
      toast.success('Concorso eliminato');
      onDeleted();
    } catch (err) {
      toast.error(httpErrorMessage(err));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4" data-modal>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-rose-900 flex items-center gap-2">
            <AlertTriangle size={18} className="text-rose-600" />
            ⚠ Conferma eliminazione definitiva
          </h2>
          <button type="button" onClick={onClose} className="text-ink-500 hover:text-ink-900">
            <X size={18} />
          </button>
        </div>

        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 text-sm text-rose-900">
          <p className="font-semibold mb-2">
            Stai per cancellare <strong>{concorso.nome}</strong> dal database.
          </p>
          <ul className="text-xs space-y-1 list-disc pl-5">
            <li>{nCandidati} candidati e tutte le loro valutazioni</li>
            <li>{nFasi} fasi con criteri e risultati</li>
            <li>{nCommissari} commissari assegnati a questo concorso</li>
            <li>tutte le iscrizioni pubbliche ricevute (incluse pending)</li>
          </ul>
          <p className="text-xs mt-3">
            <strong>L&apos;operazione non è annullabile.</strong> Esegui un backup prima di
            procedere se hai dubbi.
          </p>
        </div>

        <label className="block">
          <span className="text-sm font-medium text-ink-800">
            Per confermare, digita il nome esatto del concorso:
          </span>
          <p className="font-mono text-sm bg-slate-100 border border-slate-200 rounded px-2 py-1 mt-1 mb-2 select-all">
            {concorso.nome}
          </p>
          <input
            autoFocus
            type="text"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-rose-500 focus:border-rose-500"
            placeholder="Scrivi qui il nome..."
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
          />
        </label>

        <div className="flex justify-end gap-3">
          <button type="button" className="c-btn c-btn--outline c-btn--sm" onClick={onClose}>
            Annulla
          </button>
          <button
            type="button"
            disabled={!match || deleteMutation.isPending}
            className={[
              'c-btn c-btn--sm',
              match
                ? 'bg-rose-600 hover:bg-rose-700 text-white border-rose-600'
                : 'opacity-50 cursor-not-allowed bg-rose-300 text-white border-rose-300',
            ].join(' ')}
            onClick={handleDelete}
          >
            {deleteMutation.isPending ? 'Eliminazione…' : 'Elimina definitivamente'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function ImpostazioniConcorsoTab({ concorsoId }: { concorsoId: string }) {
  const qc = useQueryClient();

  // ── Remote data ──────────────────────────────────────────────────────────────
  const { data: concorso, isLoading, isError } = useConcorso(concorsoId);
  const updateMutation = useUpdateConcorso();

  // ── Stats (read-only) ────────────────────────────────────────────────────────
  const { nFasi, nCandidati, nCommissari } = useStats(concorsoId);

  // ── Form state ───────────────────────────────────────────────────────────────
  // We use plain React state (not RHF) to exactly mirror vanilla's uncontrolled
  // form + manual DOM reads on submit.
  const [form, setForm] = useState<FormState | null>(null);
  const [seeded, setSeeded] = useState(false);

  // Seed once when concorso loads (mirrors vanilla's initial render)
  if (concorso && !seeded) {
    setForm(concorsoToFormState(concorso));
    setSeeded(true);
  }

  // ── Logo local state ─────────────────────────────────────────────────────────
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [pendingLogo, setPendingLogo] = useState<{ dataURL: string; name: string } | null>(null);

  // ── Delete confirm state ─────────────────────────────────────────────────────
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // ── Submitting guard ─────────────────────────────────────────────────────────
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ── Logo change (preview live, mirrors vanilla's logoInput change handler) ───
  const handleLogoChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Il logo supera i 5 MB');
      if (logoInputRef.current) logoInputRef.current.value = '';
      return;
    }
    try {
      const dataURL = await readImageResized(file, 800, 0.85);
      setPendingLogo({ dataURL, name: file.name });
    } catch {
      toast.error('Errore caricamento logo');
    }
  }, []);

  // ── Reset handler (mirrors vanilla: re-seed from server state) ───────────────
  const handleReset = useCallback(() => {
    if (!concorso) return;
    setForm(concorsoToFormState(concorso));
    setPendingLogo(null);
    if (logoInputRef.current) logoInputRef.current.value = '';
  }, [concorso]);

  // ── Submit ───────────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!form || !concorso) return;

      const nome = form.nome.trim();
      if (!nome) {
        toast.error('Il nome è obbligatorio');
        return;
      }

      const patch: Record<string, unknown> = {
        nome,
        anno: Number(form.anno),
        dataInizio: form.dataInizio || null,
        stato: form.stato,
        anonimo: form.anonimo,
        iscrizioniAperte: form.iscrizioniAperte,
        // N45: column is date-only — send date portion to avoid TZ drift near midnight
        iscrizioniScadenza: form.iscrizioniChiusura ? form.iscrizioniChiusura.slice(0, 10) : '',
      };

      // tbTouched: only send defaultTiebreakStrategy if admin actually touched the toggles
      if (form.tbTouched) {
        patch.defaultTiebreakStrategy = form.tiebreakSteps;
      }

      if (pendingLogo) {
        patch.logo = pendingLogo.dataURL;
      }

      setIsSubmitting(true);
      try {
        await updateMutation.mutateAsync({ id: concorsoId, body: patch });
        // Invalidate list + detail (mirrors vanilla's db.updateConcorso side-effect)
        void qc.invalidateQueries({ queryKey: CONCORSI_QUERY_KEY });
        void qc.invalidateQueries({ queryKey: concorsoQueryKey(concorsoId) });
        setPendingLogo(null);
        if (logoInputRef.current) logoInputRef.current.value = '';
        toast.success('Concorso aggiornato');
        // Re-seed form with updated concorso on next render
        setSeeded(false);
      } catch (err) {
        toast.error(httpErrorMessage(err));
      } finally {
        setIsSubmitting(false);
      }
    },
    [form, concorso, concorsoId, pendingLogo, updateMutation, qc],
  );

  // ── Delete button — double-confirm: window.confirm first, then modal ─────────
  // Mirrors vanilla: confirmDialog (yes/no) → openDeleteConfirmModal (type-to-confirm)
  const handleDeleteClick = useCallback(() => {
    if (!concorso || !form) return;
    const ok = window.confirm(
      `Stai per eliminare "${concorso.nome}". Verranno rimossi anche ${nCandidati} candidati, ${nFasi} fasi e ${nCommissari} commissari. Operazione irreversibile.`,
    );
    if (ok) {
      setShowDeleteConfirm(true);
    }
  }, [concorso, form, nCandidati, nFasi, nCommissari]);

  // ── Field update helpers ──────────────────────────────────────────────────────
  const set = useCallback(
    <K extends keyof FormState>(key: K, value: FormState[K]) => {
      setForm((prev) => prev ? { ...prev, [key]: value } : prev);
    },
    [],
  );

  // ── Render states ─────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="max-w-3xl space-y-6 animate-pulse">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-white border border-slate-200 rounded-2xl p-5 h-28" />
        ))}
      </div>
    );
  }

  if (isError || !concorso || !form) {
    return (
      <div className="max-w-3xl">
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-5 text-sm text-rose-900">
          Impossibile caricare le impostazioni del concorso.
        </div>
      </div>
    );
  }

  const logoPreviewSrc = pendingLogo?.dataURL ?? (concorso.logoUrl ? fileUrl(concorso.logoUrl) : null);

  return (
    <div className="max-w-3xl space-y-6" data-impostazioni-concorso>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header>
        <h3 className="text-base font-semibold text-ink-900">Impostazioni del concorso</h3>
        <p className="text-sm text-ink-700 mt-1">
          Modifica anagrafica, branding e gestione del concorso selezionato. Le modifiche vengono
          salvate cliccando &ldquo;Salva&rdquo; in fondo alla pagina.
        </p>
      </header>

      <form onSubmit={handleSubmit} noValidate className="space-y-6">

        {/* ── 1. Logo ─────────────────────────────────────────────────────── */}
        <section className="bg-white border border-slate-200 rounded-2xl p-5">
          <p className="text-[11px] uppercase tracking-wide font-semibold text-ink-500 mb-3">
            Logo del concorso
          </p>
          <div className="flex items-start gap-4">
            {/* Logo preview frame */}
            <div className="w-24 h-24 rounded-xl bg-slate-50 border border-brand-100 flex items-center justify-center overflow-hidden shrink-0">
              {logoPreviewSrc ? (
                <img src={logoPreviewSrc} alt="" className="w-full h-full object-contain" />
              ) : (
                <span className="text-slate-400">
                  <Upload size={28} />
                </span>
              )}
            </div>
            {/* Upload button (label wrapping file input, no icon — matches vanilla) */}
            <div className="flex-1 min-w-0">
              <label className="c-btn c-btn--outline c-btn--sm cursor-pointer inline-flex">
                <span>{logoPreviewSrc ? 'Sostituisci logo' : 'Scegli logo'}</span>
                <input
                  ref={logoInputRef}
                  name="logo"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  className="hidden"
                  onChange={handleLogoChange}
                />
              </label>
              <p className="text-xs text-ink-700 mt-2">
                Sostituisce il logo applicativo nelle stampe PDF (verbali, protocollo) e
                nell&apos;header dell&apos;app. PNG, JPG, WebP o SVG. Max 5 MB.
              </p>
            </div>
          </div>
        </section>

        {/* ── 2. Anagrafica ──────────────────────────────────────────────── */}
        <section className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
          <p className="text-[11px] uppercase tracking-wide font-semibold text-ink-500">
            Anagrafica
          </p>

          <label className="c-field">
            <span className="c-field__label">Nome del concorso</span>
            <input
              name="nome"
              type="text"
              required
              className="c-input"
              value={form.nome}
              placeholder="Es: Concorso Nazionale 2026"
              onChange={(e) => set('nome', e.target.value)}
            />
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <label className="c-field">
              <span className="c-field__label">Anno</span>
              <input
                name="anno"
                type="number"
                min={2000}
                max={2100}
                required
                className="c-input"
                value={form.anno}
                onChange={(e) => set('anno', e.target.value)}
              />
            </label>

            <label className="c-field">
              <span className="c-field__label">Data inizio</span>
              <input
                name="data_inizio"
                type="date"
                className="c-input"
                value={form.dataInizio}
                onChange={(e) => set('dataInizio', e.target.value)}
              />
            </label>

            <label className="c-field">
              <span className="c-field__label">Stato</span>
              <select
                name="stato"
                className="c-input"
                value={form.stato}
                onChange={(e) => set('stato', e.target.value as 'ATTIVO' | 'ARCHIVIATO')}
              >
                <option value="ATTIVO">ATTIVO</option>
                <option value="ARCHIVIATO">ARCHIVIATO</option>
              </select>
            </label>
          </div>
        </section>

        {/* ── 3. Modalità di valutazione ─────────────────────────────────── */}
        <section className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
          <p className="text-[11px] uppercase tracking-wide font-semibold text-ink-500">
            Modalità di valutazione
          </p>
          <label className="flex items-start gap-2 text-sm text-ink-700">
            <input
              name="anonimo"
              type="checkbox"
              className="rounded border-slate-300 mt-0.5"
              checked={form.anonimo}
              onChange={(e) => set('anonimo', e.target.checked)}
            />
            <span>
              <span className="font-medium text-ink-900">Modalità anonima</span>
              <br />
              <span className="text-xs text-slate-500">
                Nasconde i nomi dei candidati ai commissari: durante la votazione vedono solo il
                numero progressivo. Utile per concorsi che richiedono valutazione cieca.
              </span>
            </span>
          </label>
        </section>

        {/* ── 4. Iscrizioni pubbliche ─────────────────────────────────────── */}
        <section className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
          <p className="text-[11px] uppercase tracking-wide font-semibold text-ink-500">
            Iscrizioni pubbliche
          </p>
          <p className="text-xs text-slate-500 leading-snug">
            Quando aperte, il form auto-service all&apos;indirizzo{' '}
            <code className="bg-slate-100 px-1 rounded">/#/iscrizione</code> accetta nuove
            iscrizioni. Lasciale chiuse per concorsi non ancora pubblicizzati o già pieni.
          </p>
          <label className="flex items-center gap-2 text-sm text-ink-700">
            <input
              name="iscrizioni_aperte"
              type="checkbox"
              className="rounded border-slate-300"
              checked={form.iscrizioniAperte}
              onChange={(e) => set('iscrizioniAperte', e.target.checked)}
            />
            <span>Accetta iscrizioni dal frontend pubblico</span>
          </label>
          <label className="c-field">
            <span className="c-field__label">
              Data/ora di chiusura iscrizioni{' '}
              <span className="text-slate-400">(opzionale)</span>
            </span>
            <input
              name="iscrizioni_chiusura"
              type="datetime-local"
              className="c-input"
              value={form.iscrizioniChiusura}
              onChange={(e) => set('iscrizioniChiusura', e.target.value)}
            />
            <span className="text-[11px] text-slate-500 mt-1 block">
              Oltre questa data il form pubblico chiude le iscrizioni automaticamente. Lascia
              vuoto per nessun limite temporale.
            </span>
          </label>
        </section>

        {/* ── 5. Tiebreak default ─────────────────────────────────────────── */}
        <section className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
          <p className="text-[11px] uppercase tracking-wide font-semibold text-ink-500">
            Regole in caso di ex aequo (default)
          </p>
          <p className="text-xs text-slate-500 leading-snug">
            Cascata di default applicata a ogni fase del concorso. Ogni fase può comunque
            sovrascrivere questa policy nelle proprie impostazioni.
          </p>
          <TiebreakEditor
            steps={form.tiebreakSteps}
            onChange={(steps) => {
              // tbTouched: mark on first interaction (mirrors vanilla's change listener)
              setForm((prev) => prev ? { ...prev, tiebreakSteps: steps, tbTouched: true } : prev);
            }}
          />
        </section>

        {/* ── 6. Save bar (sticky bottom) ─────────────────────────────────── */}
        <div className="flex justify-end gap-3 sticky bottom-0 bg-gradient-to-t from-white via-white pt-3 -mt-1 pb-2">
          <button
            type="button"
            data-action="reset"
            className="c-btn c-btn--outline c-btn--sm"
            onClick={handleReset}
            disabled={isSubmitting}
          >
            Annulla modifiche
          </button>
          <button
            type="submit"
            className="c-btn c-btn--primary"
            disabled={isSubmitting}
          >
            <Check size={16} />
            <span>{isSubmitting ? 'Salvataggio…' : 'Salva impostazioni'}</span>
          </button>
        </div>
      </form>

      {/* ── 7. Statistiche ──────────────────────────────────────────────────── */}
      <section className="bg-white border border-slate-200 rounded-2xl p-5">
        <p className="text-[11px] uppercase tracking-wide font-semibold text-ink-500 mb-3">
          Statistiche
        </p>
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div className="text-center bg-slate-50 border border-slate-200 rounded-lg px-3 py-3">
            <div className="text-2xl font-bold text-ink-900">{nFasi}</div>
            <div className="text-[11px] text-ink-700 uppercase tracking-wide mt-1">Fasi</div>
          </div>
          <div className="text-center bg-slate-50 border border-slate-200 rounded-lg px-3 py-3">
            <div className="text-2xl font-bold text-ink-900">{nCandidati}</div>
            <div className="text-[11px] text-ink-700 uppercase tracking-wide mt-1">Candidati</div>
          </div>
          <div className="text-center bg-slate-50 border border-slate-200 rounded-lg px-3 py-3">
            <div className="text-2xl font-bold text-ink-900">{nCommissari}</div>
            <div className="text-[11px] text-ink-700 uppercase tracking-wide mt-1">Commissari</div>
          </div>
        </div>
        {concorso.dataInizio && (
          <p className="text-xs text-ink-700 mt-3">
            Data inizio prevista:{' '}
            <span className="font-medium text-ink-900">
              {new Date(concorso.dataInizio).toLocaleDateString('it-IT', {
                day: '2-digit',
                month: 'long',
                year: 'numeric',
              })}
            </span>
          </p>
        )}
      </section>

      {/* ── 8. Zona pericolosa ──────────────────────────────────────────────── */}
      <section className="bg-rose-50 border border-rose-200 rounded-2xl p-5">
        <div className="flex items-start gap-3">
          <span className="text-rose-700 shrink-0">
            <AlertTriangle size={20} />
          </span>
          <div className="flex-1">
            <h4 className="text-sm font-semibold text-rose-900">Zona pericolosa</h4>
            <p className="text-sm text-rose-800 mt-1">
              Eliminare il concorso rimuove anche tutti i dati associati (fasi, candidati,
              valutazioni). Operazione irreversibile.
            </p>
            <button
              type="button"
              data-action="delete"
              className="c-btn c-btn--sm mt-3 bg-rose-600 hover:bg-rose-700 text-white !border-rose-600"
              onClick={handleDeleteClick}
            >
              <Trash2 size={14} />
              <span>Elimina concorso</span>
            </button>
          </div>
        </div>
      </section>

      {/* ── Delete confirm overlay (type-to-confirm, second step) ───────────── */}
      {showDeleteConfirm && (
        <DeleteConfirmModal
          concorso={concorso}
          nFasi={nFasi}
          nCandidati={nCandidati}
          nCommissari={nCommissari}
          onClose={() => setShowDeleteConfirm(false)}
          onDeleted={() => {
            setShowDeleteConfirm(false);
            // Navigate away: dispatch a hashchange like the vanilla app does
            window.dispatchEvent(new HashChangeEvent('hashchange'));
          }}
        />
      )}
    </div>
  );
}

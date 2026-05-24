// =============================================================================
// CommissariTab — gestione commissari (admin)
//
// Faithful rebuild of the vanilla source js/views/admin/commissari.js.
// Every feature of the vanilla view is reproduced 1:1 against the available
// React/server data model:
//
//   - Header: titolo + bottone "Aggiungi commissario"
//   - Summary line ("{n} commissari assegnati · presidente: …" / nessun presidente)
//   - Warning banner quando ci sono commissari ma nessun presidente
//   - Empty state (dashed border, 🧑‍⚖️)
//   - ATTIVI grid (1/2/3 col) con card commissario:
//       avatar foto/🧑‍⚖️, ring presidente, badge PRESIDENTE, nazionalità,
//       specialità · età, email ✉, telefono ☎, pill CV (apre modale), pill bio,
//       azioni Modifica / Rimuovi (archivia) / Elimina
//   - Sezione ARCHIVIO (commissari archiviati/INATTIVI) con toolbar:
//       ricerca, filtro specialità, filtro nazionalità, ordinamento, clear,
//       card archivio (foto/specialità/età/nazionalità/email/telefono/bio/CV),
//       bottone "Aggiungi a questo concorso" (riattiva)
//   - CV view modal (sola lettura, testo pre-wrap, font-mono)
//   - Create/Edit modal con TUTTI i campi: nome, cognome, specialità,
//       data nascita, nazionalità (datalist), email, telefono, foto (upload +
//       resize + preview + rimuovi), CV (testo, toggle editor + visualizza +
//       rimuovi + contatore caratteri), biografia, nota presidente,
//       sezione credenziali (crea account / gestisci account esistente)
//   - Modale credenziali one-time (email/password copiabili)
//   - Conferme archivia / elimina (multi-concorso non applicabile: modello
//       single-concorso lato server)
//
// Data wiring dalle hook '@/api/commissari' è interamente preservato; per le
// credenziali si usa '@/api/accounts'; il presidente è risolto da
// '@/api/commissioni' (presidenteCommissarioId).
// =============================================================================

import { useState, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { fileUrl, httpErrorMessage } from '@/lib/api';
import { accountsApi, type AccountCreate, type AccountUpdate } from '@/api/accounts';
import type { Account } from '@/types';
import {
  useCommissari,
  useCreateCommissario,
  useUpdateCommissario,
  useDeleteCommissario,
  useUploadCommissarioFoto,
  commissariApi,
  type CommissarioRecord,
} from '@/api/commissari';
import { useCommissioni } from '@/api/commissioni';
import { isPresidenteDiQualcheCommissione } from '@/lib/presidenti';

// ---------------------------------------------------------------------------
// Helpers (port di displayName / ageFromDate da js/utils.js)
// ---------------------------------------------------------------------------
function displayName(c: { nome?: string | null; cognome?: string | null } | null | undefined): string {
  if (!c) return '—';
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

// Elenco nazionalità (port di NATIONALITIES da js/utils.js).
const NATIONALITIES = [
  'Italiana', 'Albanese', 'Argentina', 'Australiana', 'Austriaca', 'Belga', 'Brasiliana',
  'Britannica', 'Bulgara', 'Canadese', 'Cinese', 'Coreana', 'Croata', 'Danese', 'Estone',
  'Finlandese', 'Francese', 'Giapponese', 'Greca', 'Indiana', 'Iraniana', 'Irlandese',
  'Israeliana', 'Lettone', 'Lituana', 'Maltese', 'Messicana', 'Moldava', 'Norvegese',
  'Olandese', 'Polacca', 'Portoghese', 'Rumena', 'Russa', 'Serba', 'Slovacca', 'Slovena',
  'Spagnola', 'Statunitense', 'Svedese', 'Svizzera', 'Tedesca', 'Turca', 'Ucraina', 'Ungherese',
];

// Genera una password robusta (port di generatePassword da commissari.js).
function generatePassword(length = 12): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ23456789';
  const arr = new Uint32Array(length);
  crypto.getRandomValues(arr);
  let out = '';
  for (let i = 0; i < length; i++) out += chars[arr[i] % chars.length];
  return out;
}

// Ridimensiona un'immagine via canvas e restituisce un Blob (port di
// readImageResized — il vanilla produceva un dataURL; qui serve un Blob per
// l'upload multipart). Preserva la trasparenza per PNG/WebP.
function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

async function readImageResizedBlob(file: File, maxDim = 480, quality = 0.85): Promise<{ blob: Blob; dataURL: string }> {
  const dataURL = await readFileAsDataURL(file);
  const inputMime = (file?.type || '').toLowerCase();
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
        reject(new Error('canvas context unavailable'));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('toBlob failed'));
            return;
          }
          resolve({ blob, dataURL: canvas.toDataURL(outputMime, quality) });
        },
        outputMime,
        quality,
      );
    };
    img.onerror = reject;
    img.src = dataURL;
  });
}

// ---------------------------------------------------------------------------
// Account hooks (sopra accountsApi, che non espone hook dedicati)
// ---------------------------------------------------------------------------
function useAccounts() {
  return useQuery({
    queryKey: ['accounts'],
    queryFn: () => accountsApi.list({ limit: 500 }),
  });
}

// ---------------------------------------------------------------------------
// Vanilla-style modal (mirror di utils.modal: overlay fisso, pannello, footer)
// ---------------------------------------------------------------------------
function VanillaModal({
  title,
  onClose,
  width = 'max-w-3xl',
  children,
  footer,
}: {
  title: React.ReactNode;
  onClose: () => void;
  width?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`bg-white rounded-2xl shadow-xl w-full ${width} max-h-[90vh] flex flex-col`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
          <h3 className="text-base font-bold text-slate-900">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 text-xl leading-none px-1"
            aria-label="Chiudi"
          >
            ✕
          </button>
        </div>
        <div className="px-5 py-4 overflow-y-auto flex-1">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-200 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CvTextModal — visualizza il CV in sola lettura (port di openCvText)
// ---------------------------------------------------------------------------
function CvTextModal({ text, onClose }: { text: string; onClose: () => void }) {
  return (
    <VanillaModal
      title="Curriculum del commissario"
      width="max-w-3xl"
      onClose={onClose}
      footer={
        <button type="button" className="text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 px-3.5 py-2 rounded-lg" onClick={onClose}>
          Chiudi
        </button>
      }
    >
      <div className="whitespace-pre-wrap break-words text-sm text-slate-800 leading-relaxed max-h-[60vh] overflow-y-auto font-mono">
        {text || ''}
      </div>
    </VanillaModal>
  );
}

// ---------------------------------------------------------------------------
// CredentialsModal — mostra email/password una sola volta (port di
// showCredentialsModal)
// ---------------------------------------------------------------------------
function CredentialsModal({
  email,
  password,
  title,
  subject,
  onClose,
}: {
  email: string;
  password: string;
  title: string;
  subject?: string;
  onClose: () => void;
}) {
  const [copiedEmail, setCopiedEmail] = useState(false);
  const [copiedPwd, setCopiedPwd] = useState(false);

  const copy = async (what: 'email' | 'password') => {
    const value = what === 'email' ? email : password;
    try {
      await navigator.clipboard.writeText(value);
      if (what === 'email') {
        setCopiedEmail(true);
        setTimeout(() => setCopiedEmail(false), 1500);
      } else {
        setCopiedPwd(true);
        setTimeout(() => setCopiedPwd(false), 1500);
      }
    } catch {
      toast.warning('Copia non riuscita — seleziona manualmente');
    }
  };

  return (
    <VanillaModal
      title={title}
      width="max-w-lg"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 px-3.5 py-2 rounded-lg" onClick={onClose}>
            Chiudi
          </button>
          <button type="button" className="text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 px-3.5 py-2 rounded-lg shadow-sm" onClick={onClose}>
            Ho copiato
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {subject && (
          <p className="text-sm">
            Trasmetti queste credenziali a <strong>{subject}</strong>.
          </p>
        )}
        <div className="bg-slate-900 text-emerald-300 rounded-xl p-4 font-mono text-sm space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-slate-400 shrink-0">email</span>
            <span className="flex-1 truncate select-all">{email}</span>
            <button
              type="button"
              className="text-[10px] bg-slate-800 hover:bg-slate-700 px-2 py-1 rounded text-emerald-300"
              onClick={() => copy('email')}
            >
              {copiedEmail ? '✓ Copiato' : 'Copia'}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-400 shrink-0">pwd&nbsp;&nbsp;</span>
            <span className="flex-1 truncate select-all">{password}</span>
            <button
              type="button"
              className="text-[10px] bg-slate-800 hover:bg-slate-700 px-2 py-1 rounded text-emerald-300"
              onClick={() => copy('password')}
            >
              {copiedPwd ? '✓ Copiato' : 'Copia'}
            </button>
          </div>
        </div>
        <div className="bg-amber-50 border border-amber-200 text-amber-900 text-xs rounded-lg px-3 py-2">
          ⚠ <strong>Salva la password ora.</strong> Non sarà più visualizzata: per perderla serve un reset.
        </div>
      </div>
    </VanillaModal>
  );
}

// ---------------------------------------------------------------------------
// CommissarioFormDialog — create / edit (port di openCommissarioForm)
// ---------------------------------------------------------------------------
interface FormDialogProps {
  concorsoId: string;
  existing: CommissarioRecord | null;
  onClose: () => void;
}

function CommissarioFormDialog({ concorsoId, existing, onClose }: FormDialogProps) {
  const isEdit = !!existing;
  const createCommissario = useCreateCommissario(concorsoId);
  const updateCommissario = useUpdateCommissario(concorsoId);
  const uploadFoto = useUploadCommissarioFoto(concorsoId);
  const qc = useQueryClient();

  const accountsQuery = useAccounts();
  const linkedAccount: Account | null = useMemo(() => {
    if (!isEdit || !existing) return null;
    return accountsQuery.data?.find((a) => a.commissarioId === existing.id) ?? null;
  }, [accountsQuery.data, existing, isEdit]);

  // ----- Split nome/cognome (port: se manca cognome ma nome contiene spazi) -----
  let initNome = existing?.nome || '';
  let initCognome = existing?.cognome || '';
  if (existing && !initCognome && initNome.includes(' ')) {
    const parts = initNome.split(/\s+/);
    initNome = parts[0];
    initCognome = parts.slice(1).join(' ');
  }

  const todayISO = new Date().toISOString().slice(0, 10);
  const initialFoto = existing?.foto ? fileUrl(existing.foto) : null;
  const initialCv = existing?.cv || '';

  // ----- Controlled form state (mirror del vanilla che usa formFields()) -----
  const [nome, setNome] = useState(initNome);
  const [cognome, setCognome] = useState(initCognome);
  const [specialita, setSpecialita] = useState(existing?.specialita || '');
  const [dataNascita, setDataNascita] = useState(existing?.dataNascita || '');
  const [nazionalita, setNazionalita] = useState(existing?.nazionalita || '');
  const [email, setEmail] = useState(existing?.email || '');
  const [telefono, setTelefono] = useState(existing?.telefono || '');
  const [bio, setBio] = useState(existing?.bio || '');

  // Foto: preview (dataURL nuovo o URL esistente), blob da uploadare, flag rimozione.
  const [fotoPreview, setFotoPreview] = useState<string | null>(initialFoto);
  const [fotoBlob, setFotoBlob] = useState<Blob | null>(null);
  const [fotoRemoved, setFotoRemoved] = useState(false);
  const fotoInputRef = useRef<HTMLInputElement>(null);

  // CV come testo (plain/markdown). cvData è la sorgente di verità.
  const [cvData, setCvData] = useState(initialCv);
  const [cvEditing, setCvEditing] = useState(false);
  const [cvViewOpen, setCvViewOpen] = useState(false);

  // ----- Credenziali (create flow) -----
  const [accToggle, setAccToggle] = useState(false);
  const [accEmail, setAccEmail] = useState(existing?.email || '');
  const [accPassword, setAccPassword] = useState('');

  // Modale credenziali one-time.
  const [cred, setCred] = useState<{ email: string; password: string; title: string; subject?: string } | null>(null);

  const [submitting, setSubmitting] = useState(false);

  const inputCls =
    'mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500';

  // ----- Foto handlers -----
  const onFotoPick = () => fotoInputRef.current?.click();
  const onFotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { blob, dataURL } = await readImageResizedBlob(file, 480, 0.85);
      setFotoBlob(blob);
      setFotoPreview(dataURL);
      setFotoRemoved(false);
    } catch {
      toast.error('Errore caricamento foto');
    }
  };
  const onFotoClear = () => {
    setFotoBlob(null);
    setFotoPreview(null);
    setFotoRemoved(true);
  };

  const hasFoto = !!fotoPreview;

  // ----- Account existing-account actions -----
  const refreshAccounts = () => qc.invalidateQueries({ queryKey: ['accounts'] });

  const onAccReset = async () => {
    if (!linkedAccount) return;
    const newPwd = generatePassword(12);
    try {
      await accountsApi.resetPassword(linkedAccount.id, newPwd);
      setCred({
        email: linkedAccount.email,
        password: newPwd,
        title: 'Nuova password generata',
        subject: '',
      });
    } catch (e) {
      toast.error(`Errore reset: ${httpErrorMessage(e)}`);
    }
  };

  const onAccToggle = async () => {
    if (!linkedAccount) return;
    try {
      const patch: AccountUpdate = { attivo: !linkedAccount.attivo };
      await accountsApi.update(linkedAccount.id, patch);
      toast.success(linkedAccount.attivo ? 'Account disabilitato' : 'Account riattivato');
      refreshAccounts();
    } catch (e) {
      toast.error(`Errore: ${httpErrorMessage(e)}`);
    }
  };

  const onAccDelete = async () => {
    if (!linkedAccount) return;
    if (
      !confirm(
        "Eliminare definitivamente l'account di accesso? Il commissario non potrà più entrare. Il record commissario resta.",
      )
    )
      return;
    try {
      await accountsApi.remove(linkedAccount.id);
      toast.success('Account eliminato');
      refreshAccounts();
    } catch (e) {
      toast.error(`Errore: ${httpErrorMessage(e)}`);
    }
  };

  // ----- Submit (port di onPrimary) -----
  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const baseFields = {
      nome: nome.trim(),
      cognome: cognome.trim(),
      specialita: specialita.trim(),
      email: email.trim(),
      telefono: telefono.trim(),
      dataNascita: dataNascita || null,
      nazionalita: nazionalita.trim(),
      bio: bio.trim(),
    };
    if (!baseFields.nome || !baseFields.cognome || !baseFields.specialita) {
      toast.error('Compila tutti i campi obbligatori');
      return;
    }

    const wantsAccount = accToggle && !linkedAccount;
    let createAccEmail = '';
    let createAccPassword = '';
    if (wantsAccount) {
      createAccEmail = accEmail.trim();
      createAccPassword = accPassword;
      if (!createAccEmail || createAccPassword.length < 6) {
        toast.error('Account: inserisci email valida e password (min. 6 caratteri)');
        return;
      }
    }

    setSubmitting(true);
    try {
      let savedId = existing?.id;
      if (isEdit && existing) {
        await updateCommissario.mutateAsync({
          id: existing.id,
          body: {
            nome: baseFields.nome,
            cognome: baseFields.cognome,
            specialita: baseFields.specialita,
            email: baseFields.email || undefined,
            telefono: baseFields.telefono || undefined,
            dataNascita: baseFields.dataNascita,
            nazionalita: baseFields.nazionalita || undefined,
            bio: baseFields.bio || undefined,
            ...(cvData !== initialCv ? { cv: cvData } : {}),
          },
        });
        toast.success('Commissario aggiornato');
      } else {
        const created = await createCommissario.mutateAsync({
          concorsoId,
          nome: baseFields.nome,
          cognome: baseFields.cognome,
          specialita: baseFields.specialita,
          email: baseFields.email || undefined,
          telefono: baseFields.telefono || undefined,
          dataNascita: baseFields.dataNascita,
          nazionalita: baseFields.nazionalita || undefined,
          bio: baseFields.bio || undefined,
          cv: cvData || undefined,
        });
        savedId = created.id;
        toast.success('Commissario aggiunto');
      }

      // Foto: upload nuovo blob, oppure rimozione esplicita.
      if (savedId) {
        if (fotoBlob) {
          await uploadFoto.mutateAsync({ id: savedId, file: fotoBlob });
        } else if (fotoRemoved && existing?.foto) {
          try {
            await commissariApi.deleteFoto(savedId);
            qc.invalidateQueries({ queryKey: ['commissari', concorsoId] });
          } catch {
            /* la rimozione foto non è bloccante */
          }
        }
      }

      // Creazione account collegato (se richiesto).
      if (wantsAccount && savedId) {
        try {
          const body: AccountCreate = {
            email: createAccEmail,
            password: createAccPassword,
            role: 'commissario',
            commissarioId: savedId,
            attivo: true,
          };
          await accountsApi.create(body);
          refreshAccounts();
          setCred({
            email: createAccEmail,
            password: createAccPassword,
            title: 'Credenziali create',
            subject: `${baseFields.nome} ${baseFields.cognome}`.trim(),
          });
          setSubmitting(false);
          // Non chiudiamo: lasciamo la modale credenziali visibile sopra.
          return;
        } catch (err) {
          const msg = httpErrorMessage(err);
          toast.error(`Commissario salvato, ma creazione account fallita: ${msg}`);
        }
      }

      onClose();
    } catch (err) {
      toast.error(`Errore: ${httpErrorMessage(err)}`);
    } finally {
      setSubmitting(false);
    }
  };

  const cvHasContent = cvData.trim().length > 0;

  return (
    <>
      <VanillaModal
        title={isEdit ? 'Modifica commissario' : 'Aggiungi commissario'}
        width="max-w-3xl"
        onClose={onClose}
        footer={
          <>
            <button type="button" className="text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 px-3.5 py-2 rounded-lg" onClick={onClose}>
              Annulla
            </button>
            <button
              type="submit"
              form="commissario-frm"
              className="text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 px-3.5 py-2 rounded-lg shadow-sm disabled:opacity-50"
              disabled={submitting}
            >
              {submitting ? 'Salvataggio…' : isEdit ? 'Salva modifiche' : 'Aggiungi commissario'}
            </button>
          </>
        }
      >
        <form id="commissario-frm" className="space-y-5" autoComplete="off" onSubmit={onSubmit}>
          {/* ---- Dati anagrafici ---- */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                Nome <span className="text-rose-500">*</span>
              </span>
              <input
                name="nome"
                required
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                className={inputCls}
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                Cognome <span className="text-rose-500">*</span>
              </span>
              <input
                name="cognome"
                required
                value={cognome}
                onChange={(e) => setCognome(e.target.value)}
                className={inputCls}
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                Specialità <span className="text-rose-500">*</span>
              </span>
              <input
                name="specialita"
                required
                value={specialita}
                onChange={(e) => setSpecialita(e.target.value)}
                className={inputCls}
                placeholder="Es: Pianoforte, Composizione…"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Data di nascita</span>
              <input
                name="data_nascita"
                type="date"
                value={dataNascita}
                onChange={(e) => setDataNascita(e.target.value)}
                max={todayISO}
                className={inputCls}
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Nazionalità</span>
              <input
                name="nazionalita"
                list="naz-list-com"
                value={nazionalita}
                onChange={(e) => setNazionalita(e.target.value)}
                className={inputCls}
                placeholder="Es: Italiana"
              />
              <datalist id="naz-list-com">
                {NATIONALITIES.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Email</span>
              <input
                name="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputCls}
                placeholder="nome@esempio.it"
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="text-sm font-medium text-slate-700">Telefono</span>
              <input
                name="telefono"
                type="tel"
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
                className={inputCls}
                placeholder="+39 ..."
              />
            </label>
          </div>

          {/* ---- Foto + CV ---- */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-slate-200">
            {/* Foto */}
            <div>
              <span className="text-sm font-medium text-slate-700 block mb-2">Foto</span>
              <div className="flex items-center gap-3">
                <div className="w-20 h-20 rounded-full bg-slate-100 border-2 border-slate-200 overflow-hidden flex items-center justify-center shrink-0">
                  {hasFoto ? (
                    <img src={fotoPreview} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-3xl text-slate-400">🧑‍⚖️</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <button
                    type="button"
                    className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-brand-700 bg-brand-50 hover:bg-brand-100 rounded-lg transition"
                    onClick={onFotoPick}
                  >
                    {hasFoto ? 'Cambia foto' : 'Carica foto'}
                  </button>
                  {hasFoto && (
                    <button
                      type="button"
                      className="ml-1 text-xs font-medium text-rose-600 hover:text-rose-800"
                      onClick={onFotoClear}
                    >
                      Rimuovi
                    </button>
                  )}
                  <input
                    ref={fotoInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={onFotoChange}
                  />
                  <p className="text-[10px] text-slate-500 mt-1.5">
                    JPG/PNG, ridimensionata automaticamente
                  </p>
                </div>
              </div>
            </div>

            {/* CV */}
            <div>
              <span className="text-sm font-medium text-slate-700 block mb-2">CV</span>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition"
                  onClick={() => setCvEditing((v) => !v)}
                >
                  {cvEditing ? 'Chiudi editor' : cvHasContent ? 'Modifica CV' : 'Inserisci CV'}
                </button>
                {cvHasContent && (
                  <>
                    <button
                      type="button"
                      className="text-xs font-medium text-emerald-700 hover:text-emerald-900 px-2 py-1 rounded-lg"
                      onClick={() => setCvViewOpen(true)}
                    >
                      Vedi CV
                    </button>
                    <button
                      type="button"
                      className="text-xs font-medium text-rose-600 hover:text-rose-800 px-2 py-1 rounded-lg"
                      onClick={() => {
                        setCvData('');
                        setCvEditing(false);
                      }}
                    >
                      Rimuovi
                    </button>
                    <span className="text-[11px] text-slate-500">{cvData.length} caratteri</span>
                  </>
                )}
              </div>
              {cvEditing && (
                <textarea
                  rows={6}
                  value={cvData}
                  onChange={(e) => setCvData(e.target.value)}
                  className={`${inputCls} mt-2 font-mono text-[13px]`}
                  placeholder="Incolla o scrivi il CV (testo semplice o markdown)…"
                  autoFocus
                />
              )}
              <p className="text-[10px] text-slate-500 mt-1.5">
                Testo semplice o markdown. Opzionale.
              </p>
            </div>
          </div>

          {/* ---- Biografia ---- */}
          <div className="pt-4 border-t border-slate-200">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Biografia / Note</span>
              <textarea
                name="bio"
                rows={3}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                className={inputCls}
                placeholder="Esperienze, ruoli, riconoscimenti…"
              />
            </label>
          </div>

          {/* ---- Nota presidente ---- */}
          <div className="pt-4 border-t border-slate-200">
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 text-xs text-amber-900 flex items-start gap-2">
              <span className="text-base shrink-0">🎯</span>
              <p>
                Per nominare un commissario <strong>presidente</strong>, vai al tab{' '}
                <em>Commissioni</em>, apri (o crea) la commissione e seleziona il presidente dal
                menù "Presidente della commissione". Un commissario può essere presidente di
                commissioni diverse.
              </p>
            </div>
          </div>

          {/* ---- Credenziali ---- */}
          <div className="pt-4 border-t border-slate-200">
            <header className="mb-2">
              <h4 className="text-sm font-bold text-slate-900">🔐 Credenziali di accesso</h4>
              <p className="text-xs text-slate-500">
                Account per consentire al commissario di entrare nell'app.
              </p>
            </header>

            {linkedAccount ? (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-emerald-900">
                  {linkedAccount.attivo ? '✅' : '⏸'} Account{' '}
                  {linkedAccount.attivo ? 'attivo' : 'disabilitato'}:{' '}
                  <span className="font-mono">{linkedAccount.email}</span>
                </div>
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    className="text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 px-3 py-1.5 rounded-lg"
                    onClick={onAccReset}
                  >
                    🔑 Genera nuova password
                  </button>
                  <button
                    type="button"
                    className="text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg"
                    onClick={onAccToggle}
                  >
                    {linkedAccount.attivo ? '⏸ Disabilita' : '▶ Riattiva'}
                  </button>
                  <button
                    type="button"
                    className="text-xs font-medium text-rose-600 hover:bg-rose-50 px-3 py-1.5 rounded-lg ml-auto"
                    onClick={onAccDelete}
                  >
                    🗑 Elimina account
                  </button>
                </div>
              </div>
            ) : (
              <>
                <label className="flex items-start gap-3 mb-3 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-1 w-4 h-4 rounded border-slate-300 text-brand-600"
                    checked={accToggle}
                    onChange={(e) => setAccToggle(e.target.checked)}
                  />
                  <div>
                    <span className="text-sm font-semibold text-slate-800">
                      Crea account di accesso per questo commissario
                    </span>
                    <span className="block text-xs text-slate-500 mt-0.5">
                      Se attivato, riceverà credenziali per accedere all'app come commissario.
                    </span>
                  </div>
                </label>
                {accToggle && (
                  <div className="space-y-2 bg-slate-50 border border-slate-200 rounded-xl p-3">
                    <label className="block">
                      <span className="text-xs font-medium text-slate-700">Email login</span>
                      <input
                        type="email"
                        value={accEmail}
                        onChange={(e) => setAccEmail(e.target.value)}
                        className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                        placeholder="nome@esempio.it"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-medium text-slate-700">
                        Password (min. 6 caratteri)
                      </span>
                      <div className="mt-1 flex gap-2">
                        <input
                          type="text"
                          minLength={6}
                          value={accPassword}
                          onChange={(e) => setAccPassword(e.target.value)}
                          className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono"
                        />
                        <button
                          type="button"
                          className="text-xs font-semibold text-brand-700 bg-brand-50 hover:bg-brand-100 px-3 py-2 rounded-lg whitespace-nowrap"
                          onClick={() => setAccPassword(generatePassword(12))}
                        >
                          🎲 Genera
                        </button>
                      </div>
                      <p className="text-[10px] text-slate-500 mt-1">
                        Salva la password subito — la mostriamo solo una volta dopo il salvataggio.
                      </p>
                    </label>
                  </div>
                )}
              </>
            )}
          </div>
        </form>
      </VanillaModal>

      {cvViewOpen && <CvTextModal text={cvData} onClose={() => setCvViewOpen(false)} />}
      {cred && (
        <CredentialsModal
          email={cred.email}
          password={cred.password}
          title={cred.title}
          subject={cred.subject}
          onClose={() => {
            setCred(null);
            onClose();
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// CommissarioCard — card commissario attivo (port di commissarioCardHtml)
// ---------------------------------------------------------------------------
interface CardProps {
  commissario: CommissarioRecord;
  isPresidente: boolean;
  onEdit: () => void;
  onUnassign: () => void;
  onDelete: () => void;
}

function CommissarioCard({ commissario: c, isPresidente, onEdit, onUnassign, onDelete }: CardProps) {
  const eta = ageFromDate(c.dataNascita);
  const [cvOpen, setCvOpen] = useState(false);
  const fotoSrc = c.foto ? fileUrl(c.foto) : null;

  const ringCls = isPresidente ? 'ring-2 ring-amber-400' : 'ring-2 ring-white';
  const cardCls = isPresidente ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200';

  return (
    <>
      <div
        className={`bg-white border ${cardCls} rounded-2xl p-4 flex items-start gap-3 hover:border-slate-300 transition`}
      >
        <div
          className={`w-14 h-14 rounded-full bg-gradient-to-br from-amber-100 to-orange-100 overflow-hidden flex items-center justify-center text-2xl text-amber-700 shrink-0 ${ringCls} shadow-soft`}
        >
          {fotoSrc ? (
            <img src={fotoSrc} alt="" className="w-full h-full object-cover" />
          ) : (
            '🧑‍⚖️'
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-semibold text-slate-900 truncate">{displayName(c)}</h4>
            {isPresidente && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 bg-amber-500 text-white rounded-full">
                🎯 PRESIDENTE
              </span>
            )}
            {c.nazionalita && (
              <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-700 rounded-full font-medium">
                {c.nazionalita}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-600 truncate">
            {c.specialita || '—'}
            {eta != null && ` · ${eta} anni`}
          </p>
          {c.email && (
            <p className="text-[11px] text-slate-500 truncate mt-0.5">✉ {c.email}</p>
          )}
          {c.telefono && <p className="text-[11px] text-slate-500 truncate">☎ {c.telefono}</p>}
          <div className="mt-2 flex items-center gap-1.5 flex-wrap">
            {c.cv && (
              <button
                onClick={() => setCvOpen(true)}
                className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-full font-medium"
                title="Vedi CV"
              >
                📄 CV
              </button>
            )}
            {c.bio && (
              <span
                className="text-[10px] px-1.5 py-0.5 bg-violet-50 text-violet-700 rounded-full font-medium"
                title={c.bio}
              >
                📝 bio
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-1 shrink-0">
          <button
            onClick={onEdit}
            className="text-xs text-brand-600 hover:bg-brand-50 px-2 py-1 rounded-lg font-medium"
          >
            Modifica
          </button>
          <button
            onClick={onUnassign}
            className="text-xs text-amber-700 hover:bg-amber-50 px-2 py-1 rounded-lg font-medium"
            title="Rimuovi questo commissario dal concorso corrente (resta in archivio)"
          >
            ↩ Rimuovi
          </button>
          <button
            onClick={onDelete}
            className="text-xs text-rose-600 hover:bg-rose-50 px-2 py-1 rounded-lg font-medium"
            title="Elimina il commissario dall'archivio (sparisce dal concorso)"
          >
            🗑 Elimina
          </button>
        </div>
      </div>

      {c.cv && cvOpen && <CvTextModal text={c.cv} onClose={() => setCvOpen(false)} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// ArchivioCard — card archivio (port di archivioCardHtml)
// ---------------------------------------------------------------------------
function ArchivioCard({
  commissario: c,
  inThis,
  onImport,
  importing,
}: {
  commissario: CommissarioRecord;
  inThis: boolean;
  onImport: () => void;
  importing: boolean;
}) {
  const eta = ageFromDate(c.dataNascita);
  const [cvOpen, setCvOpen] = useState(false);
  const fotoSrc = c.foto ? fileUrl(c.foto) : null;

  return (
    <>
      <div
        className={`bg-white border ${
          inThis ? 'border-emerald-200 bg-emerald-50/30' : 'border-slate-200'
        } rounded-2xl p-4 flex flex-col gap-3 hover:border-brand-300 transition`}
      >
        <div className="flex items-start gap-3">
          <div className="w-14 h-14 rounded-full bg-gradient-to-br from-amber-100 to-orange-100 overflow-hidden flex items-center justify-center text-2xl text-amber-700 shrink-0 ring-2 ring-white shadow-soft">
            {fotoSrc ? (
              <img src={fotoSrc} alt="" className="w-full h-full object-cover" />
            ) : (
              '🧑‍⚖️'
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="font-semibold text-slate-900 truncate">{displayName(c)}</h4>
            <p className="text-xs text-slate-600 truncate">
              {c.specialita || '—'}
              {eta != null && ` · ${eta} anni`}
              {c.nazionalita && ` · ${c.nazionalita}`}
            </p>
            {c.email && (
              <p className="text-[11px] text-slate-500 truncate mt-0.5">✉ {c.email}</p>
            )}
            {c.telefono && <p className="text-[11px] text-slate-500 truncate">☎ {c.telefono}</p>}
          </div>
        </div>
        {c.bio && (
          <p className="text-[11px] text-slate-600 leading-relaxed line-clamp-2">{c.bio}</p>
        )}
        <div className="flex items-center gap-1.5 flex-wrap">
          {c.cv && (
            <button
              onClick={() => setCvOpen(true)}
              className="text-[11px] px-2 py-0.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-full font-medium"
              title="Vedi CV"
            >
              📄 CV
            </button>
          )}
        </div>
        <div className="mt-auto pt-1">
          {inThis ? (
            <button
              disabled
              className="w-full text-xs font-semibold text-emerald-700 bg-emerald-100 px-3 py-2 rounded-lg cursor-default"
            >
              ✓ Già in questo concorso
            </button>
          ) : (
            <button
              onClick={onImport}
              disabled={importing}
              className="w-full text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 px-3 py-2 rounded-lg shadow-sm transition disabled:opacity-50"
            >
              {importing ? 'Importazione…' : '+ Aggiungi a questo concorso'}
            </button>
          )}
        </div>
      </div>

      {c.cv && cvOpen && <CvTextModal text={c.cv} onClose={() => setCvOpen(false)} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// CommissariTab (exported)
// ---------------------------------------------------------------------------
export default function CommissariTab({ concorsoId }: { concorsoId: string }) {
  const { data: all, isLoading, isError } = useCommissari(concorsoId);
  const { data: commissioni } = useCommissioni(concorsoId);
  const updateCommissario = useUpdateCommissario(concorsoId);
  const deleteCommissario = useDeleteCommissario(concorsoId);

  const [dialog, setDialog] = useState<{ open: boolean; existing: CommissarioRecord | null }>({
    open: false,
    existing: null,
  });
  const [importingId, setImportingId] = useState<string | null>(null);

  // ----- Archivio toolbar state (port di renderArchivio.ui) -----
  const [archQ, setArchQ] = useState('');
  const [archSpec, setArchSpec] = useState('');
  const [archNaz, setArchNaz] = useState('');
  const [archSort, setArchSort] = useState<'nome' | 'recente' | 'concorsi'>('nome');

  const attivi = useMemo(() => all?.filter((c) => c.stato === 'ATTIVO') ?? [], [all]);
  const inattivi = useMemo(() => all?.filter((c) => c.stato === 'INATTIVO') ?? [], [all]);

  // Presidente = commissario presidente di ALMENO UNA commissione del concorso
  // (db.isPresidenteDiQualcheCommissione, ora in @/lib/presidenti).
  const isPresidente = useMemo(() => {
    const coms = commissioni ?? [];
    return (id: string) => isPresidenteDiQualcheCommissione(id, coms);
  }, [commissioni]);

  const presidente = useMemo(
    () => attivi.find((c) => isPresidente(c.id)) ?? null,
    [attivi, isPresidente],
  );

  // ----- Action handlers (port di unassign/delete) -----
  const handleUnassign = async (c: CommissarioRecord) => {
    if (
      !confirm(
        `Rimuovere ${displayName(c)} da questo concorso? Resta nell'archivio per riusi futuri.`,
      )
    )
      return;
    try {
      await updateCommissario.mutateAsync({ id: c.id, body: { stato: 'INATTIVO' } });
      toast.success(`${displayName(c)} rimosso dal concorso`);
    } catch (e) {
      toast.error(httpErrorMessage(e));
    }
  };

  const handleDelete = async (c: CommissarioRecord) => {
    if (
      !confirm(
        `Eliminare "${displayName(c)}"? Il record sarà rimosso dall'archivio. Le valutazioni già salvate restano nello storico.`,
      )
    )
      return;
    try {
      await deleteCommissario.mutateAsync(c.id);
      toast.success('Commissario eliminato');
    } catch (e) {
      toast.error(httpErrorMessage(e));
    }
  };

  const handleImport = async (c: CommissarioRecord) => {
    setImportingId(c.id);
    try {
      await updateCommissario.mutateAsync({ id: c.id, body: { stato: 'ATTIVO' } });
      toast.success(`${displayName(c)} aggiunto al concorso`);
    } catch (e) {
      toast.error(`Errore importazione: ${httpErrorMessage(e)}`);
    } finally {
      setImportingId(null);
    }
  };

  // ----- Archivio filtri/ordinamento (port di renderArchivio.apply) -----
  const specialitaOpts = useMemo(
    () => [...new Set(inattivi.map((c) => c.specialita).filter(Boolean) as string[])].sort(),
    [inattivi],
  );
  const nazionalitaOpts = useMemo(
    () => [...new Set(inattivi.map((c) => c.nazionalita).filter(Boolean) as string[])].sort(),
    [inattivi],
  );

  const archResults = useMemo(() => {
    let list = inattivi.slice();
    if (archSpec) list = list.filter((c) => c.specialita === archSpec);
    if (archNaz) list = list.filter((c) => c.nazionalita === archNaz);
    if (archQ) {
      const q = archQ.toLowerCase();
      list = list.filter((c) => {
        const hay = `${c.nome} ${c.cognome || ''} ${c.specialita || ''} ${c.email || ''} ${c.telefono || ''} ${c.nazionalita || ''} ${c.bio || ''}`.toLowerCase();
        return hay.includes(q);
      });
    }
    if (archSort === 'nome') {
      list.sort((a, b) =>
        `${a.cognome || ''} ${a.nome}`.localeCompare(`${b.cognome || ''} ${b.nome}`, 'it'),
      );
    } else if (archSort === 'recente') {
      list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    }
    // 'concorsi' (numero concorsi) non applicabile al modello single-concorso:
    // lascia l'ordine corrente.
    return list;
  }, [inattivi, archSpec, archNaz, archQ, archSort]);

  const clearFilters = () => {
    setArchQ('');
    setArchSpec('');
    setArchNaz('');
    setArchSort('nome');
  };

  // ----- Render -----
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="bg-white border border-slate-200 rounded-2xl p-4 h-24 animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (isError) {
    return <p className="text-sm text-rose-600">Errore nel caricamento dei commissari.</p>;
  }

  return (
    <div className="view-fade">
      {/* ---- Header ---- */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">
          Commissari di questo concorso
        </h3>
        <div className="flex items-center gap-2">
          <button
            className="text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 px-3.5 py-2 rounded-lg shadow-sm"
            onClick={() => setDialog({ open: true, existing: null })}
          >
            + Aggiungi commissario
          </button>
        </div>
      </div>

      {/* ---- Summary line ---- */}
      <p className="text-sm text-slate-600 mb-4">
        {attivi.length} commissari assegnati ·{' '}
        {presidente ? (
          <>
            presidente: <strong>{displayName(presidente)}</strong>
          </>
        ) : (
          <span className="text-amber-700 font-medium">nessun presidente designato</span>
        )}
      </p>

      {/* ---- Warning: commissari ma nessun presidente ---- */}
      {attivi.length > 0 && !presidente && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl px-4 py-3 mb-4 text-sm">
          ⚠ Nessun commissario è marcato come <strong>presidente</strong>. Le fasi non potranno
          essere avviate o concluse finché non designi un presidente del concorso.
        </div>
      )}

      {/* ---- ATTIVI grid / empty ---- */}
      {attivi.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl py-12 text-center">
          <div className="text-4xl mb-2">🧑‍⚖️</div>
          <p className="text-sm text-slate-500 italic">
            Nessun commissario. Aggiungine almeno uno per consentire la valutazione.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {attivi.map((c) => (
            <CommissarioCard
              key={c.id}
              commissario={c}
              isPresidente={isPresidente(c.id)}
              onEdit={() => setDialog({ open: true, existing: c })}
              onUnassign={() => handleUnassign(c)}
              onDelete={() => handleDelete(c)}
            />
          ))}
        </div>
      )}

      {/* ---- Archivio ---- */}
      <div className="mt-8 pt-6 border-t-2 border-dashed border-brand-100">
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <div>
            <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">
              📚 Archivio commissari
            </h3>
            <p className="text-xs text-slate-500">
              {inattivi.length} anagrafiche archiviate · usa <strong>+ Aggiungi</strong> per
              riportarle in questo concorso
            </p>
          </div>
        </div>

        {/* Toolbar filtri */}
        <div className="bg-white border border-brand-100 rounded-2xl p-4 mb-4 shadow-soft">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
            <div className="md:col-span-5 relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">🔍</span>
              <input
                type="search"
                value={archQ}
                onChange={(e) => setArchQ(e.target.value)}
                placeholder="Cerca per nome, cognome, email, specialità, bio…"
                className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
              />
            </div>
            <select
              value={archSpec}
              onChange={(e) => setArchSpec(e.target.value)}
              className="md:col-span-3 border border-slate-300 rounded-lg px-2.5 py-2 text-sm focus:ring-2 focus:ring-brand-500"
            >
              <option value="">Tutte le specialità</option>
              {specialitaOpts.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              value={archNaz}
              onChange={(e) => setArchNaz(e.target.value)}
              className="md:col-span-2 border border-slate-300 rounded-lg px-2.5 py-2 text-sm focus:ring-2 focus:ring-brand-500"
            >
              <option value="">Tutte le nazionalità</option>
              {nazionalitaOpts.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <select
              value={archSort}
              onChange={(e) => setArchSort(e.target.value as typeof archSort)}
              className="md:col-span-2 border border-slate-300 rounded-lg px-2.5 py-2 text-sm focus:ring-2 focus:ring-brand-500"
            >
              <option value="nome">Ordina per nome</option>
              <option value="recente">Ordina per più recente</option>
            </select>
          </div>
          <div className="mt-2 flex items-center gap-3 text-xs">
            <button
              type="button"
              onClick={clearFilters}
              className="text-brand-600 hover:text-brand-800 font-medium ml-auto"
            >
              Cancella filtri
            </button>
          </div>
        </div>

        {/* Risultati archivio */}
        {inattivi.length === 0 ? (
          <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl py-12 text-center">
            <div className="text-4xl mb-2">📭</div>
            <p className="text-sm text-slate-500 italic">Nessun commissario in archivio.</p>
          </div>
        ) : archResults.length === 0 ? (
          <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl py-12 text-center">
            <div className="text-4xl mb-2">🔎</div>
            <p className="text-sm text-slate-500 italic">
              Nessun commissario corrisponde ai filtri.
            </p>
          </div>
        ) : (
          <>
            <div className="text-xs text-slate-500 mb-2">
              {archResults.length === 1
                ? `${archResults.length} risultato`
                : `${archResults.length} risultati`}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {archResults.map((c) => (
                <ArchivioCard
                  key={c.id}
                  commissario={c}
                  inThis={false}
                  importing={importingId === c.id}
                  onImport={() => handleImport(c)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* ---- Form dialog ---- */}
      {dialog.open && (
        <CommissarioFormDialog
          concorsoId={concorsoId}
          existing={dialog.existing}
          onClose={() => setDialog({ open: false, existing: null })}
        />
      )}
    </div>
  );
}

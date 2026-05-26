// CommissarioFormDialog — create / edit (port di openCommissarioForm).
// Extracted from CommissariTab.tsx — pure lift-and-move.

import { useState, useRef, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { fileUrl, httpErrorMessage } from '@/lib/api';
import { accountsApi, type AccountCreate, type AccountUpdate } from '@/api/accounts';
import type { Account } from '@/types';
import {
  useCreateCommissario,
  useUpdateCommissario,
  useUploadCommissarioFoto,
  commissariApi,
  type CommissarioRecord,
} from '@/api/commissari';
import {
  generatePassword,
  readImageResizedBlob,
  NATIONALITIES,
  useAccounts,
} from '../commissari-utils';
import VanillaModal from './VanillaModal';
import CvTextModal from './CvTextModal';
import CredentialsModal from './CredentialsModal';

export interface FormDialogProps {
  concorsoId: string;
  existing: CommissarioRecord | null;
  onClose: () => void;
}

export default function CommissarioFormDialog({ concorsoId, existing, onClose }: FormDialogProps) {
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
  let initNome = existing?.nome ?? '';
  let initCognome = existing?.cognome ?? '';
  if (existing && !initCognome && initNome.includes(' ')) {
    const parts = initNome.split(/\s+/);
    initNome = parts[0];
    initCognome = parts.slice(1).join(' ');
  }

  const todayISO = new Date().toISOString().slice(0, 10);
  const initialFoto = existing?.foto ? fileUrl(existing.foto) : null;
  const initialCv = existing?.cv ?? '';

  // ----- Controlled form state (mirror del vanilla che usa formFields()) -----
  const [nome, setNome] = useState(initNome);
  const [cognome, setCognome] = useState(initCognome);
  const [specialita, setSpecialita] = useState(existing?.specialita ?? '');
  const [dataNascita, setDataNascita] = useState(existing?.dataNascita ?? '');
  const [nazionalita, setNazionalita] = useState(existing?.nazionalita ?? '');
  const [email, setEmail] = useState(existing?.email ?? '');
  const [telefono, setTelefono] = useState(existing?.telefono ?? '');
  const [bio, setBio] = useState(existing?.bio ?? '');

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
  const [accEmail, setAccEmail] = useState(existing?.email ?? '');
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
      void refreshAccounts();
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
      void refreshAccounts();
    } catch (e) {
      toast.error(`Errore: ${httpErrorMessage(e)}`);
    }
  };

  // ----- Submit (port di onPrimary) -----
  const onSubmit = async (e: React.SyntheticEvent) => {
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
            void qc.invalidateQueries({ queryKey: ['commissari', concorsoId] });
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
          void refreshAccounts();
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

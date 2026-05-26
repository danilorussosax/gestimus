// CvTextModal — visualizza il CV in sola lettura (port di openCvText).
// Extracted from CommissariTab.tsx — pure lift-and-move.

import VanillaModal from './VanillaModal';

export default function CvTextModal({ text, onClose }: { text: string; onClose: () => void }) {
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

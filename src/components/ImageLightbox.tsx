import { motion } from 'motion/react';
import { useOverlayMotion } from './ModalTransition';
import React, { useState } from 'react';
import { X, ChevronLeft, ChevronRight, Maximize2 } from 'lucide-react';
import { PrivateImage } from './PrivateImage';
import { usePhotoPrefetch } from '../lib/usePhotoPrefetch';
import { useModalLifecycle } from '../lib/useModalLifecycle';

interface ImageLightboxProps { images: string[]; currentIndex: number; isOpen: boolean; onClose: () => void; onNavigate?: (newIndex: number) => void; }
export const ImageLightbox: React.FC<ImageLightboxProps> = (props) => props.isOpen && props.images.length ? <LightboxBody {...props} /> : null;
function LightboxBody({ images, currentIndex, onClose, onNavigate }: ImageLightboxProps) {
  const overlayMotion = useOverlayMotion();
  const index = Math.max(0, Math.min(currentIndex, images.length - 1));
  const currentImage = images[index];
  const [originalPhoto, setOriginalPhoto] = useState<string | null>(null);
  const showOriginal = originalPhoto === currentImage;
  const onDecoded = usePhotoPrefetch(images, index);
  const modal = useModalLifecycle(true, onClose);
  const move = (direction: -1 | 1) => { const next = index + direction; if (next >= 0 && next < images.length) { setOriginalPhoto(null); onNavigate?.(next); } };
  return <motion.div {...overlayMotion.backdrop} ref={modal} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Photo preview" id="image-lightbox-overlay" className="fixed inset-0 z-[70] grid grid-rows-[44px_minmax(0,1fr)_auto] gap-2 bg-black/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]" onClick={onClose} onKeyDown={(event) => { if (event.key === 'ArrowRight') move(1); if (event.key === 'ArrowLeft') move(-1); }}>
    <header className="relative z-20 flex justify-end"><button id="lightbox-close-button" onClick={onClose} className="ui-action h-11 w-11 rounded-full bg-stone-800 text-stone-200 hover:bg-stone-700" aria-label="Close photo preview"><X className="mx-auto h-6 w-6" /></button></header>
    <div className="relative min-h-0 w-full" onClick={(event) => event.stopPropagation()}>
      <PrivateImage src={currentImage} variant={showOriginal ? 'original' : 'display'} fit="contain" alt="Timeline attachment enlarged" onDecoded={onDecoded} className="h-full w-full" />
    </div>
    <footer className="relative z-20 flex min-h-11 flex-wrap items-center justify-center gap-2 text-sm font-medium text-stone-300" onClick={(event) => event.stopPropagation()}>
      <button id="lightbox-prev-button" disabled={index === 0} onClick={() => move(-1)} className="ui-action h-11 w-11 shrink-0 rounded-full bg-stone-800 text-white disabled:opacity-30" aria-label="Previous photo"><ChevronLeft className="mx-auto h-6 w-6" /></button>
      <span aria-live="polite">{index + 1} of {images.length}</span>
      <button id="lightbox-original-button" disabled={showOriginal} onClick={() => setOriginalPhoto(currentImage)} className="ui-action inline-flex min-h-11 items-center gap-1 rounded-lg bg-stone-800 px-3 disabled:opacity-60"><Maximize2 className="h-3.5 w-3.5" />{showOriginal ? 'Original' : 'View original'}</button>
      <button id="lightbox-next-button" disabled={index === images.length - 1} onClick={() => move(1)} className="ui-action h-11 w-11 shrink-0 rounded-full bg-stone-800 text-white disabled:opacity-30" aria-label="Next photo"><ChevronRight className="mx-auto h-6 w-6" /></button>
    </footer>
  </motion.div>;
}

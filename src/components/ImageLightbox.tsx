import React, { useEffect, useState } from 'react';
import { X, ChevronLeft, ChevronRight, Maximize2 } from 'lucide-react';
import { imageUrl } from '../lib/imageUrl';
import { PrivateImage } from './PrivateImage';

interface ImageLightboxProps { images: string[]; currentIndex: number; isOpen: boolean; onClose: () => void; onNavigate?: (newIndex: number) => void; }
export const ImageLightbox: React.FC<ImageLightboxProps> = ({ images, currentIndex, isOpen, onClose, onNavigate }) => {
  const [showOriginal, setShowOriginal] = useState(false);
  useEffect(() => { setShowOriginal(false); }, [currentIndex, isOpen]);
  useEffect(() => {
    if (!isOpen || images.length < 2 || (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return;
    const next = images[currentIndex + 1] || images[currentIndex - 1];
    if (!next) return;
    const preload = new Image(); preload.src = imageUrl(next, 'display');
  }, [currentIndex, images, isOpen]);
  if (!isOpen || images.length === 0) return null;
  const currentImage = images[currentIndex] || images[0];
  const move = (direction: -1 | 1, event: React.MouseEvent) => { event.stopPropagation(); const index = currentIndex + direction; if (onNavigate && index >= 0 && index < images.length) onNavigate(index); };
  return <div id="image-lightbox-overlay" className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm p-4" onClick={onClose}>
    <button id="lightbox-close-button" onClick={onClose} className="absolute top-5 right-5 rounded-full bg-stone-800/80 p-2.5 text-stone-200 transition-colors hover:bg-stone-700 hover:text-white" aria-label="Close photo preview"><X className="w-6 h-6" /></button>
    {images.length > 1 && currentIndex > 0 && <button id="lightbox-prev-button" onClick={(event) => move(-1, event)} className="absolute left-3 sm:left-6 top-1/2 -translate-y-1/2 rounded-full bg-stone-800/80 p-3 text-white hover:bg-stone-700" aria-label="Previous photo"><ChevronLeft className="w-6 h-6" /></button>}
    {images.length > 1 && currentIndex < images.length - 1 && <button id="lightbox-next-button" onClick={(event) => move(1, event)} className="absolute right-3 sm:right-6 top-1/2 -translate-y-1/2 rounded-full bg-stone-800/80 p-3 text-white hover:bg-stone-700" aria-label="Next photo"><ChevronRight className="w-6 h-6" /></button>}
    <div className="flex h-[80vh] w-[min(92vw,72rem)] items-center justify-center rounded-xl bg-black/30" onClick={(event) => event.stopPropagation()}><PrivateImage src={currentImage} variant={showOriginal ? 'original' : 'display'} fit="contain" alt="Timeline attachment enlarged" className="h-full w-full rounded-xl shadow-2xl" />
      <div className="mt-3 flex items-center justify-center gap-3 text-sm font-medium text-stone-300">{images.length > 1 && <span>{currentIndex + 1} of {images.length}</span>} {!showOriginal && <button onClick={() => setShowOriginal(true)} className="inline-flex items-center gap-1 rounded-lg bg-stone-800 px-2.5 py-1.5 hover:bg-stone-700"><Maximize2 className="h-3.5 w-3.5" />View original</button>}</div>
    </div>
  </div>;
};

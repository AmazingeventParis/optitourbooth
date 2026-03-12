import { useState, useRef, useCallback } from 'react';
import { useToast } from '@/hooks/useToast';
import { useAuthStore } from '@/store/authStore';
const API_BASE = import.meta.env.VITE_API_URL || '/api';

// Upload timeout: 60 seconds per photo
const UPLOAD_TIMEOUT_MS = 60_000;

export interface PhotoItem {
  id: string;
  file?: File;
  preview: string;
  progress: number;
  status: 'pending' | 'compressing' | 'uploading' | 'done' | 'error';
  serverPath?: string;
  filename: string;
  errorMessage?: string;
}

interface UsePhotoUploadOptions {
  tourneeId: string;
  pointId: string;
}

/**
 * Create a lightweight thumbnail preview from a file (avoids huge base64 strings)
 */
function createThumbnail(file: File): Promise<string> {
  return new Promise((resolve) => {
    // For non-image or very small files, use basic data URL
    if (!file.type.startsWith('image/') || file.size < 100 * 1024) {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.onerror = () => resolve('');
      reader.readAsDataURL(file);
      return;
    }

    // Use canvas to create a small thumbnail instead of full-size base64
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      const maxSize = 200;
      let w = img.width;
      let h = img.height;
      if (w > h) {
        if (w > maxSize) { h = (h * maxSize) / w; w = maxSize; }
      } else {
        if (h > maxSize) { w = (w * maxSize) / h; h = maxSize; }
      }

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.6));
      } else {
        resolve(url);
      }
      URL.revokeObjectURL(url);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve('');
    };

    img.src = url;
  });
}

export function usePhotoUpload({ tourneeId, pointId }: UsePhotoUploadOptions) {
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const { success } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  // Track active XHRs for cleanup
  const activeXhrs = useRef<Map<string, XMLHttpRequest>>(new Map());

  const updatePhoto = useCallback((id: string, updates: Partial<PhotoItem>) => {
    setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
  }, []);

  const uploadSinglePhoto = useCallback(async (photo: PhotoItem) => {
    if (!photo.file) return;

    const formData = new FormData();
    formData.append('photos', photo.file);

    updatePhoto(photo.id, { status: 'uploading', progress: 0 });

    try {
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        activeXhrs.current.set(photo.id, xhr);

        xhr.open('POST', `${API_BASE}/tournees/${tourneeId}/points/${pointId}/photos`);

        // Timeout
        xhr.timeout = UPLOAD_TIMEOUT_MS;
        xhr.ontimeout = () => {
          activeXhrs.current.delete(photo.id);
          reject(new Error('Délai dépassé'));
        };

        // Auth token - use Zustand store directly (same as Axios interceptor)
        const authToken = useAuthStore.getState().token;
        if (authToken) {
          xhr.setRequestHeader('Authorization', `Bearer ${authToken}`);
        }

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const percent = Math.round((e.loaded / e.total) * 100);
            updatePhoto(photo.id, { progress: percent });
          }
        };

        xhr.onload = () => {
          activeXhrs.current.delete(photo.id);
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const response = JSON.parse(xhr.responseText);
              const serverPhotos = response.data;
              const serverPhoto = Array.isArray(serverPhotos) ? serverPhotos[0] : serverPhotos;
              updatePhoto(photo.id, {
                status: 'done',
                progress: 100,
                serverPath: serverPhoto?.path || photo.preview,
              });
            } catch {
              updatePhoto(photo.id, { status: 'done', progress: 100 });
            }
            resolve();
          } else {
            let msg = `Erreur ${xhr.status}`;
            try {
              const err = JSON.parse(xhr.responseText);
              msg = err?.error?.message || msg;
            } catch { /* ignore */ }
            reject(new Error(msg));
          }
        };

        xhr.onerror = () => {
          activeXhrs.current.delete(photo.id);
          reject(new Error('Erreur réseau'));
        };

        xhr.onabort = () => {
          activeXhrs.current.delete(photo.id);
          reject(new Error('Upload annulé'));
        };

        xhr.send(formData);
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur inconnue';
      updatePhoto(photo.id, { status: 'error', errorMessage: message });
    }
  }, [tourneeId, pointId, updatePhoto]);

  const addPhotos = useCallback(async (files: File[]) => {
    if (files.length === 0) return;

    // Create placeholder entries with thumbnails immediately
    const newPhotos: PhotoItem[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      const preview = await createThumbnail(file);

      newPhotos.push({
        id: `upload-${Date.now()}-${i}`,
        file,
        preview,
        progress: 0,
        status: 'compressing',
        filename: file.name,
      });
    }

    setPhotos((prev) => [...prev, ...newPhotos]);
    success(`${newPhotos.length} photo(s) en préparation...`);

    // Compress and upload one by one (sequential to avoid memory pressure on mobile)
    const { compressImage } = await import('@/utils/imageCompression');

    for (const photo of newPhotos) {
      if (!photo.file) continue;

      try {
        // Compress
        const compressed = await compressImage(photo.file);

        // Update the photo with compressed file
        const updatedPhoto: PhotoItem = {
          ...photo,
          file: compressed,
          status: 'pending',
        };

        setPhotos((prev) =>
          prev.map((p) => (p.id === photo.id ? { ...p, file: compressed, status: 'pending' } : p))
        );

        // Upload
        await uploadSinglePhoto(updatedPhoto);
      } catch {
        updatePhoto(photo.id, { status: 'error', errorMessage: 'Échec compression' });
      }
    }
  }, [uploadSinglePhoto, updatePhoto, success]);

  const removePhoto = useCallback((photoId: string) => {
    // Abort active upload if any
    const xhr = activeXhrs.current.get(photoId);
    if (xhr) {
      xhr.abort();
      activeXhrs.current.delete(photoId);
    }
    setPhotos((prev) => prev.filter((p) => p.id !== photoId));
  }, []);

  const retryPhoto = useCallback((photoId: string) => {
    const photo = photos.find((p) => p.id === photoId);
    if (photo && photo.file) {
      updatePhoto(photoId, { status: 'pending', progress: 0, errorMessage: undefined });
      uploadSinglePhoto(photo);
    }
  }, [photos, uploadSinglePhoto, updatePhoto]);

  const isUploading = photos.some((p) => p.status === 'uploading' || p.status === 'pending' || p.status === 'compressing');

  return {
    photos,
    addPhotos,
    removePhoto,
    retryPhoto,
    isUploading,
    fileInputRef,
    galleryInputRef,
  };
}

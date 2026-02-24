import { useState, useRef, useCallback } from 'react';
import { useToast } from '@/hooks/useToast';
const API_BASE = import.meta.env.VITE_API_URL || '/api';

export interface PhotoItem {
  id: string;
  file?: File;
  preview: string;
  progress: number;
  status: 'pending' | 'uploading' | 'done' | 'error';
  serverPath?: string;
  filename: string;
}

interface UsePhotoUploadOptions {
  tourneeId: string;
  pointId: string;
}

export function usePhotoUpload({ tourneeId, pointId }: UsePhotoUploadOptions) {
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const { success } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const uploadSinglePhoto = useCallback(async (photo: PhotoItem) => {
    const formData = new FormData();
    if (!photo.file) return;
    formData.append('photos', photo.file);

    setPhotos((prev) =>
      prev.map((p) => (p.id === photo.id ? { ...p, status: 'uploading' as const, progress: 0 } : p))
    );

    try {
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${API_BASE}/tournees/${tourneeId}/points/${pointId}/photos`);

        // Get auth token
        const token = localStorage.getItem('auth-storage');
        if (token) {
          try {
            const parsed = JSON.parse(token);
            const authToken = parsed?.state?.token;
            if (authToken) {
              xhr.setRequestHeader('Authorization', `Bearer ${authToken}`);
            }
          } catch { /* ignore */ }
        }

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const percent = Math.round((e.loaded / e.total) * 100);
            setPhotos((prev) =>
              prev.map((p) => (p.id === photo.id ? { ...p, progress: percent } : p))
            );
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const response = JSON.parse(xhr.responseText);
              const serverPhotos = response.data;
              const serverPhoto = Array.isArray(serverPhotos) ? serverPhotos[0] : serverPhotos;
              setPhotos((prev) =>
                prev.map((p) =>
                  p.id === photo.id
                    ? {
                        ...p,
                        status: 'done' as const,
                        progress: 100,
                        serverPath: serverPhoto?.path || p.preview,
                      }
                    : p
                )
              );
            } catch {
              setPhotos((prev) =>
                prev.map((p) =>
                  p.id === photo.id ? { ...p, status: 'done' as const, progress: 100 } : p
                )
              );
            }
            resolve();
          } else {
            reject(new Error(`Upload failed: ${xhr.status}`));
          }
        };

        xhr.onerror = () => reject(new Error('Network error'));
        xhr.send(formData);
      });
    } catch {
      setPhotos((prev) =>
        prev.map((p) => (p.id === photo.id ? { ...p, status: 'error' as const } : p))
      );
    }
  }, [tourneeId, pointId]);

  const addPhotos = useCallback(async (files: File[]) => {
    // Compress images before upload
    let compressedFiles: File[];
    try {
      const { compressImages } = await import('@/utils/imageCompression');
      compressedFiles = await compressImages(files);
    } catch {
      compressedFiles = files;
    }

    const newPhotos: PhotoItem[] = [];

    for (let i = 0; i < compressedFiles.length; i++) {
      const file = compressedFiles[i];
      const preview = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.readAsDataURL(file);
      });

      const photo: PhotoItem = {
        id: `upload-${Date.now()}-${i}`,
        file,
        preview,
        progress: 0,
        status: 'pending',
        filename: file.name,
      };
      newPhotos.push(photo);
    }

    setPhotos((prev) => [...prev, ...newPhotos]);

    // Upload each photo independently in background
    for (const photo of newPhotos) {
      uploadSinglePhoto(photo);
    }

    if (newPhotos.length > 0) {
      success(`${newPhotos.length} photo(s) en cours d'envoi`);
    }
  }, [uploadSinglePhoto, success]);

  const removePhoto = useCallback((photoId: string) => {
    setPhotos((prev) => prev.filter((p) => p.id !== photoId));
  }, []);

  const retryPhoto = useCallback((photoId: string) => {
    const photo = photos.find((p) => p.id === photoId);
    if (photo && photo.file) {
      uploadSinglePhoto(photo);
    }
  }, [photos, uploadSinglePhoto]);

  const isUploading = photos.some((p) => p.status === 'uploading' || p.status === 'pending');

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

import imageCompression from 'browser-image-compression';

/**
 * Compresse une image pour réduire sa taille avant upload
 * Taille cible: 1.5MB max, 1920px max, qualité 80%
 */
export async function compressImage(file: File): Promise<File> {
  const options = {
    maxSizeMB: 1.5,
    maxWidthOrHeight: 1920,
    useWebWorker: true,
    fileType: 'image/jpeg' as const,
    initialQuality: 0.8,
  };

  try {
    const compressedFile = await imageCompression(file, options);
    console.log(`[Compression] ${file.name}: ${(file.size / 1024 / 1024).toFixed(2)}MB → ${(compressedFile.size / 1024 / 1024).toFixed(2)}MB`);
    return compressedFile;
  } catch (error) {
    console.error('[Compression] Échec:', error);
    // Fallback sur fichier original si compression échoue
    return file;
  }
}

/**
 * Compresse plusieurs images en parallèle
 */
export async function compressImages(files: File[]): Promise<File[]> {
  return Promise.all(files.map(f => compressImage(f)));
}

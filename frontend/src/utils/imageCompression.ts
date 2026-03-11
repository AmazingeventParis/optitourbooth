import imageCompression from 'browser-image-compression';

/**
 * Compresse une image pour réduire sa taille avant upload
 * Optimisé pour les photos de téléphone (souvent 5-12MB)
 * Cible: ~500KB, 1280px max, qualité 70%
 */
export async function compressImage(file: File): Promise<File> {
  // Skip compression for already small files (< 300KB)
  if (file.size < 300 * 1024) {
    return file;
  }

  const options = {
    maxSizeMB: 0.5,
    maxWidthOrHeight: 1280,
    useWebWorker: true,
    fileType: 'image/jpeg' as const,
    initialQuality: 0.7,
    alwaysKeepResolution: false,
  };

  try {
    const compressedFile = await imageCompression(file, options);
    console.log(
      `[Compression] ${file.name}: ${(file.size / 1024 / 1024).toFixed(1)}MB → ${(compressedFile.size / 1024 / 1024).toFixed(1)}MB`
    );
    return compressedFile;
  } catch (error) {
    console.error('[Compression] Échec:', error);
    return file;
  }
}

/**
 * Compresse plusieurs images séquentiellement (évite de surcharger la mémoire mobile)
 */
export async function compressImages(files: File[]): Promise<File[]> {
  const results: File[] = [];
  for (const file of files) {
    results.push(await compressImage(file));
  }
  return results;
}

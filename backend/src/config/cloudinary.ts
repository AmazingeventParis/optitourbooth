import { v2 as cloudinary } from 'cloudinary';

// Vérifier que les credentials Cloudinary sont configurés
const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
const apiKey = process.env.CLOUDINARY_API_KEY;
const apiSecret = process.env.CLOUDINARY_API_SECRET;

if (!cloudName || !apiKey || !apiSecret) {
  console.warn('⚠️  CLOUDINARY credentials manquantes. Upload de photos désactivé.');
  console.warn('   Variables requises: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET');
}

// Configuration Cloudinary
cloudinary.config({
  cloud_name: cloudName,
  api_key: apiKey,
  api_secret: apiSecret,
});

export { cloudinary };

/**
 * Vérifie si Cloudinary est configuré
 */
export function isCloudinaryConfigured(): boolean {
  return !!(cloudName && apiKey && apiSecret);
}

/**
 * Upload une image vers Cloudinary
 * @param fileBuffer - Le buffer du fichier
 * @param folder - Le dossier de destination dans Cloudinary
 * @returns L'URL de l'image uploadée
 */
export async function uploadToCloudinary(
  fileBuffer: Buffer,
  folder: string = 'optitourbooth'
): Promise<{ url: string; publicId: string }> {
  // Vérifier que Cloudinary est configuré
  if (!isCloudinaryConfigured()) {
    throw new Error('Cloudinary n\'est pas configuré. Vérifiez les variables d\'environnement CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET');
  }

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: 'image',
        transformation: [
          { quality: 'auto:good' }, // Optimisation automatique de la qualité
          { fetch_format: 'auto' }, // Format automatique (webp si supporté)
        ],
      },
      (error, result) => {
        if (error) {
          console.error('Cloudinary upload error:', error);
          reject(error);
        } else if (result) {
          resolve({
            url: result.secure_url,
            publicId: result.public_id,
          });
        } else {
          reject(new Error('Upload failed: no result'));
        }
      }
    );

    uploadStream.end(fileBuffer);
  });
}

/**
 * Supprime une image de Cloudinary
 * @param publicId - L'ID public de l'image
 */
export async function deleteFromCloudinary(publicId: string): Promise<void> {
  await cloudinary.uploader.destroy(publicId);
}

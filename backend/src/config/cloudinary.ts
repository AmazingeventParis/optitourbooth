import { v2 as cloudinary } from 'cloudinary';

// Configuration Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export { cloudinary };

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

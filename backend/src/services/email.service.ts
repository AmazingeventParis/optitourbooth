import nodemailer from 'nodemailer';
import { config } from '../config/index.js';

type Brand = 'SHOOTNBOX' | 'SMAKK';

function getTransporter(brand: Brand) {
  const brandConfig = config.email.brands[brand];
  if (!brandConfig.password) {
    throw new Error(`Mot de passe email non configuré pour ${brand}`);
  }

  return nodemailer.createTransport({
    host: config.email.smtp.host,
    port: config.email.smtp.port,
    secure: config.email.smtp.secure,
    auth: {
      user: brandConfig.email,
      pass: brandConfig.password,
    },
  });
}

/**
 * Send the review/gallery link to a customer
 */
export async function sendReviewLinkEmail(opts: {
  to: string;
  customerName: string;
  publicUrl: string;
  galleryUrl?: string | null;
  brand: Brand;
}): Promise<void> {
  const { to, customerName, publicUrl, brand } = opts;
  const brandConfig = config.email.brands[brand];
  const transporter = getTransporter(brand);

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #333;">Bonjour ${customerName},</h2>
      <p>Merci d'avoir fait appel à <strong>${brandConfig.name}</strong> !</p>
      <p>Votre galerie photos est prête. Pour y accéder, cliquez sur le bouton ci-dessous :</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${publicUrl}"
           style="background-color: #2563eb; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
          Accéder à ma galerie
        </a>
      </div>
      <p style="color: #666; font-size: 14px;">
        Si vous laissez un avis Google, votre galerie sera disponible immédiatement.<br>
        Sinon, elle sera accessible sous 24h.
      </p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
      <p style="color: #999; font-size: 12px;">
        ${brandConfig.name} — ${brandConfig.email}
      </p>
    </div>
  `;

  await transporter.sendMail({
    from: `"${brandConfig.name}" <${brandConfig.email}>`,
    to,
    subject: `${brandConfig.name} — Votre galerie photos`,
    html,
  });

  console.log(`[Email] Lien avis envoyé à ${to} via ${brand}`);
}

/**
 * Send the gallery link directly (no review page)
 */
export async function sendGalleryDirectEmail(opts: {
  to: string;
  customerName: string;
  galleryUrl: string;
  brand: Brand;
}): Promise<void> {
  const { to, customerName, galleryUrl, brand } = opts;
  const brandConfig = config.email.brands[brand];
  const transporter = getTransporter(brand);

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #333;">Bonjour ${customerName},</h2>
      <p>Merci d'avoir fait appel à <strong>${brandConfig.name}</strong> !</p>
      <p>Votre galerie photos est disponible. Cliquez sur le bouton ci-dessous pour y accéder :</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${galleryUrl}"
           style="background-color: #16a34a; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
          Voir mes photos
        </a>
      </div>
      <p style="color: #666; font-size: 14px;">
        N'hésitez pas à nous laisser un avis Google, cela nous aide beaucoup !
      </p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
      <p style="color: #999; font-size: 12px;">
        ${brandConfig.name} — ${brandConfig.email}
      </p>
    </div>
  `;

  await transporter.sendMail({
    from: `"${brandConfig.name}" <${brandConfig.email}>`,
    to,
    subject: `${brandConfig.name} — Vos photos sont disponibles !`,
    html,
  });

  console.log(`[Email] Galerie envoyée à ${to} via ${brand}`);
}

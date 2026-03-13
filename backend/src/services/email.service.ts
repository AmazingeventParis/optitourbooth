import nodemailer from 'nodemailer';
import { config } from '../config/index.js';
import { listFolderThumbnails } from './googleDrive.service.js';

type Brand = 'SHOOTNBOX' | 'SMAKK';

interface BrandTheme {
  primary: string;
  primaryDark: string;
  accent: string;
  gradient: string;
  logo: string;
  logoUrl: string;
  website: string;
}

const BRAND_THEMES: Record<Brand, BrandTheme> = {
  SHOOTNBOX: {
    primary: '#E60A81',
    primaryDark: '#C4086D',
    accent: '#E74C25',
    gradient: 'linear-gradient(135deg, #E60A81 0%, #E74C25 100%)',
    logo: 'Shoot\'n\'Box',
    logoUrl: 'https://optitourbooth.swipego.app/logo-shootnbox.png',
    website: 'shootnbox.fr',
  },
  SMAKK: {
    primary: '#7C3AED',
    primaryDark: '#6D28D9',
    accent: '#A855F7',
    gradient: 'linear-gradient(135deg, #7C3AED 0%, #A855F7 100%)',
    logo: 'Smakk',
    logoUrl: '',
    website: 'smakk.fr',
  },
};

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

function buildThumbnailGrid(thumbnails: string[]): string {
  if (!thumbnails.length) return '';

  // Show max 6 photos in a 3x2 grid, using background-image (not downloadable)
  const photos = thumbnails.slice(0, 6);

  const makeCell = (url: string) => `
    <td style="width:33.33%;padding:3px;">
      <div style="width:100%;height:120px;border-radius:8px;background:url('${url}') center/cover no-repeat;"></div>
    </td>
  `;

  const row1 = photos.slice(0, 3).map(makeCell).join('');
  const row2 = photos.length > 3 ? photos.slice(3, 6).map(makeCell).join('') : '';

  return `
    <table role="presentation" style="width:100%;border-collapse:collapse;margin:20px 0;">
      <tr>${row1}</tr>
      ${row2 ? `<tr>${row2}</tr>` : ''}
    </table>
  `;
}

async function fetchThumbnails(galleryUrl?: string | null): Promise<{ thumbnails: string[]; totalCount: number }> {
  if (!galleryUrl) return { thumbnails: [], totalCount: 0 };
  try {
    return await listFolderThumbnails(galleryUrl);
  } catch (err) {
    console.error('[Email] Failed to fetch thumbnails:', err);
    return { thumbnails: [], totalCount: 0 };
  }
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
  const { to, customerName, publicUrl, galleryUrl, brand } = opts;
  const brandConfig = config.email.brands[brand];
  const theme = BRAND_THEMES[brand];
  const transporter = getTransporter(brand);

  const { thumbnails, totalCount } = await fetchThumbnails(galleryUrl);
  const photoGrid = buildThumbnailGrid(thumbnails);
  const hasPhotos = thumbnails.length > 0;
  const remainingCount = totalCount - Math.min(thumbnails.length, 6);

  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
    <body style="margin:0;padding:0;background-color:#f4f4f5;font-family:'Raleway',Arial,sans-serif;">
      <table role="presentation" style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="padding:20px 10px;">
            <table role="presentation" style="max-width:600px;margin:0 auto;border-collapse:collapse;width:100%;">

              <!-- Header -->
              <tr>
                <td style="background-color:white;padding:35px 30px 20px;border-radius:16px 16px 0 0;text-align:center;border-bottom:3px solid ${theme.primary};">
                  ${theme.logoUrl
                    ? `<img src="${theme.logoUrl}" alt="${theme.logo}" style="max-width:220px;height:auto;display:inline-block;" />`
                    : `<h1 style="margin:0;color:${theme.primary};font-size:28px;font-weight:800;">${theme.logo}</h1>`
                  }
                  <p style="margin:10px 0 0;color:#6b7280;font-size:13px;font-style:italic;letter-spacing:0.5px;">
                    Créateur de souvenirs
                  </p>
                </td>
              </tr>

              <!-- Body -->
              <tr>
                <td style="background-color:white;padding:35px 30px;">

                  <!-- Greeting -->
                  <h2 style="margin:0 0 5px;color:#1a1a2e;font-size:22px;font-weight:700;">
                    Bonjour ${customerName} !
                  </h2>
                  <p style="margin:0 0 25px;color:#6b7280;font-size:15px;line-height:1.6;">
                    Merci d'avoir fait confiance à <strong style="color:${theme.primary};">${brandConfig.name}</strong> pour votre événement ! Nous espérons que vous avez passé un moment inoubliable.
                  </p>

                  ${hasPhotos ? `
                  <!-- Photo preview -->
                  <div style="margin:0 0 10px;">
                    <p style="margin:0 0 8px;color:#1a1a2e;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">
                      Aperçu de vos photos
                    </p>
                  </div>
                  ${photoGrid}
                  <p style="margin:0 0 25px;color:#9ca3af;font-size:12px;text-align:center;font-style:italic;">
                    ${remainingCount > 0 ? `et ${remainingCount} autres photos vous attendent...` : 'Vos souvenirs vous attendent !'}
                  </p>
                  ` : ''}

                  <!-- CTA -->
                  <table role="presentation" style="width:100%;border-collapse:collapse;">
                    <tr>
                      <td style="text-align:center;padding:10px 0 25px;">
                        <a href="${publicUrl}"
                           style="display:inline-block;background:${theme.gradient};color:white;padding:16px 40px;text-decoration:none;border-radius:50px;font-weight:700;font-size:16px;letter-spacing:0.3px;box-shadow:0 4px 15px rgba(230,10,129,0.3);">
                          Accéder à ma galerie
                        </a>
                      </td>
                    </tr>
                  </table>

                  <!-- Review nudge -->
                  <table role="presentation" style="width:100%;border-collapse:collapse;background-color:#fdf2f8;border-radius:12px;">
                    <tr>
                      <td style="padding:20px;text-align:center;">
                        <p style="margin:0 0 5px;color:${theme.primary};font-size:14px;font-weight:700;">
                          Votre avis compte !
                        </p>
                        <p style="margin:0;color:#6b7280;font-size:13px;line-height:1.5;">
                          En partageant votre expérience, vous soutenez notre travail et aidez de futurs clients à nous découvrir. En remerciement, recevez vos photos instantanément !
                        </p>
                      </td>
                    </tr>
                  </table>

                </td>
              </tr>

              <!-- Footer -->
              <tr>
                <td style="background-color:#1a1a2e;padding:25px 30px;border-radius:0 0 16px 16px;text-align:center;">
                  <p style="margin:0 0 8px;color:rgba(255,255,255,0.7);font-size:13px;">
                    ${brandConfig.name} — ${theme.website}
                  </p>
                  <p style="margin:0;color:rgba(255,255,255,0.4);font-size:11px;">
                    ${brandConfig.email}
                  </p>
                </td>
              </tr>

            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  await transporter.sendMail({
    from: `"${brandConfig.name}" <${brandConfig.email}>`,
    to,
    subject: `${brandConfig.name} — Vos photos vous attendent ! 📸`,
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
  const theme = BRAND_THEMES[brand];
  const transporter = getTransporter(brand);

  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
    <body style="margin:0;padding:0;background-color:#f4f4f5;font-family:'Raleway',Arial,sans-serif;">
      <table role="presentation" style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="padding:20px 10px;">
            <table role="presentation" style="max-width:600px;margin:0 auto;border-collapse:collapse;width:100%;">

              <!-- Header -->
              <tr>
                <td style="background-color:white;padding:35px 30px 20px;border-radius:16px 16px 0 0;text-align:center;border-bottom:3px solid ${theme.primary};">
                  ${theme.logoUrl
                    ? `<img src="${theme.logoUrl}" alt="${theme.logo}" style="max-width:220px;height:auto;display:inline-block;" />`
                    : `<h1 style="margin:0;color:${theme.primary};font-size:28px;font-weight:800;">${theme.logo}</h1>`
                  }
                  <p style="margin:10px 0 0;color:#6b7280;font-size:13px;font-style:italic;letter-spacing:0.5px;">
                    Créateur de souvenirs
                  </p>
                </td>
              </tr>

              <!-- Body -->
              <tr>
                <td style="background-color:white;padding:35px 30px;">

                  <!-- Greeting -->
                  <h2 style="margin:0 0 5px;color:#1a1a2e;font-size:22px;font-weight:700;">
                    Bonjour ${customerName} !
                  </h2>
                  <p style="margin:0 0 25px;color:#6b7280;font-size:15px;line-height:1.6;">
                    Merci d'avoir fait confiance à <strong style="color:${theme.primary};">${brandConfig.name}</strong> ! Vos photos sont prêtes, rien que pour vous.
                  </p>

                  <!-- CTA -->
                  <table role="presentation" style="width:100%;border-collapse:collapse;">
                    <tr>
                      <td style="text-align:center;padding:10px 0 25px;">
                        <a href="${galleryUrl}"
                           style="display:inline-block;background:${theme.gradient};color:white;padding:16px 40px;text-decoration:none;border-radius:50px;font-weight:700;font-size:16px;letter-spacing:0.3px;box-shadow:0 4px 15px rgba(230,10,129,0.3);">
                          Voir toutes mes photos
                        </a>
                      </td>
                    </tr>
                  </table>

                </td>
              </tr>

              <!-- Footer -->
              <tr>
                <td style="background-color:#1a1a2e;padding:25px 30px;border-radius:0 0 16px 16px;text-align:center;">
                  <p style="margin:0 0 8px;color:rgba(255,255,255,0.7);font-size:13px;">
                    ${brandConfig.name} — ${theme.website}
                  </p>
                  <p style="margin:0;color:rgba(255,255,255,0.4);font-size:11px;">
                    ${brandConfig.email}
                  </p>
                </td>
              </tr>

            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  await transporter.sendMail({
    from: `"${brandConfig.name}" <${brandConfig.email}>`,
    to,
    subject: `${brandConfig.name} — Vos photos sont prêtes ! 📸`,
    html,
  });

  console.log(`[Email] Galerie envoyée à ${to} via ${brand}`);
}

/**
 * Client HTTP vers l'API MyShootnbox (shootnbox.fr/api/v1/...)
 *
 * Permet à OptiTour de notifier MyShootnbox quand une galerie est prête,
 * pour que l'app affiche le pipe d'avis directement à l'hôte au lieu d'un email.
 */

const MYSHOOTNBOX_API_BASE = process.env.MYSHOOTNBOX_API_BASE || 'https://shootnbox.fr/api';
const MYSHOOTNBOX_API_KEY = process.env.MYSHOOTNBOX_API_KEY || '';

export interface PhotosReadyPayload {
  num_id: string;
  gallery_url: string;
  photo_count?: number;
  brand?: 'shootnbox' | 'smakk';
  booking_id?: string;
}

export interface PhotosReadyResponse {
  ok: boolean;
  installed?: boolean;
  pushed_count?: number;
  tokens_total?: number;
  failed_count?: number;
  event_code?: string;
  reason?: string;
  skipped?: boolean;
}

/**
 * Notifie MyShootnbox qu'une galerie est prête pour un client.
 * - Si l'app est installée sur le téléphone du client → push notif + écran avis dans l'app
 * - Si l'app n'est pas installée → ne fait rien (response.installed=false)
 *
 * Fire-and-forget de fait : ne bloque pas le flow OptiTour (email envoyé en parallèle).
 * Les erreurs sont loggées mais ne sont pas remontées.
 */
export async function notifyPhotosReady(payload: PhotosReadyPayload): Promise<PhotosReadyResponse | null> {
  if (!MYSHOOTNBOX_API_KEY) {
    console.warn('[MyShootnbox] MYSHOOTNBOX_API_KEY non configurée — skip notification');
    return null;
  }
  if (!payload.num_id || !payload.gallery_url) {
    console.warn('[MyShootnbox] payload incomplet — skip notification', payload);
    return null;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000); // 10s timeout

    const res = await fetch(`${MYSHOOTNBOX_API_BASE}/photos_ready.php`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MYSHOOTNBOX_API_KEY}`,
      },
      body: JSON.stringify({
        num_id: payload.num_id,
        gallery_url: payload.gallery_url,
        photo_count: payload.photo_count ?? 0,
        brand: payload.brand ?? 'shootnbox',
        booking_id: payload.booking_id ?? '',
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const data = await res.json().catch(() => ({})) as PhotosReadyResponse;

    if (res.status === 404) {
      console.log(`[MyShootnbox] Event ${payload.num_id} introuvable — l'app n'est pas associée à ce num_id`);
      return data;
    }
    if (!res.ok) {
      console.warn(`[MyShootnbox] HTTP ${res.status} pour num_id=${payload.num_id}:`, data);
      return data;
    }

    if (data.installed === false) {
      console.log(`[MyShootnbox] Event ${payload.num_id} sans app installée — fallback email seul`);
    } else if (data.pushed_count !== undefined) {
      console.log(`[MyShootnbox] Push envoyée à ${data.pushed_count}/${data.tokens_total} tokens pour ${payload.num_id} (event_code=${data.event_code})`);
    } else if (data.skipped) {
      console.log(`[MyShootnbox] Skip ${payload.num_id}: ${data.reason}`);
    }
    return data;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[MyShootnbox] Erreur appel /photos_ready pour ${payload.num_id}:`, msg);
    return null;
  }
}

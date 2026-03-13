import { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || '/api';

type PageState = 'loading' | 'rating' | 'low_rating' | 'ask_review' | 'no_review_done' | 'closed' | 'gallery_sent' | 'error';

interface BookingData {
  status: string;
  customerName: string;
  eventDate: string;
  galleryUrl?: string | null;
  senderBrand?: string | null;
  rating?: number | null;
  hasGoogleReview: boolean;
}

function generateSessionId(): string {
  return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2) + Date.now().toString(36);
}

function StarIcon({ filled, hovered }: { filled: boolean; hovered: boolean }) {
  return (
    <svg
      className={`w-12 h-12 sm:w-14 sm:h-14 transition-all duration-200 ${
        filled
          ? 'text-amber-400 drop-shadow-lg'
          : hovered
            ? 'text-amber-300'
            : 'text-gray-300'
      }`}
      fill={filled || hovered ? 'currentColor' : 'none'}
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={filled || hovered ? 0 : 1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"
      />
    </svg>
  );
}

export default function ReviewPage() {
  const { token } = useParams<{ token: string }>();
  const [searchParams] = useSearchParams();
  const urlBrand = searchParams.get('brand') || '';
  const [pageState, setPageState] = useState<PageState>('loading');
  const [booking, setBooking] = useState<BookingData | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [sessionId] = useState(() => generateSessionId());
  const [hoveredStar, setHoveredStar] = useState(0);
  const [selectedRating, setSelectedRating] = useState(0);
  const [galleryUrl, setGalleryUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const brandName = booking?.senderBrand === 'SMAKK' ? 'Smakk' : 'Shootnbox';

  useEffect(() => {
    if (!token) {
      setPageState('error');
      setErrorMessage('Lien invalide');
      return;
    }

    const params = new URLSearchParams({ session_id: sessionId });
    if (urlBrand) params.set('brand', urlBrand);

    axios
      .get(`${API_URL}/public/bookings/${token}?${params.toString()}`)
      .then((res) => {
        const data = res.data.data;
        setBooking(data);
        if (data.status === 'closed') {
          setPageState('closed');
        } else if (data.status === 'gallery_sent') {
          setPageState('gallery_sent');
        } else if (data.status === 'rated_low') {
          setGalleryUrl(data.galleryUrl);
          setSelectedRating(data.rating || 0);
          setPageState('low_rating');
        } else if (data.status === 'rated_high' || data.status === 'review_clicked') {
          setSelectedRating(data.rating || 0);
          setPageState('ask_review');
        } else if (data.status === 'no_review_selected' || data.status === 'gallery_scheduled_24h') {
          setPageState('no_review_done');
        } else {
          // link_sent, page_viewed, or any new status → show rating
          setPageState('rating');
        }
      })
      .catch((err) => {
        setPageState('error');
        setErrorMessage(err.response?.status === 404 ? 'Page introuvable' : 'Une erreur est survenue');
      });
  }, [token, sessionId]);

  const handleRate = async (rating: number) => {
    if (!token || submitting) return;
    setSelectedRating(rating);
    setSubmitting(true);

    try {
      const res = await axios.post(`${API_URL}/public/bookings/${token}/actions/rate`, {
        rating,
        session_id: sessionId,
        user_agent: navigator.userAgent,
        referrer: document.referrer,
      });

      const data = res.data.data;
      if (data.action === 'show_gallery') {
        setGalleryUrl(data.galleryUrl);
        setPageState('low_rating');
      } else {
        setPageState('ask_review');
      }
    } catch {
      setErrorMessage('Une erreur est survenue. Veuillez réessayer.');
      setSubmitting(false);
    }
  };

  const handleReviewClick = async (platform: 'google' | 'trustpilot') => {
    if (!token) return;

    try {
      const res = await axios.post(`${API_URL}/public/bookings/${token}/actions/review-click`, {
        session_id: sessionId,
        user_agent: navigator.userAgent,
        referrer: document.referrer,
        platform,
      });

      const redirectUrl = res.data.data.redirect_url;
      if (redirectUrl) {
        window.open(redirectUrl, '_blank');
      } else {
        setErrorMessage(platform === 'trustpilot'
          ? 'Le lien Trustpilot n\'est pas encore configuré.'
          : 'Le lien d\'avis Google n\'est pas encore configuré.');
      }
    } catch {
      setErrorMessage('Une erreur est survenue. Veuillez réessayer.');
    }
  };

  const handleNoReviewClick = async () => {
    if (!token) return;

    try {
      await axios.post(`${API_URL}/public/bookings/${token}/actions/no-review-click`, {
        session_id: sessionId,
        user_agent: navigator.userAgent,
        referrer: document.referrer,
      });

      setPageState('no_review_done');
    } catch {
      setErrorMessage('Une erreur est survenue. Veuillez réessayer.');
    }
  };

  const ratingLabel = (r: number) => {
    if (r <= 1) return 'Très insatisfait';
    if (r === 2) return 'Insatisfait';
    if (r === 3) return 'Correct';
    if (r === 4) return 'Satisfait';
    return 'Très satisfait';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo / Branding */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 mb-4">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
          {/* Loading */}
          {pageState === 'loading' && (
            <div className="p-8 text-center">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-amber-500 mx-auto" />
              <p className="mt-4 text-gray-500">Chargement...</p>
            </div>
          )}

          {/* Error */}
          {pageState === 'error' && (
            <div className="p-8 text-center">
              <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
                <svg className="w-7 h-7 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">{errorMessage || 'Page introuvable'}</h2>
              <p className="text-gray-500">Ce lien n'est pas valide ou a expiré.</p>
            </div>
          )}

          {/* Closed */}
          {pageState === 'closed' && (
            <div className="p-8 text-center">
              <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
                <svg className="w-7 h-7 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">Page fermée</h2>
              <p className="text-gray-500">Cette page n'est plus disponible.</p>
            </div>
          )}

          {/* Gallery already sent */}
          {pageState === 'gallery_sent' && (
            <div className="p-8 text-center">
              <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                <svg className="w-7 h-7 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">Galerie envoyée</h2>
              <p className="text-gray-500">Votre galerie vous a déjà été envoyée. Vérifiez vos emails.</p>
            </div>
          )}

          {/* Star Rating */}
          {pageState === 'rating' && (
            <div className="p-8">
              <h1 className="text-2xl font-bold text-gray-900 text-center mb-2">
                Merci d'avoir choisi {brandName} !
              </h1>
              <p className="text-gray-600 text-center mb-8">
                Comment évaluez-vous votre expérience ?
              </p>

              {/* Stars */}
              <div className="flex justify-center gap-2 mb-4">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    onMouseEnter={() => setHoveredStar(star)}
                    onMouseLeave={() => setHoveredStar(0)}
                    onClick={() => handleRate(star)}
                    disabled={submitting}
                    className="focus:outline-none transform hover:scale-110 transition-transform duration-150 disabled:opacity-50"
                  >
                    <StarIcon
                      filled={star <= selectedRating}
                      hovered={star <= hoveredStar && selectedRating === 0}
                    />
                  </button>
                ))}
              </div>

              {/* Rating label */}
              <p className="text-center text-sm text-gray-500 h-6">
                {hoveredStar > 0 && selectedRating === 0
                  ? ratingLabel(hoveredStar)
                  : selectedRating > 0
                    ? ratingLabel(selectedRating)
                    : 'Cliquez sur les étoiles pour évaluer'}
              </p>

              {submitting && (
                <div className="flex justify-center mt-4">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-amber-500" />
                </div>
              )}

              {errorMessage && (
                <p className="text-sm text-red-500 text-center mt-3">{errorMessage}</p>
              )}
            </div>
          )}

          {/* Low rating (1-3) - Show gallery link */}
          {pageState === 'low_rating' && (
            <div className="p-8 text-center">
              <div className="flex justify-center gap-1 mb-6">
                {[1, 2, 3, 4, 5].map((star) => (
                  <StarIcon key={star} filled={star <= selectedRating} hovered={false} />
                ))}
              </div>

              <h2 className="text-xl font-bold text-gray-900 mb-2">
                Merci pour votre retour
              </h2>
              <p className="text-gray-600 mb-6">
                Nous sommes désolés que l'expérience n'ait pas été à la hauteur de vos attentes. Voici l'accès à vos photos :
              </p>

              {galleryUrl ? (
                <a
                  href={galleryUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-3 w-full bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white font-semibold py-4 px-6 rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl hover:-translate-y-0.5"
                >
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  Accéder à mes photos
                </a>
              ) : (
                <p className="text-gray-500">
                  Votre galerie sera bientôt disponible. Vous recevrez un email avec le lien d'accès.
                </p>
              )}
            </div>
          )}

          {/* High rating (4-5) - Ask for review */}
          {pageState === 'ask_review' && (
            <div className="p-6 sm:p-8">
              <div className="flex justify-center gap-1 mb-5">
                {[1, 2, 3, 4, 5].map((star) => (
                  <StarIcon key={star} filled={star <= selectedRating} hovered={false} />
                ))}
              </div>

              <h2 className="text-xl font-bold text-gray-900 text-center mb-2">
                Merci beaucoup !
              </h2>
              <p className="text-gray-600 text-center mb-6">
                Votre satisfaction nous fait très plaisir !
              </p>

              {/* Section 1: Leave a review → instant photos */}
              <div className="bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 rounded-xl p-5 mb-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-full bg-amber-400 flex items-center justify-center flex-shrink-0">
                    <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                  <h3 className="font-bold text-gray-900">Recevez vos photos instantanément</h3>
                </div>
                <p className="text-sm text-gray-600 mb-4">
                  Laissez un avis et recevez votre galerie photo par email dans les minutes qui suivent.
                </p>

                {/* Google review button */}
                <button
                  onClick={() => handleReviewClick('google')}
                  className="w-full flex items-center justify-center gap-3 bg-white hover:bg-gray-50 border-2 border-gray-200 hover:border-gray-300 text-gray-800 font-semibold py-3.5 px-5 rounded-xl transition-all duration-200 shadow-sm hover:shadow mb-2.5"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  Avis Google
                </button>

                {/* Trustpilot review button */}
                <button
                  onClick={() => handleReviewClick('trustpilot')}
                  className="w-full flex items-center justify-center gap-3 bg-white hover:bg-gray-50 border-2 border-gray-200 hover:border-gray-300 text-gray-800 font-semibold py-3.5 px-5 rounded-xl transition-all duration-200 shadow-sm hover:shadow"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
                    <path d="M12 1.5l2.91 6.26 6.59.58-5 4.53 1.5 6.63L12 15.77 5.99 19.5l1.5-6.63-5-4.53 6.59-.58L12 1.5z" fill="#00B67A"/>
                  </svg>
                  Avis Trustpilot
                </button>
              </div>


              {errorMessage && (
                <p className="text-sm text-red-500 text-center mt-3">{errorMessage}</p>
              )}
            </div>
          )}

          {/* No review confirmation - gallery in 24h */}
          {pageState === 'no_review_done' && (
            <div className="p-8 text-center">
              <div className="w-14 h-14 rounded-full bg-blue-100 flex items-center justify-center mx-auto mb-4">
                <svg className="w-7 h-7 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">C'est bien noté !</h2>
              <p className="text-gray-600">
                Votre lien d'accès à vos photos vous sera envoyé automatiquement sous <strong>48 heures</strong>.
              </p>
              <p className="text-gray-400 text-sm mt-4">
                Surveillez votre boîte mail, vous recevrez un email de {brandName}.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <p className="text-center text-gray-500 text-xs mt-6">
          Propulsé par {brandName}
        </p>
      </div>
    </div>
  );
}

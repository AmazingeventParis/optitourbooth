import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || '/api';

type PageState = 'loading' | 'active' | 'closed' | 'gallery_sent' | 'no_review_done' | 'error';

interface BookingData {
  status: string;
  customerName: string;
  eventDate: string;
  hasGoogleReview: boolean;
  message?: string;
}

function generateSessionId(): string {
  return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2) + Date.now().toString(36);
}

export default function ReviewPage() {
  const { token } = useParams<{ token: string }>();
  const [pageState, setPageState] = useState<PageState>('loading');
  const [booking, setBooking] = useState<BookingData | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [sessionId] = useState(() => generateSessionId());

  useEffect(() => {
    if (!token) {
      setPageState('error');
      setErrorMessage('Lien invalide');
      return;
    }

    axios
      .get(`${API_URL}/public/bookings/${token}?session_id=${sessionId}`)
      .then((res) => {
        const data = res.data.data;
        setBooking(data);
        if (data.status === 'closed') {
          setPageState('closed');
        } else if (data.status === 'gallery_sent') {
          setPageState('gallery_sent');
        } else {
          setPageState('active');
        }
      })
      .catch((err) => {
        setPageState('error');
        setErrorMessage(err.response?.status === 404 ? 'Page introuvable' : 'Une erreur est survenue');
      });
  }, [token, sessionId]);

  const handleReviewClick = async () => {
    if (!token) return;

    try {
      const res = await axios.post(`${API_URL}/public/bookings/${token}/actions/review-click`, {
        session_id: sessionId,
        user_agent: navigator.userAgent,
        referrer: document.referrer,
      });

      const redirectUrl = res.data.data.redirect_url;
      if (redirectUrl) {
        window.location.href = redirectUrl;
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
              <p className="text-gray-500">{booking?.message || 'Cette page n\'est plus disponible.'}</p>
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

          {/* No review confirmation */}
          {pageState === 'no_review_done' && (
            <div className="p-8 text-center">
              <div className="w-14 h-14 rounded-full bg-blue-100 flex items-center justify-center mx-auto mb-4">
                <svg className="w-7 h-7 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">C'est bien noté</h2>
              <p className="text-gray-500">
                Votre galerie vous sera envoyée automatiquement dans les 24 heures.
              </p>
            </div>
          )}

          {/* Active - Main page */}
          {pageState === 'active' && (
            <div className="p-8">
              <h1 className="text-2xl font-bold text-gray-900 text-center mb-2">
                Merci pour votre location Photobooth
              </h1>
              <p className="text-gray-600 text-center mb-8">
                Votre galerie est prête. Choisissez simplement l'option qui vous convient.
              </p>

              {/* CTA 1: Leave a Google review */}
              <button
                onClick={handleReviewClick}
                className="w-full flex items-center justify-center gap-3 bg-gradient-to-r from-amber-400 to-orange-500 hover:from-amber-500 hover:to-orange-600 text-white font-semibold py-4 px-6 rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl hover:-translate-y-0.5 mb-4"
              >
                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Laisser un avis Google
              </button>

              {/* CTA 2: No review */}
              <button
                onClick={handleNoReviewClick}
                className="w-full py-3 px-6 rounded-xl border-2 border-gray-200 text-gray-600 font-medium hover:bg-gray-50 hover:border-gray-300 transition-all duration-200"
              >
                Je ne laisse pas d'avis
              </button>

              {/* Reassurance */}
              <p className="text-sm text-gray-400 text-center mt-6">
                Dans tous les cas, votre galerie vous sera bien envoyée.
              </p>

              {errorMessage && (
                <p className="text-sm text-red-500 text-center mt-3">{errorMessage}</p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <p className="text-center text-gray-500 text-xs mt-6">
          Propulsé par OptiTour Booth
        </p>
      </div>
    </div>
  );
}

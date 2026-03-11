import { useState, useEffect, useCallback } from 'react';
import { bookingsService, CalendarEvent } from '@/services/bookings.service';
import { Card, Button, Badge, Modal, Input } from '@/components/ui';
import {
  PhotoIcon,
  PaperAirplaneIcon,
  ClipboardDocumentIcon,
  LinkIcon,
  CheckCircleIcon,
  CalendarDaysIcon,
  MapPinIcon,
  PhoneIcon,
  StarIcon,
  EyeIcon,
  ArrowPathIcon,
  FolderOpenIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import clsx from 'clsx';

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  link_sent: { label: 'Lien envoyé', color: 'bg-blue-100 text-blue-800' },
  page_viewed: { label: 'Page vue', color: 'bg-indigo-100 text-indigo-800' },
  review_clicked: { label: 'Avis cliqué', color: 'bg-amber-100 text-amber-800' },
  no_review_selected: { label: 'Sans avis', color: 'bg-gray-100 text-gray-800' },
  review_detected: { label: 'Avis détecté', color: 'bg-green-100 text-green-800' },
  review_matched: { label: 'Avis validé', color: 'bg-green-100 text-green-800' },
  gallery_scheduled_24h: { label: 'Galerie H+24', color: 'bg-orange-100 text-orange-800' },
  gallery_sent: { label: 'Galerie envoyée', color: 'bg-emerald-100 text-emerald-800' },
  manual_check_required: { label: 'Vérification', color: 'bg-red-100 text-red-800' },
  closed: { label: 'Fermé', color: 'bg-gray-100 text-gray-600' },
};

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateRange(start: string, end: string): string {
  if (start === end) return formatDate(start);
  const s = new Date(start + 'T12:00:00Z');
  const e = new Date(end + 'T12:00:00Z');
  return `${s.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} → ${e.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

export default function GaleriesClientsPage() {
  const [events, setEvents] = useState<{ upcoming: CalendarEvent[]; past: CalendarEvent[] }>({ upcoming: [], past: [] });
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');

  // Modal states
  const [sendModal, setSendModal] = useState<CalendarEvent | null>(null);
  const [sendEmail, setSendEmail] = useState('');
  const [galleryUrlInput, setGalleryUrlInput] = useState('');
  const [sending, setSending] = useState(false);

  // Gallery URL modal
  const [galleryModal, setGalleryModal] = useState<CalendarEvent | null>(null);
  const [galleryUrlEdit, setGalleryUrlEdit] = useState('');
  const [savingGallery, setSavingGallery] = useState(false);

  // Send gallery directly modal
  const [sendGalleryModal, setSendGalleryModal] = useState<CalendarEvent | null>(null);
  const [sendGalleryEmail, setSendGalleryEmail] = useState('');
  const [sendGalleryUrl, setSendGalleryUrl] = useState('');
  const [sendingGallery, setSendingGallery] = useState(false);

  const fetchEvents = useCallback(async () => {
    try {
      const data = await bookingsService.getCalendarEvents();
      setEvents(data);
    } catch {
      toast.error('Erreur lors du chargement des événements');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  const handleCreateAndSend = async (ev: CalendarEvent) => {
    if (!sendEmail.trim()) {
      toast.error('Email requis');
      return;
    }

    setSending(true);
    try {
      let bookingId = ev.booking?.id;

      // Create booking if not exists
      if (!bookingId) {
        const booking = await bookingsService.createFromEvent({
          googleEventId: ev.googleEventId,
          customerName: ev.clientName,
          customerEmail: sendEmail,
          eventDate: ev.startDate,
          eventEndDate: ev.endDate,
          produitNom: ev.produitNom || undefined,
          galleryUrl: galleryUrlInput || undefined,
        });
        bookingId = booking.id;
      }

      // Update gallery URL if provided and booking already existed
      if (ev.booking && galleryUrlInput && galleryUrlInput !== ev.booking.galleryUrl) {
        await bookingsService.update(bookingId, { galleryUrl: galleryUrlInput } as any);
      }

      // Send email
      await bookingsService.sendLinkEmail(bookingId, sendEmail);
      toast.success(`Lien envoyé à ${sendEmail}`);
      setSendModal(null);
      setSendEmail('');
      setGalleryUrlInput('');
      fetchEvents();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Erreur lors de l\'envoi');
    } finally {
      setSending(false);
    }
  };

  const handleSaveGalleryUrl = async (ev: CalendarEvent) => {
    if (!galleryUrlEdit.trim()) {
      toast.error('URL Google Drive requis');
      return;
    }
    setSavingGallery(true);
    try {
      let bookingId = ev.booking?.id;
      if (!bookingId) {
        const booking = await bookingsService.createFromEvent({
          googleEventId: ev.googleEventId,
          customerName: ev.clientName,
          eventDate: ev.startDate,
          eventEndDate: ev.endDate,
          produitNom: ev.produitNom || undefined,
          galleryUrl: galleryUrlEdit,
        });
        bookingId = booking.id;
      } else {
        await bookingsService.update(bookingId, { galleryUrl: galleryUrlEdit } as any);
      }
      toast.success('Lien Google Drive enregistré');
      setGalleryModal(null);
      setGalleryUrlEdit('');
      fetchEvents();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Erreur');
    } finally {
      setSavingGallery(false);
    }
  };

  const handleCopyLink = async (ev: CalendarEvent) => {
    if (!ev.booking?.publicUrl) {
      // Create booking first
      try {
        const booking = await bookingsService.createFromEvent({
          googleEventId: ev.googleEventId,
          customerName: ev.clientName,
          eventDate: ev.startDate,
          eventEndDate: ev.endDate,
          produitNom: ev.produitNom || undefined,
        });
        await navigator.clipboard.writeText(booking.publicUrl);
        toast.success('Lien copié !');
        fetchEvents();
      } catch {
        toast.error('Erreur lors de la création du lien');
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(ev.booking.publicUrl);
      toast.success('Lien copié !');
    } catch {
      toast.error('Impossible de copier');
    }
  };

  const handleSendGalleryDirect = async (ev: CalendarEvent) => {
    if (!sendGalleryEmail.trim()) {
      toast.error('Email requis');
      return;
    }
    if (!sendGalleryUrl.trim()) {
      toast.error('Lien Google Drive requis');
      return;
    }

    setSendingGallery(true);
    try {
      let bookingId = ev.booking?.id;

      if (!bookingId) {
        const booking = await bookingsService.createFromEvent({
          googleEventId: ev.googleEventId,
          customerName: ev.clientName,
          customerEmail: sendGalleryEmail,
          eventDate: ev.startDate,
          eventEndDate: ev.endDate,
          produitNom: ev.produitNom || undefined,
          galleryUrl: sendGalleryUrl,
        });
        bookingId = booking.id;
      } else {
        await bookingsService.update(bookingId, { galleryUrl: sendGalleryUrl, customerEmail: sendGalleryEmail } as any);
      }

      // Trigger manual gallery send
      await bookingsService.sendGallery(bookingId);
      toast.success(`Galerie envoyée à ${sendGalleryEmail}`);
      setSendGalleryModal(null);
      setSendGalleryEmail('');
      setSendGalleryUrl('');
      fetchEvents();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Erreur lors de l\'envoi');
    } finally {
      setSendingGallery(false);
    }
  };

  const openSendModal = (ev: CalendarEvent) => {
    setSendEmail(ev.booking?.customerEmail || '');
    setGalleryUrlInput(ev.booking?.galleryUrl || '');
    setSendModal(ev);
  };

  const openSendGalleryModal = (ev: CalendarEvent) => {
    setSendGalleryEmail(ev.booking?.customerEmail || '');
    setSendGalleryUrl(ev.booking?.galleryUrl || '');
    setSendGalleryModal(ev);
  };

  const openGalleryModal = (ev: CalendarEvent) => {
    setGalleryUrlEdit(ev.booking?.galleryUrl || '');
    setGalleryModal(ev);
  };

  const currentEvents = tab === 'upcoming' ? events.upcoming : events.past;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Galeries Clients</h1>
          <p className="text-sm text-gray-500 mt-1">
            Envoyez les galeries photos et collectez les avis Google
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => { setLoading(true); fetchEvents(); }}>
          <ArrowPathIcon className="h-4 w-4 mr-2" />
          Actualiser
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4 text-center">
          <div className="text-2xl font-bold text-primary-600">{events.upcoming.length}</div>
          <div className="text-xs text-gray-500">A venir</div>
        </Card>
        <Card className="p-4 text-center">
          <div className="text-2xl font-bold text-gray-600">{events.past.length}</div>
          <div className="text-xs text-gray-500">Passés</div>
        </Card>
        <Card className="p-4 text-center">
          <div className="text-2xl font-bold text-green-600">
            {[...events.upcoming, ...events.past].filter(e => e.booking?.status === 'gallery_sent').length}
          </div>
          <div className="text-xs text-gray-500">Galeries envoyées</div>
        </Card>
        <Card className="p-4 text-center">
          <div className="text-2xl font-bold text-amber-600">
            {[...events.upcoming, ...events.past].filter(e => e.booking?.status === 'review_matched' || e.booking?.status === 'review_detected').length}
          </div>
          <div className="text-xs text-gray-500">Avis collectés</div>
        </Card>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b">
        <button
          onClick={() => setTab('upcoming')}
          className={clsx(
            'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
            tab === 'upcoming' ? 'border-primary-500 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'
          )}
        >
          A venir ({events.upcoming.length})
        </button>
        <button
          onClick={() => setTab('past')}
          className={clsx(
            'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
            tab === 'past' ? 'border-primary-500 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'
          )}
        >
          Passés ({events.past.length})
        </button>
      </div>

      {/* Events List */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">Chargement...</div>
      ) : currentEvents.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <PhotoIcon className="h-12 w-12 mx-auto mb-3 opacity-50" />
          <p>Aucun événement {tab === 'upcoming' ? 'à venir' : 'passé'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {currentEvents.map((ev) => (
            <EventCard
              key={ev.googleEventId}
              event={ev}
              onSendReviewLink={() => openSendModal(ev)}
              onSendGalleryDirect={() => openSendGalleryModal(ev)}
              onCopyLink={() => handleCopyLink(ev)}
              onSetGalleryUrl={() => openGalleryModal(ev)}
            />
          ))}
        </div>
      )}

      {/* Send Email Modal */}
      <Modal
        isOpen={!!sendModal}
        onClose={() => setSendModal(null)}
        title={`Envoyer le lien — ${sendModal?.clientName}`}
      >
        {sendModal && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Le client recevra un lien unique. S'il laisse un avis Google, sa galerie sera disponible immédiatement.
              Sinon, elle sera accessible sous 24h.
            </p>

            <div>
              <label className="label">Email du client *</label>
              <Input
                type="email"
                value={sendEmail}
                onChange={(e) => setSendEmail(e.target.value)}
                placeholder="client@email.com"
              />
            </div>

            <div>
              <label className="label">Lien Google Drive (galerie photos)</label>
              <Input
                type="url"
                value={galleryUrlInput}
                onChange={(e) => setGalleryUrlInput(e.target.value)}
                placeholder="https://drive.google.com/drive/folders/..."
              />
              <p className="text-xs text-gray-400 mt-1">
                Ce lien sera débloqué après l'avis Google (ou sous 24h sans avis)
              </p>
            </div>

            {sendModal.booking?.publicUrl && (
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-gray-500 mb-1">Lien public existant :</p>
                <p className="text-sm font-mono text-primary-600 break-all">{sendModal.booking.publicUrl}</p>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setSendModal(null)}>Annuler</Button>
              <Button onClick={() => handleCreateAndSend(sendModal)} disabled={sending}>
                <PaperAirplaneIcon className="h-4 w-4 mr-2" />
                {sending ? 'Envoi...' : 'Envoyer le lien'}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Send Gallery Direct Modal */}
      <Modal
        isOpen={!!sendGalleryModal}
        onClose={() => setSendGalleryModal(null)}
        title={`Envoyer la galerie — ${sendGalleryModal?.clientName}`}
      >
        {sendGalleryModal && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Le client recevra directement le lien Google Drive contenant ses photos (sans passer par la page d'avis).
            </p>

            <div>
              <label className="label">Email du client *</label>
              <Input
                type="email"
                value={sendGalleryEmail}
                onChange={(e) => setSendGalleryEmail(e.target.value)}
                placeholder="client@email.com"
              />
            </div>

            <div>
              <label className="label">Lien Google Drive *</label>
              <Input
                type="url"
                value={sendGalleryUrl}
                onChange={(e) => setSendGalleryUrl(e.target.value)}
                placeholder="https://drive.google.com/drive/folders/..."
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setSendGalleryModal(null)}>Annuler</Button>
              <Button onClick={() => handleSendGalleryDirect(sendGalleryModal)} disabled={sendingGallery}>
                <FolderOpenIcon className="h-4 w-4 mr-2" />
                {sendingGallery ? 'Envoi...' : 'Envoyer la galerie'}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Gallery URL Modal */}
      <Modal
        isOpen={!!galleryModal}
        onClose={() => setGalleryModal(null)}
        title={`Galerie photos — ${galleryModal?.clientName}`}
      >
        {galleryModal && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Renseignez le lien Google Drive contenant les photos du client.
              Ce lien sera rendu accessible au client après son action (avis ou délai 24h).
            </p>

            <div>
              <label className="label">Lien Google Drive *</label>
              <Input
                type="url"
                value={galleryUrlEdit}
                onChange={(e) => setGalleryUrlEdit(e.target.value)}
                placeholder="https://drive.google.com/drive/folders/..."
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setGalleryModal(null)}>Annuler</Button>
              <Button onClick={() => handleSaveGalleryUrl(galleryModal)} disabled={savingGallery}>
                <FolderOpenIcon className="h-4 w-4 mr-2" />
                {savingGallery ? 'Enregistrement...' : 'Enregistrer'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function EventCard({ event, onSendReviewLink, onSendGalleryDirect, onCopyLink, onSetGalleryUrl }: {
  event: CalendarEvent;
  onSendReviewLink: () => void;
  onSendGalleryDirect: () => void;
  onCopyLink: () => void;
  onSetGalleryUrl: () => void;
}) {
  const booking = event.booking;
  const statusInfo = booking ? STATUS_LABELS[booking.status] || { label: booking.status, color: 'bg-gray-100 text-gray-600' } : null;

  return (
    <Card className="p-4">
      <div className="flex flex-col md:flex-row md:items-center gap-4">
        {/* Event Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-gray-900 truncate">{event.clientName}</h3>
            {event.produitNom && (
              <Badge variant="default" size="sm">{event.produitNom}</Badge>
            )}
            {statusInfo && (
              <span className={clsx('px-2 py-0.5 text-xs font-medium rounded-full', statusInfo.color)}>
                {statusInfo.label}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
            <span className="flex items-center gap-1">
              <CalendarDaysIcon className="h-4 w-4" />
              {formatDateRange(event.startDate, event.endDate)}
            </span>
            {event.adresse && (
              <span className="flex items-center gap-1 truncate">
                <MapPinIcon className="h-4 w-4 flex-shrink-0" />
                <span className="truncate">{event.adresse}</span>
              </span>
            )}
            {event.contactTelephone && (
              <a href={`tel:${event.contactTelephone}`} className="flex items-center gap-1 text-primary-600 hover:underline">
                <PhoneIcon className="h-4 w-4" />
                {event.contactTelephone}
              </a>
            )}
          </div>

          {/* Booking info line */}
          {booking && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-400 mt-1">
              {booking.customerEmail && (
                <span>Email: {booking.customerEmail}</span>
              )}
              {booking.galleryUrl && (
                <span className="flex items-center gap-1 text-green-600">
                  <FolderOpenIcon className="h-3 w-3" />
                  Drive configuré
                </span>
              )}
              {booking.emailSentAt && (
                <span className="flex items-center gap-1">
                  <CheckCircleIcon className="h-3 w-3 text-green-500" />
                  Envoyé le {new Date(booking.emailSentAt).toLocaleDateString('fr-FR')}
                </span>
              )}
              {booking._count.events > 0 && (
                <span className="flex items-center gap-1">
                  <EyeIcon className="h-3 w-3" />
                  {booking._count.events} visite{booking._count.events > 1 ? 's' : ''}
                </span>
              )}
              {booking._count.reviewMatches > 0 && (
                <span className="flex items-center gap-1 text-amber-600">
                  <StarIcon className="h-3 w-3" />
                  {booking._count.reviewMatches} avis
                </span>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button variant="outline" size="sm" onClick={onSetGalleryUrl} title="Configurer le lien Google Drive">
            <FolderOpenIcon className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={onCopyLink} title="Copier le lien d'avis">
            {booking ? <ClipboardDocumentIcon className="h-4 w-4" /> : <LinkIcon className="h-4 w-4" />}
          </Button>
          <Button variant="outline" size="sm" onClick={onSendReviewLink} title="Envoyer le lien d'avis Google">
            <StarIcon className="h-4 w-4 mr-1" />
            Avis
          </Button>
          <Button size="sm" onClick={onSendGalleryDirect} title="Envoyer directement la galerie photos">
            <PhotoIcon className="h-4 w-4 mr-1" />
            Galerie
          </Button>
        </div>
      </div>
    </Card>
  );
}

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
  StarIcon,
  EyeIcon,
  ArrowPathIcon,
  FolderOpenIcon,
  PencilIcon,
  CheckIcon,
  XMarkIcon,
  MagnifyingGlassIcon,
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
  const [search, setSearch] = useState('');

  // Modal states
  const [sendModal, setSendModal] = useState<CalendarEvent | null>(null);
  const [sendEmail, setSendEmail] = useState('');
  const [galleryUrlInput, setGalleryUrlInput] = useState('');
  const [sendBrand, setSendBrand] = useState<'SHOOTNBOX' | 'SMAKK'>('SHOOTNBOX');
  const [sending, setSending] = useState(false);

  // Send gallery directly modal
  const [sendGalleryModal, setSendGalleryModal] = useState<CalendarEvent | null>(null);
  const [sendGalleryEmail, setSendGalleryEmail] = useState('');
  const [sendGalleryUrl, setSendGalleryUrl] = useState('');
  const [sendGalleryBrand, setSendGalleryBrand] = useState<'SHOOTNBOX' | 'SMAKK'>('SHOOTNBOX');
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

      if (ev.booking && galleryUrlInput && galleryUrlInput !== ev.booking.galleryUrl) {
        await bookingsService.update(bookingId, { galleryUrl: galleryUrlInput } as any);
      }

      await bookingsService.sendLinkEmail(bookingId, sendEmail, sendBrand);
      toast.success(`Lien envoyé à ${sendEmail} via ${sendBrand}`);
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

  const handleCopyLink = async (ev: CalendarEvent) => {
    if (!ev.booking?.publicUrl) {
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
        await bookingsService.update(bookingId, { galleryUrl: sendGalleryUrl, customerEmail: sendGalleryEmail, senderBrand: sendGalleryBrand } as any);
      }

      await bookingsService.sendGallery(bookingId);
      toast.success(`Galerie envoyée à ${sendGalleryEmail} via ${sendGalleryBrand}`);
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

  const handleRename = async (ev: CalendarEvent, newName: string) => {
    if (!ev.booking?.id) return;
    try {
      await bookingsService.update(ev.booking.id, { customerName: newName } as any);
      toast.success('Nom mis à jour');
      fetchEvents();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Erreur');
    }
  };

  const openSendModal = (ev: CalendarEvent) => {
    setSendEmail(ev.booking?.customerEmail || '');
    setGalleryUrlInput(ev.booking?.galleryUrl || '');
    setSendBrand((ev.booking?.senderBrand as 'SHOOTNBOX' | 'SMAKK') || 'SHOOTNBOX');
    setSendModal(ev);
  };

  const openSendGalleryModal = (ev: CalendarEvent) => {
    setSendGalleryEmail(ev.booking?.customerEmail || '');
    setSendGalleryUrl(ev.booking?.galleryUrl || '');
    setSendGalleryBrand((ev.booking?.senderBrand as 'SHOOTNBOX' | 'SMAKK') || 'SHOOTNBOX');
    setSendGalleryModal(ev);
  };

  const filterBySearch = (list: CalendarEvent[]) => {
    if (!search.trim()) return list;
    const q = search.toLowerCase().trim();
    return list.filter(ev => {
      const name = (ev.booking?.customerName || ev.clientName).toLowerCase();
      return name.includes(q);
    });
  };

  const filteredUpcoming = filterBySearch(events.upcoming);
  const filteredPast = filterBySearch(events.past);
  const currentEvents = tab === 'upcoming' ? filteredUpcoming : filteredPast;

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

      {/* Search */}
      <div className="relative">
        <MagnifyingGlassIcon className="h-5 w-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher un client..."
          className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
            <XMarkIcon className="h-4 w-4" />
          </button>
        )}
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
          A venir ({filteredUpcoming.length})
        </button>
        <button
          onClick={() => setTab('past')}
          className={clsx(
            'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
            tab === 'past' ? 'border-primary-500 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'
          )}
        >
          Passés ({filteredPast.length})
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
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {currentEvents.map((ev) => (
            <EventCard
              key={ev.googleEventId}
              event={ev}
              onRename={(newName) => handleRename(ev, newName)}
              onSendReviewLink={() => openSendModal(ev)}
              onSendGalleryDirect={() => openSendGalleryModal(ev)}
              onCopyLink={() => handleCopyLink(ev)}
            />
          ))}
        </div>
      )}

      {/* Send Review Link Modal */}
      <Modal
        isOpen={!!sendModal}
        onClose={() => setSendModal(null)}
        title={`Envoyer le lien d'avis — ${sendModal?.booking?.customerName || sendModal?.clientName}`}
      >
        {sendModal && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Le client recevra un lien unique. S'il laisse un avis Google, sa galerie sera disponible immédiatement.
              Sinon, elle sera accessible sous 24h.
            </p>

            {/* Brand selector */}
            <div>
              <label className="label">Envoyer depuis *</label>
              <BrandSelector value={sendBrand} onChange={setSendBrand} />
            </div>

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
        title={`Envoyer la galerie — ${sendGalleryModal?.booking?.customerName || sendGalleryModal?.clientName}`}
      >
        {sendGalleryModal && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Le client recevra directement le lien Google Drive contenant ses photos (sans passer par la page d'avis).
            </p>

            {/* Brand selector */}
            <div>
              <label className="label">Envoyer depuis *</label>
              <BrandSelector value={sendGalleryBrand} onChange={setSendGalleryBrand} />
            </div>

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
    </div>
  );
}

function BrandSelector({ value, onChange }: { value: 'SHOOTNBOX' | 'SMAKK'; onChange: (v: 'SHOOTNBOX' | 'SMAKK') => void }) {
  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => onChange('SHOOTNBOX')}
        className={clsx(
          'flex-1 py-2.5 px-4 rounded-lg border-2 text-sm font-bold transition-all',
          value === 'SHOOTNBOX'
            ? 'border-orange-500 bg-orange-50 text-orange-700'
            : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
        )}
      >
        SHOOTNBOX
      </button>
      <button
        type="button"
        onClick={() => onChange('SMAKK')}
        className={clsx(
          'flex-1 py-2.5 px-4 rounded-lg border-2 text-sm font-bold transition-all',
          value === 'SMAKK'
            ? 'border-purple-500 bg-purple-50 text-purple-700'
            : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
        )}
      >
        SMAKK
      </button>
    </div>
  );
}

function EventCard({ event, onRename, onSendReviewLink, onSendGalleryDirect, onCopyLink }: {
  event: CalendarEvent;
  onRename: (newName: string) => void;
  onSendReviewLink: () => void;
  onSendGalleryDirect: () => void;
  onCopyLink: () => void;
}) {
  const booking = event.booking;
  // Only show status badge for meaningful statuses (not the default 'link_sent')
  const showStatus = booking && booking.status !== 'link_sent';
  const statusInfo = showStatus ? STATUS_LABELS[booking.status] || { label: booking.status, color: 'bg-gray-100 text-gray-600' } : null;

  const displayName = booking?.customerName || event.clientName;
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(displayName);

  const handleSaveRename = () => {
    const trimmed = editName.trim();
    if (!trimmed || trimmed === displayName) {
      setEditing(false);
      setEditName(displayName);
      return;
    }
    onRename(trimmed);
    setEditing(false);
  };

  const handleCancelRename = () => {
    setEditing(false);
    setEditName(displayName);
  };

  return (
    <Card className="p-4 flex flex-col justify-between">
      {/* Top: date + type de borne */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="flex items-center gap-1 text-sm text-gray-500">
            <CalendarDaysIcon className="h-4 w-4" />
            {formatDateRange(event.startDate, event.endDate)}
          </span>
          {statusInfo && (
            <span className={clsx('px-2 py-0.5 text-xs font-medium rounded-full whitespace-nowrap', statusInfo.color)}>
              {statusInfo.label}
            </span>
          )}
        </div>

        {/* Client Name - editable */}
        <div className="flex items-center gap-1.5 mb-2">
          {editing ? (
            <div className="flex items-center gap-1 flex-1">
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSaveRename(); if (e.key === 'Escape') handleCancelRename(); }}
                className="flex-1 border border-primary-300 rounded px-2 py-1 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary-500"
                autoFocus
              />
              <button onClick={handleSaveRename} className="p-1 text-green-600 hover:text-green-700">
                <CheckIcon className="h-4 w-4" />
              </button>
              <button onClick={handleCancelRename} className="p-1 text-gray-400 hover:text-gray-600">
                <XMarkIcon className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <>
              <h3 className="font-semibold text-gray-900 truncate">{displayName}</h3>
              {booking && (
                <button
                  onClick={() => { setEditName(displayName); setEditing(true); }}
                  className="p-0.5 text-gray-400 hover:text-primary-600 flex-shrink-0"
                  title="Modifier le nom du client"
                >
                  <PencilIcon className="h-3.5 w-3.5" />
                </button>
              )}
            </>
          )}
        </div>

        {/* Type de borne */}
        {event.produitNom && (
          <div className="mb-3">
            <Badge variant="default" size="sm">{event.produitNom}</Badge>
          </div>
        )}

        {/* Booking info */}
        {booking && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-400 mb-3">
            {booking.senderBrand && (
              <span className={clsx('px-1.5 py-0.5 rounded text-xs font-bold',
                booking.senderBrand === 'SHOOTNBOX' ? 'bg-orange-100 text-orange-700' : 'bg-purple-100 text-purple-700'
              )}>
                {booking.senderBrand}
              </span>
            )}
            {booking.galleryUrl && (
              <a href={booking.galleryUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-green-600 hover:underline">
                <FolderOpenIcon className="h-3 w-3" />
                Drive
              </a>
            )}
            {booking.emailSentAt && (
              <span className="flex items-center gap-1">
                <CheckCircleIcon className="h-3 w-3 text-green-500" />
                Envoyé {new Date(booking.emailSentAt).toLocaleDateString('fr-FR')}
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

      {/* Bottom: Actions */}
      <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
        {booking?.galleryUrl && (
          <Button variant="outline" size="sm" onClick={async () => {
            try {
              await navigator.clipboard.writeText(booking.galleryUrl!);
              toast.success('Lien Drive copié !');
            } catch { toast.error('Impossible de copier'); }
          }} title="Copier le lien Google Drive" className="flex-shrink-0">
            <FolderOpenIcon className="h-4 w-4" />
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={onCopyLink} title="Copier le lien d'avis" className="flex-shrink-0">
          {booking ? <ClipboardDocumentIcon className="h-4 w-4" /> : <LinkIcon className="h-4 w-4" />}
        </Button>
        <Button variant="outline" size="sm" onClick={onSendReviewLink} title="Envoyer le lien d'avis Google" className="flex-1">
          <StarIcon className="h-4 w-4 mr-1" />
          Avis
        </Button>
        <Button size="sm" onClick={onSendGalleryDirect} title="Envoyer directement la galerie photos" className="flex-1">
          <PhotoIcon className="h-4 w-4 mr-1" />
          Galerie
        </Button>
      </div>
    </Card>
  );
}

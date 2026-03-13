import { useState, useEffect, useCallback, useMemo } from 'react';
import { bookingsService, CalendarEvent } from '@/services/bookings.service';
import { Card, Button, Badge } from '@/components/ui';
import {
  PhotoIcon,
  PaperAirplaneIcon,
  ClipboardDocumentIcon,
  CheckCircleIcon,
  CalendarDaysIcon,
  ArrowPathIcon,
  FolderOpenIcon,
  PencilIcon,
  CheckIcon,
  XMarkIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import clsx from 'clsx';

/** Compute all badges to show for a booking (chronological: only show most advanced state) */
function getBookingBadges(booking: CalendarEvent['booking']): Array<{ label: string; color: string }> {
  if (!booking) return [];
  const badges: Array<{ label: string; color: string }> = [];

  const hasRating = !!booking.rating;
  const hasPageViewed = booking._count.events > 0 && ['page_viewed', 'rated_low', 'rated_high', 'review_clicked', 'no_review_selected', 'review_detected', 'review_matched', 'gallery_sent', 'manual_check_required', 'closed'].includes(booking.status);
  const hasGallerySent = booking.status === 'gallery_sent';
  const hasReviewConfirmed = booking.status === 'review_matched' || booking.status === 'review_detected';

  // 1. Lien envoyé — masqué dès que le client a ouvert la page
  if (booking.emailSentAt && !hasPageViewed) {
    badges.push({ label: 'Lien envoyé', color: 'bg-indigo-100 text-indigo-800' });
  }

  // 2. Page vue — masqué dès que le client a noté
  if (hasPageViewed && !hasRating) {
    badges.push({ label: 'Page vue', color: 'bg-sky-100 text-sky-800' });
  }

  // 3. Rating — toujours visible
  if (hasRating) {
    if (booking.rating! >= 4) {
      badges.push({ label: `${booking.rating}★`, color: 'bg-amber-100 text-amber-800' });
    } else {
      badges.push({ label: `${booking.rating}★`, color: 'bg-red-100 text-red-800' });
    }
  }

  // 4. Avis cliqué — masqué si avis confirmé
  if (booking.status === 'review_clicked' && !hasReviewConfirmed) {
    badges.push({ label: 'Avis cliqué', color: 'bg-amber-100 text-amber-700' });
  }

  // 5. Sans avis — masqué si photos envoyées
  if (booking.status === 'no_review_selected' && !hasGallerySent) {
    badges.push({ label: 'Sans avis', color: 'bg-gray-100 text-gray-700' });
  }

  // 6. Avis Google (état final — toujours visible)
  if (hasReviewConfirmed) {
    badges.push({ label: 'Avis Google', color: 'bg-green-100 text-green-800' });
  }

  // 7. Vérif. manuelle (action requise — toujours visible)
  if (booking.status === 'manual_check_required') {
    badges.push({ label: 'Vérif. manuelle', color: 'bg-red-100 text-red-800' });
  }

  // 8. Photos envoyées (état final — toujours visible)
  if (hasGallerySent) {
    badges.push({ label: 'Photos envoyées', color: 'bg-emerald-100 text-emerald-800' });
  }

  // 9. Photos non déchargées (alerte — toujours visible)
  if (booking.photosNotUnloaded) {
    badges.push({ label: '⚠️ Photos non déchargées', color: 'bg-amber-100 text-amber-800' });
  }

  return badges;
}

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

/** Build the public URL with brand query param */
function buildBrandUrl(publicUrl: string, brand: 'SHOOTNBOX' | 'SMAKK'): string {
  const url = new URL(publicUrl);
  url.searchParams.set('brand', brand);
  return url.toString();
}

export default function GaleriesClientsPage() {
  const [events, setEvents] = useState<{ upcoming: CalendarEvent[]; past: CalendarEvent[] }>({ upcoming: [], past: [] });
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const [search, setSearch] = useState('');
  const [starFilter, setStarFilter] = useState<number | null>(null); // null = all, 0 = no rating, 1-5 = specific

  const [sending, setSending] = useState(false);

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

  /** Ensure booking exists, return its id and publicUrl */
  const ensureBooking = async (ev: CalendarEvent): Promise<{ id: string; publicUrl: string }> => {
    if (ev.booking) return { id: ev.booking.id, publicUrl: ev.booking.publicUrl };
    const booking = await bookingsService.createFromEvent({
      googleEventId: ev.googleEventId,
      customerName: ev.clientName,
      eventDate: ev.startDate,
      eventEndDate: ev.endDate,
      produitNom: ev.produitNom || undefined,
    });
    fetchEvents();
    return { id: booking.id, publicUrl: booking.publicUrl! };
  };

  /** Copy the branded public URL */
  const handleCopyBrandUrl = async (ev: CalendarEvent, brand: 'SHOOTNBOX' | 'SMAKK') => {
    try {
      const { publicUrl } = await ensureBooking(ev);
      const url = buildBrandUrl(publicUrl, brand);
      await navigator.clipboard.writeText(url);
      toast.success(`Lien ${brand} copié !`);
    } catch {
      toast.error('Erreur lors de la copie');
    }
  };

  /** Copy Drive folder URL */
  const handleCopyDrive = async (galleryUrl: string) => {
    try {
      await navigator.clipboard.writeText(galleryUrl);
      toast.success('Lien Drive copié !');
    } catch {
      toast.error('Impossible de copier');
    }
  };

  /** Send Drive gallery link by email */
  const handleSendDrive = async (ev: CalendarEvent, brand: 'SHOOTNBOX' | 'SMAKK') => {
    if (!ev.booking?.id) return;
    if (!ev.booking?.customerEmail) {
      toast.error('Sauvegardez un email d\'abord');
      return;
    }
    setSending(true);
    try {
      await bookingsService.sendGallery(ev.booking.id, brand);
      toast.success(`Photos envoyées via ${brand} à ${ev.booking.customerEmail}`);
      fetchEvents();
    } catch (err: any) {
      toast.error(err?.message || "Erreur lors de l'envoi");
    } finally {
      setSending(false);
    }
  };

  /** Send branded URL by email */
  const handleSend = async (ev: CalendarEvent, brand: 'SHOOTNBOX' | 'SMAKK', email: string) => {
    if (!email.trim()) {
      toast.error('Email requis');
      return;
    }
    setSending(true);
    try {
      const { id } = await ensureBooking(ev);
      await bookingsService.sendLinkEmail(id, email, brand);
      toast.success(`Lien envoyé à ${email} via ${brand}`);
      fetchEvents();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Erreur lors de l'envoi");
    } finally {
      setSending(false);
    }
  };

  /** Save email on a booking */
  const handleSaveEmail = async (ev: CalendarEvent, email: string) => {
    try {
      const { id } = await ensureBooking(ev);
      await bookingsService.update(id, { customerEmail: email } as any);
      toast.success('Email sauvegardé');
      fetchEvents();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Erreur');
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

  const filterEvents = (list: CalendarEvent[]) => {
    let result = list;
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      result = result.filter(ev => (ev.booking?.customerName || ev.clientName).toLowerCase().includes(q));
    }
    if (starFilter !== null) {
      if (starFilter === 0) {
        result = result.filter(ev => !ev.booking?.rating);
      } else {
        result = result.filter(ev => ev.booking?.rating === starFilter);
      }
    }
    return result;
  };

  const filteredUpcoming = filterEvents(events.upcoming);
  const filteredPast = filterEvents(events.past);
  const currentEvents = tab === 'upcoming' ? filteredUpcoming : filteredPast;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">Galeries Clients</h1>
            <AverageRating events={[...events.upcoming, ...events.past]} />
          </div>
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

      {/* Star filter */}
      <StarFilter
        events={[...events.upcoming, ...events.past]}
        value={starFilter}
        onChange={setStarFilter}
      />

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
              onCopyDrive={() => ev.booking?.galleryUrl && handleCopyDrive(ev.booking.galleryUrl)}
              onCopyBrandUrl={(brand) => handleCopyBrandUrl(ev, brand)}
              onSendBrand={(brand, email) => handleSend(ev, brand, email)}
              onSendDrive={(brand) => handleSendDrive(ev, brand)}
              onSaveEmail={(email) => handleSaveEmail(ev, email)}
              sending={sending}
            />
          ))}
        </div>
      )}

    </div>
  );
}

function EventCard({ event, onRename, onCopyDrive, onCopyBrandUrl, onSendBrand, onSendDrive, onSaveEmail, sending }: {
  event: CalendarEvent;
  onRename: (newName: string) => void;
  onCopyDrive: () => void;
  onCopyBrandUrl: (brand: 'SHOOTNBOX' | 'SMAKK') => void;
  onSendBrand: (brand: 'SHOOTNBOX' | 'SMAKK', email: string) => void;
  onSendDrive: (brand: 'SHOOTNBOX' | 'SMAKK') => void;
  onSaveEmail: (email: string) => void;
  sending: boolean;
}) {
  const booking = event.booking;
  const badges = getBookingBadges(booking);

  const displayName = booking?.customerName || event.clientName;
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(displayName);
  const [emailValue, setEmailValue] = useState(booking?.customerEmail || '');
  const [emailSaved, setEmailSaved] = useState(!!booking?.customerEmail);
  const [savingEmail, setSavingEmail] = useState(false);

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

  const handleSaveEmail = async () => {
    const trimmed = emailValue.trim();
    if (!trimmed) return;
    setSavingEmail(true);
    onSaveEmail(trimmed);
    setEmailSaved(true);
    setSavingEmail(false);
  };

  const handleSendBrand = (brand: 'SHOOTNBOX' | 'SMAKK') => {
    const email = emailValue.trim();
    if (!email) {
      toast.error('Saisissez un email d\'abord');
      return;
    }
    onSendBrand(brand, email);
  };

  return (
    <Card className="p-4 flex flex-col justify-between">
      {/* Header: date + badges */}
      <div>
        <div className="flex items-start justify-between gap-2 mb-2">
          <span className="flex items-center gap-1 text-sm text-gray-500 flex-shrink-0">
            <CalendarDaysIcon className="h-4 w-4" />
            {formatDateRange(event.startDate, event.endDate)}
          </span>
          {badges.length > 0 && (
            <div className="flex flex-wrap justify-end gap-1">
              {badges.map((b, i) => (
                <span key={i} className={clsx('px-1.5 py-0.5 text-[10px] font-medium rounded-full whitespace-nowrap', b.color)}>
                  {b.label}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Client Name */}
        <div className="flex items-center gap-1.5 mb-2">
          {editing ? (
            <div className="flex items-center gap-1 flex-1">
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSaveRename(); if (e.key === 'Escape') { setEditing(false); setEditName(displayName); } }}
                className="flex-1 border border-primary-300 rounded px-2 py-1 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary-500"
                autoFocus
              />
              <button onClick={handleSaveRename} className="p-1 text-green-600 hover:text-green-700">
                <CheckIcon className="h-4 w-4" />
              </button>
              <button onClick={() => { setEditing(false); setEditName(displayName); }} className="p-1 text-gray-400 hover:text-gray-600">
                <XMarkIcon className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <>
              <h3 className="font-semibold text-gray-900 truncate">{displayName}</h3>
              {booking && (
                <button onClick={() => { setEditName(displayName); setEditing(true); }} className="p-0.5 text-gray-400 hover:text-primary-600 flex-shrink-0" title="Modifier le nom">
                  <PencilIcon className="h-3.5 w-3.5" />
                </button>
              )}
            </>
          )}
        </div>

        {/* Type de borne */}
        {event.produitNom && (
          <div className="mb-2">
            <Badge variant="default" size="sm">{event.produitNom}</Badge>
          </div>
        )}

        {/* Inline email field */}
        <div className="mb-3">
          <div className="flex items-center gap-1.5">
            <input
              type="email"
              name={`email-${event.googleEventId}`}
              autoComplete="off"
              value={emailValue}
              onChange={(e) => { setEmailValue(e.target.value); setEmailSaved(false); }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSaveEmail(); }}
              placeholder="Email du client"
              className={clsx(
                'flex-1 border rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary-500 transition-colors',
                emailSaved && emailValue ? 'border-green-300 bg-green-50' : 'border-gray-300 bg-white'
              )}
            />
            {emailValue && !emailSaved && (
              <button
                onClick={handleSaveEmail}
                disabled={savingEmail}
                className="p-1.5 rounded-lg text-white bg-primary-500 hover:bg-primary-600 transition-colors disabled:opacity-50"
                title="Sauvegarder l'email"
              >
                <CheckIcon className="h-3.5 w-3.5" />
              </button>
            )}
            {emailSaved && emailValue && (
              <CheckCircleIcon className="h-5 w-5 text-green-500 flex-shrink-0" />
            )}
          </div>
        </div>
      </div>

      {/* Actions — two columns: SHOOTNBOX | SMAKK */}
      <div className="pt-3 border-t border-gray-100">
        <div className="grid grid-cols-2 gap-2">
          {/* Column SHOOTNBOX */}
          <div className="space-y-1.5">
            <div className="text-[10px] font-bold text-orange-600 uppercase text-center tracking-wider">Shootnbox</div>
            {booking?.galleryUrl && (
              <button
                onClick={() => onSendDrive('SHOOTNBOX')}
                disabled={sending || !emailValue.trim()}
                className="w-full flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-xs font-semibold text-white bg-orange-500 hover:bg-orange-600 transition-colors disabled:opacity-50"
                title={emailValue.trim() ? `Envoyer lien Drive via SHOOTNBOX à ${emailValue}` : "Saisissez un email d'abord"}
              >
                <FolderOpenIcon className="h-3.5 w-3.5" />
                Envoyer Drive
              </button>
            )}
            <button
              onClick={() => onCopyBrandUrl('SHOOTNBOX')}
              className="w-full flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-xs font-semibold text-orange-700 bg-orange-50 hover:bg-orange-100 border border-orange-200 transition-colors"
              title="Copier le lien avis SHOOTNBOX"
            >
              <ClipboardDocumentIcon className="h-3.5 w-3.5" />
              Copier URL avis
            </button>
            <button
              onClick={() => handleSendBrand('SHOOTNBOX')}
              disabled={sending || !emailValue.trim()}
              className="w-full flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-xs font-semibold text-orange-700 bg-orange-50 hover:bg-orange-100 border border-orange-200 transition-colors disabled:opacity-50"
              title={emailValue.trim() ? `Envoyer lien avis SHOOTNBOX à ${emailValue}` : "Saisissez un email d'abord"}
            >
              <PaperAirplaneIcon className="h-3.5 w-3.5" />
              Envoyer URL avis
            </button>
          </div>

          {/* Column SMAKK */}
          <div className="space-y-1.5">
            <div className="text-[10px] font-bold text-purple-600 uppercase text-center tracking-wider">Smakk</div>
            {booking?.galleryUrl && (
              <button
                onClick={() => onSendDrive('SMAKK')}
                disabled={sending || !emailValue.trim()}
                className="w-full flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-xs font-semibold text-white bg-purple-600 hover:bg-purple-700 transition-colors disabled:opacity-50"
                title={emailValue.trim() ? `Envoyer lien Drive via SMAKK à ${emailValue}` : "Saisissez un email d'abord"}
              >
                <FolderOpenIcon className="h-3.5 w-3.5" />
                Envoyer Drive
              </button>
            )}
            <button
              onClick={() => onCopyBrandUrl('SMAKK')}
              className="w-full flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-xs font-semibold text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 transition-colors"
              title="Copier le lien avis SMAKK"
            >
              <ClipboardDocumentIcon className="h-3.5 w-3.5" />
              Copier URL avis
            </button>
            <button
              onClick={() => handleSendBrand('SMAKK')}
              disabled={sending || !emailValue.trim()}
              className="w-full flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-xs font-semibold text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 transition-colors disabled:opacity-50"
              title={emailValue.trim() ? `Envoyer lien avis SMAKK à ${emailValue}` : "Saisissez un email d'abord"}
            >
              <PaperAirplaneIcon className="h-3.5 w-3.5" />
              Envoyer URL avis
            </button>
          </div>
        </div>

        {/* Copier lien Drive (commun) */}
        {booking?.galleryUrl && (
          <button
            onClick={onCopyDrive}
            className="w-full mt-2 flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg text-xs text-green-700 bg-green-50 hover:bg-green-100 border border-green-200 transition-colors"
          >
            <FolderOpenIcon className="h-3.5 w-3.5" />
            Copier lien Drive
            <ClipboardDocumentIcon className="h-3 w-3 opacity-50" />
          </button>
        )}
      </div>
    </Card>
  );
}

const STAR_PATH = "M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z";

function AverageRating({ events }: { events: CalendarEvent[] }) {
  const { avg, count } = useMemo(() => {
    const ratings = events.map(e => e.booking?.rating).filter((r): r is number => !!r && r >= 1 && r <= 5);
    if (ratings.length === 0) return { avg: 0, count: 0 };
    return { avg: ratings.reduce((a, b) => a + b, 0) / ratings.length, count: ratings.length };
  }, [events]);

  if (count === 0) return null;

  return (
    <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-full px-3 py-1">
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((s) => (
          <svg key={s} className={clsx('h-4 w-4', s <= Math.round(avg) ? 'text-amber-400' : 'text-gray-200')} fill="currentColor" viewBox="0 0 24 24">
            <path d={STAR_PATH} />
          </svg>
        ))}
      </div>
      <span className="text-sm font-bold text-amber-700">{avg.toFixed(1)}</span>
      <span className="text-xs text-amber-500">({count})</span>
    </div>
  );
}

function StarFilter({ events, value, onChange }: {
  events: CalendarEvent[];
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  const counts = useMemo(() => {
    const map: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const ev of events) {
      const r = ev.booking?.rating;
      if (r && r >= 1 && r <= 5) map[r]++;
      else map[0]++;
    }
    return map;
  }, [events]);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-sm text-gray-500">Filtrer :</span>
      <button
        onClick={() => onChange(null)}
        className={clsx('px-3 py-1 rounded-full text-xs font-medium',
          value === null ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
        )}
      >
        Tous ({events.length})
      </button>
      {[5, 4, 3, 2, 1].map((s) => (
        <button
          key={s}
          onClick={() => onChange(value === s ? null : s)}
          className={clsx('flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium',
            value === s
              ? 'bg-amber-500 text-white'
              : counts[s] > 0
                ? 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                : 'bg-gray-50 text-gray-400'
          )}
        >
          {s}
          <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24"><path d={STAR_PATH} /></svg>
          <span className="opacity-70">({counts[s]})</span>
        </button>
      ))}
      <button
        onClick={() => onChange(value === 0 ? null : 0)}
        className={clsx('px-3 py-1 rounded-full text-xs font-medium',
          value === 0 ? 'bg-gray-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
        )}
      >
        Sans note ({counts[0]})
      </button>
    </div>
  );
}

import { useState, useEffect, useCallback, useMemo } from 'react';
import { bookingsService, CalendarEvent } from '@/services/bookings.service';
import { Card, Button, Badge, Modal, Input } from '@/components/ui';
import {
  PhotoIcon,
  PaperAirplaneIcon,
  ClipboardDocumentIcon,
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
  rated_low: { label: 'Note faible', color: 'bg-red-100 text-red-800' },
  rated_high: { label: 'Note haute', color: 'bg-green-100 text-green-800' },
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

  // Send modal state
  const [sendModal, setSendModal] = useState<{ event: CalendarEvent; brand: 'SHOOTNBOX' | 'SMAKK' } | null>(null);
  const [sendEmail, setSendEmail] = useState('');
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
      setSendModal(null);
      setSendEmail('');
      fetchEvents();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Erreur lors de l'envoi");
    } finally {
      setSending(false);
    }
  };

  /** Click send button: if email known, send directly; else open modal */
  const handleSendClick = (ev: CalendarEvent, brand: 'SHOOTNBOX' | 'SMAKK') => {
    const email = ev.booking?.customerEmail;
    if (email) {
      handleSend(ev, brand, email);
    } else {
      setSendEmail('');
      setSendModal({ event: ev, brand });
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
              onSendBrand={(brand) => handleSendClick(ev, brand)}
              sending={sending}
            />
          ))}
        </div>
      )}

      {/* Email Modal */}
      <Modal
        isOpen={!!sendModal}
        onClose={() => setSendModal(null)}
        title={`Envoyer via ${sendModal?.brand}`}
      >
        {sendModal && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Envoyer le lien de satisfaction à <strong>{sendModal.event.booking?.customerName || sendModal.event.clientName}</strong>
            </p>
            <div>
              <label className="label">Email du client *</label>
              <Input
                type="email"
                value={sendEmail}
                onChange={(e) => setSendEmail(e.target.value)}
                placeholder="client@email.com"
                onKeyDown={(e) => { if (e.key === 'Enter') handleSend(sendModal.event, sendModal.brand, sendEmail); }}
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setSendModal(null)}>Annuler</Button>
              <Button
                onClick={() => handleSend(sendModal.event, sendModal.brand, sendEmail)}
                disabled={sending}
                className={sendModal.brand === 'SMAKK' ? '!bg-purple-600 hover:!bg-purple-700' : '!bg-orange-500 hover:!bg-orange-600'}
              >
                <PaperAirplaneIcon className="h-4 w-4 mr-2" />
                {sending ? 'Envoi...' : 'Envoyer'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function EventCard({ event, onRename, onCopyDrive, onCopyBrandUrl, onSendBrand, sending }: {
  event: CalendarEvent;
  onRename: (newName: string) => void;
  onCopyDrive: () => void;
  onCopyBrandUrl: (brand: 'SHOOTNBOX' | 'SMAKK') => void;
  onSendBrand: (brand: 'SHOOTNBOX' | 'SMAKK') => void;
  sending: boolean;
}) {
  const booking = event.booking;
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

  return (
    <Card className="p-4 flex flex-col justify-between">
      {/* Header: date + status */}
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

        {/* Star rating */}
        {booking?.rating && (
          <div className="flex items-center gap-0.5 mb-2">
            {[1, 2, 3, 4, 5].map((s) => (
              <svg key={s} className={clsx('h-4 w-4', s <= booking.rating! ? 'text-amber-400' : 'text-gray-200')} fill="currentColor" viewBox="0 0 24 24">
                <path d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
              </svg>
            ))}
          </div>
        )}

        {/* Type de borne + infos */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {event.produitNom && <Badge variant="default" size="sm">{event.produitNom}</Badge>}
          {booking?.emailSentAt && (
            <span className="flex items-center gap-1 text-xs text-gray-400">
              <CheckCircleIcon className="h-3 w-3 text-green-500" />
              Envoyé {new Date(booking.emailSentAt).toLocaleDateString('fr-FR')}
            </span>
          )}
          {booking && booking._count.events > 0 && (
            <span className="flex items-center gap-1 text-xs text-gray-400">
              <EyeIcon className="h-3 w-3" />
              {booking._count.events}
            </span>
          )}
          {booking && booking._count.reviewMatches > 0 && (
            <span className="flex items-center gap-1 text-xs text-amber-600">
              <StarIcon className="h-3 w-3" />
              {booking._count.reviewMatches}
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="pt-3 border-t border-gray-100 space-y-2">
        {/* Row 1: Drive */}
        {booking?.galleryUrl && (
          <button
            onClick={onCopyDrive}
            className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-green-700 bg-green-50 hover:bg-green-100 border border-green-200 transition-colors"
          >
            <FolderOpenIcon className="h-4 w-4 flex-shrink-0" />
            <span className="truncate flex-1 text-left">Copier lien Drive</span>
            <ClipboardDocumentIcon className="h-3.5 w-3.5 flex-shrink-0 opacity-50" />
          </button>
        )}

        {/* Row 2: SHOOTNBOX — copier + envoyer */}
        <div className="flex gap-1.5">
          <button
            onClick={() => onCopyBrandUrl('SHOOTNBOX')}
            className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-bold text-orange-700 bg-orange-50 hover:bg-orange-100 border border-orange-200 transition-colors"
            title="Copier le lien avis SHOOTNBOX"
          >
            <ClipboardDocumentIcon className="h-3.5 w-3.5" />
            SHOOTNBOX
          </button>
          <button
            onClick={() => onSendBrand('SHOOTNBOX')}
            disabled={sending}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-orange-500 hover:bg-orange-600 transition-colors disabled:opacity-50"
            title="Envoyer par email via SHOOTNBOX"
          >
            <PaperAirplaneIcon className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Row 3: SMAKK — copier + envoyer */}
        <div className="flex gap-1.5">
          <button
            onClick={() => onCopyBrandUrl('SMAKK')}
            className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-bold text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 transition-colors"
            title="Copier le lien avis SMAKK"
          >
            <ClipboardDocumentIcon className="h-3.5 w-3.5" />
            SMAKK
          </button>
          <button
            onClick={() => onSendBrand('SMAKK')}
            disabled={sending}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 transition-colors disabled:opacity-50"
            title="Envoyer par email via SMAKK"
          >
            <PaperAirplaneIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </Card>
  );
}

const STAR_PATH = "M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z";

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

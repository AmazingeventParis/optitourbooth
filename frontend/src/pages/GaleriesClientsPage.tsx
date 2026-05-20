import { useState, useEffect, useCallback, useMemo } from 'react';
import { bookingsService, GalleryBooking } from '@/services/bookings.service';
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
  ChatBubbleLeftEllipsisIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import clsx from 'clsx';

function getBookingBadges(booking: GalleryBooking): Array<{ label: string; color: string }> {
  const badges: Array<{ label: string; color: string }> = [];

  const hasRating = !!booking.rating;
  const hasPageViewed = booking._count.events > 0 && ['page_viewed', 'rated_low', 'rated_high', 'review_clicked', 'no_review_selected', 'review_detected', 'review_matched', 'gallery_sent', 'manual_check_required', 'closed'].includes(booking.status);
  const hasGallerySent = booking.status === 'gallery_sent';
  const hasReviewConfirmed = booking.status === 'review_matched' || booking.status === 'review_detected';

  if (booking.emailSentAt && !hasPageViewed) {
    badges.push({ label: 'Lien envoyé', color: 'bg-indigo-100 text-indigo-800' });
  }
  if (hasPageViewed && !hasRating) {
    badges.push({ label: 'Page vue', color: 'bg-sky-100 text-sky-800' });
  }
  if (hasRating) {
    badges.push({ label: `${booking.rating}★`, color: booking.rating! >= 4 ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800' });
  }
  if (booking.status === 'review_clicked' && !hasReviewConfirmed) {
    badges.push({ label: 'Avis cliqué', color: 'bg-amber-100 text-amber-700' });
  }
  if (booking.status === 'no_review_selected' && !hasGallerySent) {
    badges.push({ label: 'Sans avis', color: 'bg-gray-100 text-gray-700' });
  }
  if (hasReviewConfirmed) {
    badges.push({ label: 'Avis Google', color: 'bg-green-100 text-green-800' });
  }
  if (booking.status === 'manual_check_required') {
    badges.push({ label: 'Vérif. manuelle', color: 'bg-red-100 text-red-800' });
  }
  if (hasGallerySent) {
    badges.push({ label: 'Photos envoyées', color: 'bg-emerald-100 text-emerald-800' });
  }
  if (booking.photosNotUnloaded) {
    badges.push({ label: '⚠️ Photos non déchargées', color: 'bg-amber-100 text-amber-800' });
  }
  if (!booking.galleryUrl) {
    badges.push({ label: 'Pas de dossier photo', color: 'bg-gray-100 text-gray-500' });
  } else {
    const count = booking.photoCount ?? 0;
    badges.push({
      label: count === 0 ? '0 photo' : `${count} photo${count > 1 ? 's' : ''}`,
      color: count === 0 ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-800',
    });
  }

  return badges;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr.substring(0, 10) + 'T12:00:00Z');
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateRange(start: string, end: string | null): string {
  const endStr = end || start;
  if (start === endStr) return formatDate(start);
  const s = new Date(start.substring(0, 10) + 'T12:00:00Z');
  const e = new Date(endStr.substring(0, 10) + 'T12:00:00Z');
  return `${s.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} → ${e.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

function getMonthOptions(bookings: GalleryBooking[]): Array<{ value: string; label: string; count: number }> {
  const map = new Map<string, number>();
  for (const b of bookings) {
    const d = new Date(b.eventDate.substring(0, 10) + 'T12:00:00Z');
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    map.set(key, (map.get(key) || 0) + 1);
  }
  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, count]) => {
      const [y, m] = key.split('-');
      const d = new Date(Number(y), Number(m) - 1, 15);
      const label = d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
      return { value: key, label: label.charAt(0).toUpperCase() + label.slice(1), count };
    });
}

function buildBrandUrl(publicUrl: string, brand: 'SHOOTNBOX' | 'SMAKK'): string {
  const url = new URL(publicUrl);
  url.searchParams.set('brand', brand);
  return url.toString();
}

export default function GaleriesClientsPage() {
  const [data, setData] = useState<{ upcoming: GalleryBooking[]; past: GalleryBooking[] }>({ upcoming: [], past: [] });
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'upcoming' | 'past' | 'archived'>('upcoming');
  const [search, setSearch] = useState('');
  const [starFilter, setStarFilter] = useState<number | null>(null);
  const [monthFilter, setMonthFilter] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    type: 'review' | 'gallery';
    booking: GalleryBooking;
    brand: 'SHOOTNBOX' | 'SMAKK';
    email?: string;
    sentAt: string;
  } | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const result = await bookingsService.getGalleryView();
      setData(result);
    } catch {
      toast.error('Erreur lors du chargement des galeries');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleCopyBrandUrl = async (booking: GalleryBooking, brand: 'SHOOTNBOX' | 'SMAKK') => {
    try {
      await navigator.clipboard.writeText(buildBrandUrl(booking.publicUrl, brand));
      toast.success(`Lien ${brand} copié !`);
    } catch {
      toast.error('Erreur lors de la copie');
    }
  };

  const handleCopyDrive = async (galleryUrl: string) => {
    try {
      await navigator.clipboard.writeText(galleryUrl);
      toast.success('Lien Drive copié !');
    } catch {
      toast.error('Impossible de copier');
    }
  };

  const handleSendDrive = async (booking: GalleryBooking, brand: 'SHOOTNBOX' | 'SMAKK') => {
    if (!booking.customerEmail) { toast.error("Sauvegardez un email d'abord"); return; }
    if (booking.status === 'gallery_sent') {
      setConfirmDialog({ type: 'gallery', booking, brand, sentAt: booking.gallerySentAt || '' });
      return;
    }
    await doSendDrive(booking, brand);
  };

  const doSendDrive = async (booking: GalleryBooking, brand: 'SHOOTNBOX' | 'SMAKK') => {
    setSending(true);
    try {
      await bookingsService.sendGallery(booking.id, brand);
      toast.success(`Photos envoyées via ${brand} à ${booking.customerEmail}`);
      fetchData();
    } catch (err: any) {
      toast.error(err?.message || "Erreur lors de l'envoi");
    } finally {
      setSending(false);
    }
  };

  const handleSend = async (booking: GalleryBooking, brand: 'SHOOTNBOX' | 'SMAKK', email: string) => {
    if (!email.trim()) { toast.error('Email requis'); return; }
    if (booking.emailSentAt) {
      setConfirmDialog({ type: 'review', booking, brand, email, sentAt: booking.emailSentAt });
      return;
    }
    await doSendReview(booking, brand, email);
  };

  const doSendReview = async (booking: GalleryBooking, brand: 'SHOOTNBOX' | 'SMAKK', email: string) => {
    setSending(true);
    try {
      await bookingsService.sendLinkEmail(booking.id, email, brand);
      toast.success(`Lien envoyé à ${email} via ${brand}`);
      fetchData();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Erreur lors de l'envoi");
    } finally {
      setSending(false);
    }
  };

  const handleSaveEmail = async (booking: GalleryBooking, email: string) => {
    try {
      await bookingsService.update(booking.id, { customerEmail: email } as any);
      toast.success('Email sauvegardé');
      fetchData();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Erreur');
    }
  };

  const handleSaveGalleryUrl = async (booking: GalleryBooking, url: string) => {
    try {
      await bookingsService.update(booking.id, { galleryUrl: url || null } as any);
      toast.success('URL Drive sauvegardée');
      fetchData();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Erreur');
    }
  };

  const handleRename = async (booking: GalleryBooking, newName: string) => {
    try {
      // Clear eventName so the manual rename takes effect (eventName has priority in display)
      await bookingsService.update(booking.id, { customerName: newName, eventName: null } as any);
      toast.success('Nom mis à jour');
      fetchData();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Erreur');
    }
  };

  const filterBookings = (list: GalleryBooking[]) => {
    let result = list;
    if (monthFilter) {
      result = result.filter(b => {
        const d = new Date(b.eventDate.substring(0, 10) + 'T12:00:00Z');
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        return key === monthFilter;
      });
    }
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      result = result.filter(b => (b.eventName || b.customerName).toLowerCase().includes(q));
    }
    if (starFilter !== null) {
      if (starFilter === 0) result = result.filter(b => !b.rating);
      else result = result.filter(b => b.rating === starFilter);
    }
    return result;
  };

  // Split past into "recent" (≤ 2 weeks) and "archived" (> 2 weeks)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);
  thirtyDaysAgo.setUTCHours(0, 0, 0, 0);
  const recentPast = data.past.filter(b => new Date(b.eventDate.substring(0, 10) + 'T12:00:00Z') >= thirtyDaysAgo);
  const archivedPast = data.past.filter(b => new Date(b.eventDate.substring(0, 10) + 'T12:00:00Z') < thirtyDaysAgo);

  const filteredUpcoming = filterBookings(data.upcoming);
  const filteredPast = filterBookings(recentPast);
  const filteredArchived = filterBookings(archivedPast);
  const current = tab === 'upcoming' ? filteredUpcoming : tab === 'past' ? filteredPast : filteredArchived;
  const allBookings = [...data.upcoming, ...data.past];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">Galeries Clients</h1>
            <AverageRating bookings={allBookings} />
          </div>
          <p className="text-sm text-gray-500 mt-1 hidden sm:block">
            Envoyez les galeries photos et collectez les avis Google
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={async () => {
            try {
              const result = await bookingsService.scanDriveFolders();
              toast.success(`Scan Drive : ${result.matched} nouveau(x) match(s), ${result.photoCountsUpdated} compteur(s) mis à jour`);
              fetchData();
            } catch {
              toast.error('Erreur lors du scan Drive');
            }
          }}>
            <FolderOpenIcon className="h-4 w-4 mr-2" />
            Scan Drive
          </Button>
          <Button variant="outline" size="sm" onClick={() => { setLoading(true); fetchData(); }}>
            <ArrowPathIcon className="h-4 w-4 mr-2" />
            Actualiser
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4 text-center">
          <div className="text-2xl font-bold text-primary-600">{data.upcoming.length}</div>
          <div className="text-xs text-gray-500">A venir</div>
        </Card>
        <Card className="p-4 text-center">
          <div className="text-2xl font-bold text-gray-600">{data.past.length}</div>
          <div className="text-xs text-gray-500">Passés</div>
        </Card>
        <Card className="p-4 text-center">
          <div className="text-2xl font-bold text-green-600">
            {allBookings.filter(b => b.status === 'gallery_sent').length}
          </div>
          <div className="text-xs text-gray-500">Galeries envoyées</div>
        </Card>
        <Card className="p-4 text-center">
          <div className="text-2xl font-bold text-amber-600">
            {allBookings.filter(b => b.rating != null).length}
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

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <CalendarDaysIcon className="h-4 w-4 text-gray-400" />
          <select
            value={monthFilter || ''}
            onChange={(e) => setMonthFilter(e.target.value || null)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 bg-white"
          >
            <option value="">Tous les mois</option>
            {getMonthOptions(tab === 'upcoming' ? data.upcoming : tab === 'past' ? recentPast : archivedPast).map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label} ({opt.count})</option>
            ))}
          </select>
          {monthFilter && (
            <button onClick={() => setMonthFilter(null)} className="text-gray-400 hover:text-gray-600">
              <XMarkIcon className="h-4 w-4" />
            </button>
          )}
        </div>
        <StarFilter bookings={allBookings} value={starFilter} onChange={setStarFilter} />
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b">
        <button
          onClick={() => { setTab('upcoming'); setMonthFilter(null); }}
          className={clsx('px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
            tab === 'upcoming' ? 'border-primary-500 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'
          )}
        >
          A venir ({filteredUpcoming.length})
        </button>
        <button
          onClick={() => { setTab('past'); setMonthFilter(null); }}
          className={clsx('px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
            tab === 'past' ? 'border-primary-500 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'
          )}
        >
          Passés ({filteredPast.length})
        </button>
        <button
          onClick={() => { setTab('archived'); setMonthFilter(null); }}
          className={clsx('px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
            tab === 'archived' ? 'border-primary-500 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'
          )}
        >
          Archives ({filteredArchived.length})
        </button>
      </div>

      {/* Cards */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">Chargement...</div>
      ) : current.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <PhotoIcon className="h-12 w-12 mx-auto mb-3 opacity-50" />
          <p>Aucun événement {tab === 'upcoming' ? 'à venir' : tab === 'past' ? 'passé (30 derniers jours)' : 'en archive'}</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
          {current.map((booking) => (
            <EventCard
              key={booking.id}
              booking={booking}
              onRename={(newName) => handleRename(booking, newName)}
              onCopyDrive={() => booking.galleryUrl && handleCopyDrive(booking.galleryUrl)}
              onCopyBrandUrl={(brand) => handleCopyBrandUrl(booking, brand)}
              onSendBrand={(brand, email) => handleSend(booking, brand, email)}
              onSendDrive={(brand) => handleSendDrive(booking, brand)}
              onSaveEmail={(email) => handleSaveEmail(booking, email)}
              onSaveGalleryUrl={(url) => handleSaveGalleryUrl(booking, url)}
              sending={sending}
            />
          ))}
        </div>
      )}

      {/* Confirm re-send dialog */}
      {confirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              {confirmDialog.type === 'review' ? "Email d'avis déjà envoyé" : 'Email de photos déjà envoyé'}
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              Un email {confirmDialog.type === 'review' ? "d'avis" : 'de photos'} a déjà été envoyé
              {confirmDialog.sentAt && (
                <> le <strong>{new Date(confirmDialog.sentAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })} à {new Date(confirmDialog.sentAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</strong></>
              )}.
              <br />Souhaitez-vous renvoyer ?
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setConfirmDialog(null)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">
                Fermer
              </button>
              <button
                onClick={async () => {
                  const { type, booking, brand, email } = confirmDialog;
                  setConfirmDialog(null);
                  if (type === 'review' && email) await doSendReview(booking, brand, email);
                  else if (type === 'gallery') await doSendDrive(booking, brand);
                }}
                disabled={sending}
                className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors disabled:opacity-50"
              >
                Envoyer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EventCard({ booking, onRename, onCopyDrive, onCopyBrandUrl, onSendBrand, onSendDrive, onSaveEmail, onSaveGalleryUrl, sending }: {
  booking: GalleryBooking;
  onRename: (newName: string) => void;
  onCopyDrive: () => void;
  onCopyBrandUrl: (brand: 'SHOOTNBOX' | 'SMAKK') => void;
  onSendBrand: (brand: 'SHOOTNBOX' | 'SMAKK', email: string) => void;
  onSendDrive: (brand: 'SHOOTNBOX' | 'SMAKK') => void;
  onSaveEmail: (email: string) => void;
  onSaveGalleryUrl: (url: string) => void;
  sending: boolean;
}) {
  const badges = getBookingBadges(booking);
  const displayName = booking.eventName || booking.customerName;
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(displayName);
  const [emailValue, setEmailValue] = useState(booking.customerEmail || '');
  const [emailSaved, setEmailSaved] = useState(!!booking.customerEmail);
  const [savingEmail, setSavingEmail] = useState(false);
  const [galleryUrlValue, setGalleryUrlValue] = useState(booking.galleryUrl || '');
  const [, setGalleryUrlSaved] = useState(!!booking.galleryUrl);
  const [editingGalleryUrl, setEditingGalleryUrl] = useState(false);

  const handleSaveRename = () => {
    const trimmed = editName.trim();
    if (!trimmed || trimmed === displayName) { setEditing(false); setEditName(displayName); return; }
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

  const handleSaveGalleryUrl = () => {
    const trimmed = galleryUrlValue.trim();
    onSaveGalleryUrl(trimmed);
    setGalleryUrlSaved(true);
    setEditingGalleryUrl(false);
  };

  const handleSendBrand = (brand: 'SHOOTNBOX' | 'SMAKK') => {
    const email = emailValue.trim();
    if (!email) { toast.error("Saisissez un email d'abord"); return; }
    onSendBrand(brand, email);
  };

  const activeBrand: 'SHOOTNBOX' | 'SMAKK' | null =
    booking.crmBrand === 'shootnbox' ? 'SHOOTNBOX' :
    booking.crmBrand === 'smakk' ? 'SMAKK' : null;

  return (
    <Card className="p-4 flex flex-col justify-between">
      <div>
        {/* Date + badges */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <span className="flex items-center gap-1 text-sm text-gray-500 flex-shrink-0">
            <CalendarDaysIcon className="h-4 w-4" />
            {formatDateRange(booking.eventDate, booking.eventEndDate)}
          </span>
          <div className="flex flex-wrap justify-end gap-1">
            {booking.internalFeedback && (
              <span
                title={booking.internalFeedback}
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-orange-100 text-orange-700 cursor-help whitespace-nowrap flex-shrink-0"
              >
                <ChatBubbleLeftEllipsisIcon className="h-3 w-3" />
                Commentaire
              </span>
            )}
            {badges.map((b, i) => (
              <span key={i} className={clsx('px-1.5 py-0.5 text-[10px] font-medium rounded-full whitespace-nowrap', b.color)}>
                {b.label}
              </span>
            ))}
          </div>
        </div>

        {/* Name */}
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
              <button onClick={handleSaveRename} className="p-1 text-green-600 hover:text-green-700"><CheckIcon className="h-4 w-4" /></button>
              <button onClick={() => { setEditing(false); setEditName(displayName); }} className="p-1 text-gray-400 hover:text-gray-600"><XMarkIcon className="h-4 w-4" /></button>
            </div>
          ) : (
            <>
              <h3 className="font-semibold text-gray-900 truncate">{displayName}</h3>
              <button onClick={() => { setEditName(displayName); setEditing(true); }} className="p-0.5 text-gray-400 hover:text-primary-600 flex-shrink-0" title="Modifier le nom">
                <PencilIcon className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>

        {/* Borne */}
        {booking.produitNom && (
          <div className="mb-2">
            <Badge variant="default" size="sm">{booking.produitNom}</Badge>
          </div>
        )}

        {/* Email */}
        <div className="mb-3">
          <div className="flex items-center gap-1.5">
            <input
              type="email"
              name={`email-${booking.id}`}
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
              <button onClick={handleSaveEmail} disabled={savingEmail} className="p-1.5 rounded-lg text-white bg-primary-500 hover:bg-primary-600 transition-colors disabled:opacity-50" title="Sauvegarder l'email">
                <CheckIcon className="h-3.5 w-3.5" />
              </button>
            )}
            {emailSaved && emailValue && <CheckCircleIcon className="h-5 w-5 text-green-500 flex-shrink-0" />}
          </div>
        </div>
      </div>

      {/* Actions — only the matching brand */}
      <div className="pt-3 border-t border-gray-100">
        {activeBrand === 'SHOOTNBOX' || activeBrand === null ? (
          <BrandActions
            brand="SHOOTNBOX"
            sending={sending}
            hasEmail={!!emailValue.trim()}
            hasGallery={!!booking.galleryUrl}
            onSendDrive={() => onSendDrive('SHOOTNBOX')}
            onCopyUrl={() => onCopyBrandUrl('SHOOTNBOX')}
            onSendUrl={() => handleSendBrand('SHOOTNBOX')}
          />
        ) : (
          <BrandActions
            brand="SMAKK"
            sending={sending}
            hasEmail={!!emailValue.trim()}
            hasGallery={!!booking.galleryUrl}
            onSendDrive={() => onSendDrive('SMAKK')}
            onCopyUrl={() => onCopyBrandUrl('SMAKK')}
            onSendUrl={() => handleSendBrand('SMAKK')}
          />
        )}

        {/* Drive link */}
        {editingGalleryUrl ? (
          <div className="mt-2 flex items-center gap-1.5">
            <input type="url" value={galleryUrlValue}
              onChange={(e) => { setGalleryUrlValue(e.target.value); setGalleryUrlSaved(false); }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSaveGalleryUrl(); if (e.key === 'Escape') setEditingGalleryUrl(false); }}
              placeholder="https://drive.google.com/drive/folders/..."
              className="flex-1 border border-gray-300 rounded px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
              autoFocus
            />
            <button onClick={handleSaveGalleryUrl} className="p-1.5 rounded-lg text-white bg-green-500 hover:bg-green-600 transition-colors"><CheckIcon className="h-3.5 w-3.5" /></button>
            <button onClick={() => { setEditingGalleryUrl(false); setGalleryUrlValue(booking.galleryUrl || ''); }} className="p-1.5 rounded-lg text-gray-500 bg-gray-100 hover:bg-gray-200 transition-colors"><XMarkIcon className="h-3.5 w-3.5" /></button>
          </div>
        ) : (
          <div className="mt-2 flex items-center gap-1.5">
            <button onClick={onCopyDrive} disabled={!booking.galleryUrl}
              className={clsx('flex-1 flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg text-xs border transition-colors',
                booking.galleryUrl ? 'text-green-700 bg-green-50 hover:bg-green-100 border-green-200 cursor-pointer' : 'text-gray-400 bg-gray-50 border-gray-200 cursor-not-allowed opacity-50'
              )}>
              <FolderOpenIcon className="h-3.5 w-3.5" />
              {booking.galleryUrl ? 'Copier lien Drive' : 'Pas de dossier Drive'}
              {booking.galleryUrl && <ClipboardDocumentIcon className="h-3 w-3 opacity-50" />}
            </button>
            <button onClick={() => setEditingGalleryUrl(true)} className="p-1.5 rounded-lg text-gray-500 bg-gray-100 hover:bg-gray-200 border border-gray-200 transition-colors" title="Renseigner / modifier l'URL Drive manuellement">
              <PencilIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </Card>
  );
}

function BrandActions({ brand, sending, hasEmail, hasGallery, onSendDrive, onCopyUrl, onSendUrl }: {
  brand: 'SHOOTNBOX' | 'SMAKK';
  sending: boolean;
  hasEmail: boolean;
  hasGallery: boolean;
  onSendDrive: () => void;
  onCopyUrl: () => void;
  onSendUrl: () => void;
}) {
  const isSnb = brand === 'SHOOTNBOX';
  const label = isSnb ? 'Shootnbox' : 'Smakk';
  const solidCls = isSnb
    ? 'text-white bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed'
    : 'text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed';
  const outlineCls = isSnb
    ? 'text-orange-700 bg-orange-50 hover:bg-orange-100 border border-orange-200 disabled:opacity-50'
    : 'text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 disabled:opacity-50';
  const labelCls = isSnb ? 'text-orange-600' : 'text-purple-600';

  return (
    <div className="space-y-1.5">
      <div className={clsx('text-[10px] font-bold uppercase text-center tracking-wider', labelCls)}>{label}</div>
      <button onClick={onSendDrive} disabled={sending || !hasEmail || !hasGallery}
        className={clsx('w-full flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-xs font-semibold transition-colors', solidCls)}>
        <FolderOpenIcon className="h-3.5 w-3.5" /> Envoyer Drive
      </button>
      <button onClick={onCopyUrl}
        className={clsx('w-full flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-xs font-semibold transition-colors', outlineCls)}>
        <ClipboardDocumentIcon className="h-3.5 w-3.5" /> Copier URL avis
      </button>
      <button onClick={onSendUrl} disabled={sending || !hasEmail}
        className={clsx('w-full flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-xs font-semibold transition-colors', outlineCls)}>
        <PaperAirplaneIcon className="h-3.5 w-3.5" /> Envoyer URL avis
      </button>
    </div>
  );
}

const STAR_PATH = "M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z";

function AverageRating({ bookings }: { bookings: GalleryBooking[] }) {
  const { avg, count } = useMemo(() => {
    const ratings = bookings.map(b => b.rating).filter((r): r is number => !!r && r >= 1 && r <= 5);
    if (ratings.length === 0) return { avg: 0, count: 0 };
    return { avg: ratings.reduce((a, b) => a + b, 0) / ratings.length, count: ratings.length };
  }, [bookings]);
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

function StarFilter({ bookings, value, onChange }: { bookings: GalleryBooking[]; value: number | null; onChange: (v: number | null) => void }) {
  const counts = useMemo(() => {
    const map: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const b of bookings) {
      const r = b.rating;
      if (r && r >= 1 && r <= 5) map[r]++;
      else map[0]++;
    }
    return map;
  }, [bookings]);
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-sm text-gray-500">Filtrer :</span>
      <button onClick={() => onChange(null)} className={clsx('px-3 py-1 rounded-full text-xs font-medium', value === null ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}>
        Tous ({bookings.length})
      </button>
      {[5, 4, 3, 2, 1].map((s) => (
        <button key={s} onClick={() => onChange(value === s ? null : s)}
          className={clsx('flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium',
            value === s ? 'bg-amber-500 text-white' : counts[s] > 0 ? 'bg-amber-50 text-amber-700 hover:bg-amber-100' : 'bg-gray-50 text-gray-400'
          )}>
          {s}<svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24"><path d={STAR_PATH} /></svg>
          <span className="opacity-70">({counts[s]})</span>
        </button>
      ))}
      <button onClick={() => onChange(value === 0 ? null : 0)} className={clsx('px-3 py-1 rounded-full text-xs font-medium', value === 0 ? 'bg-gray-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200')}>
        Sans note ({counts[0]})
      </button>
    </div>
  );
}

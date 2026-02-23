import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, Badge, Button, Modal, Input, Select, PhoneNumbers } from '@/components/ui';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { tourneesService } from '@/services/tournees.service';
import { useAuthStore } from '@/store/authStore';
import { useChauffeurStore } from '@/store/chauffeurStore';
import { useToast } from '@/hooks/useToast';
import { formatTimeRange } from '@/utils/format';
import {
  ArrowLeftIcon,
  MapPinIcon,
  ClockIcon,
  PhoneIcon,
  ArrowTopRightOnSquareIcon,
  CameraIcon,
  PhotoIcon,
  PencilSquareIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  DocumentTextIcon,
  PlusIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';

const getTypeConfig = (type: string) => {
  const configs: Record<string, { label: string; color: string }> = {
    livraison: { label: 'Livraison', color: 'bg-blue-100 text-blue-800' },
    ramassage: { label: 'Ramassage', color: 'bg-purple-100 text-purple-800' },
    livraison_ramassage: { label: 'Livraison + Ramassage', color: 'bg-indigo-100 text-indigo-800' },
  };
  return configs[type] || configs.livraison;
};

const incidentTypes = [
  { value: 'client_absent', label: 'Client absent' },
  { value: 'adresse_incorrecte', label: 'Adresse incorrecte' },
  { value: 'acces_impossible', label: 'Accès impossible' },
  { value: 'materiel_endommage', label: 'Matériel endommagé' },
  { value: 'retard_important', label: 'Retard important' },
  { value: 'autre', label: 'Autre' },
];

export default function ChauffeurPointPage() {
  const { pointId } = useParams<{ pointId: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { tournee, isLoading, fetchTournee, refreshTournee } = useChauffeurStore();
  const { success, error: showError } = useToast();

  const [isSaving, setIsSaving] = useState(false);

  // Modals
  const [isSignatureModalOpen, setIsSignatureModalOpen] = useState(false);
  const [isIncidentModalOpen, setIsIncidentModalOpen] = useState(false);
  const [isCompleteDialogOpen, setIsCompleteDialogOpen] = useState(false);

  // Signature / Commentaire client
  const [signatureName, setSignatureName] = useState('');
  const [clientComment, setClientComment] = useState('');

  // Incident
  const [incidentType, setIncidentType] = useState('');
  const [incidentDescription, setIncidentDescription] = useState('');

  // Photos
  const fileInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const [uploadingPhotos, setUploadingPhotos] = useState<string[]>([]); // Local previews during upload
  const [uploadedPhotos, setUploadedPhotos] = useState<Array<{ id: string; path: string; filename: string }>>([]); // Successfully uploaded photos

  // Get point from store
  const point = useMemo(() => {
    if (!tournee?.points || !pointId) return null;
    return tournee.points.find((p) => p.id === pointId) || null;
  }, [tournee?.points, pointId]);

  useEffect(() => {
    if (user?.id) {
      fetchTournee(user.id);
    }
  }, [user?.id, fetchTournee]);

  const handleCompletePoint = async () => {
    if (!tournee || !point) return;

    setIsSaving(true);
    try {
      await tourneesService.updatePoint(tournee.id, point.id, {
        statut: 'termine',
      });
      success('Point terminé');
      setIsCompleteDialogOpen(false);
      // Refresh tournee data before navigating
      await refreshTournee();
      navigate('/chauffeur/tournee');
    } catch (err) {
      showError('Erreur', (err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleReportIncident = async () => {
    if (!tournee || !point || !incidentType) return;

    setIsSaving(true);
    try {
      // Create incident record (this also updates point status)
      await tourneesService.createIncident(tournee.id, point.id, {
        type: incidentType as 'client_absent' | 'adresse_incorrecte' | 'acces_impossible' | 'materiel_endommage' | 'retard_important' | 'autre',
        description: incidentDescription || 'Incident signalé par le chauffeur',
      });

      success('Incident signalé');
      setIsIncidentModalOpen(false);
      // Refresh tournee data before navigating
      await refreshTournee();
      navigate('/chauffeur/tournee');
    } catch (err) {
      showError('Erreur', (err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveClientInfo = async () => {
    if (!tournee || !point) return;

    setIsSaving(true);
    try {
      await tourneesService.updatePoint(tournee.id, point.id, {
        signatureData: clientComment || undefined,
        signatureNom: signatureName || undefined,
      });

      success('Informations enregistrées');
      setIsSignatureModalOpen(false);
      refreshTournee();
    } catch (err) {
      showError('Erreur', (err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const handlePhotoCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !tournee || !point) return;

    const originalFiles = Array.from(files);

    // Reset file inputs immediately so they can be used again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    if (galleryInputRef.current) {
      galleryInputRef.current.value = '';
    }

    // Compress images before upload (10MB → 1.5MB)
    setIsSaving(true);
    let compressedFiles: File[];
    try {
      const { compressImages } = await import('@/utils/imageCompression');
      compressedFiles = await compressImages(originalFiles);
    } catch (err) {
      console.error('Compression error:', err);
      compressedFiles = originalFiles; // Fallback on original if compression fails
    }

    // Show local preview during upload
    const previews: string[] = [];
    for (const file of compressedFiles) {
      const reader = new FileReader();
      const preview = await new Promise<string>((resolve) => {
        reader.onload = (ev) => resolve(ev.target?.result as string);
        reader.readAsDataURL(file);
      });
      previews.push(preview);
    }
    setUploadingPhotos(previews);

    // Upload to server (but always keep photos visible locally)
    try {
      const result = await tourneesService.uploadPhotos(tournee.id, point.id, compressedFiles);

      // Check if upload actually returned photos from server
      const newPhotos = result as Array<{ id: string; path: string; filename: string }>;

      if (newPhotos && newPhotos.length > 0) {
        success(`${newPhotos.length} photo(s) ajoutée(s)`);
        // Use server URLs
        setUploadedPhotos(prev => [...prev, ...newPhotos]);
      } else {
        // Server didn't return photos - keep local previews
        success(`${previews.length} photo(s) enregistrée(s) localement`);
        setUploadedPhotos(prev => [...prev, ...previews.map((p, i) => ({
          id: `local-${Date.now()}-${i}`,
          path: p,
          filename: `photo-${i + 1}`,
        }))]);
      }
    } catch (err) {
      // Even on error, keep photos visible locally
      console.error('Upload error:', err);
      success(`${previews.length} photo(s) enregistrée(s) localement`);
      setUploadedPhotos(prev => [...prev, ...previews.map((p, i) => ({
        id: `local-${Date.now()}-${i}`,
        path: p,
        filename: `photo-${i + 1}`,
      }))]);
    } finally {
      setUploadingPhotos([]);
      setIsSaving(false);
    }
  };

  const openGoogleMaps = () => {
    if (!point?.client?.adresse) return;
    const address = encodeURIComponent(
      `${point.client.adresse}, ${point.client.codePostal} ${point.client.ville}`
    );
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${address}`, '_blank');
  };

  const openWaze = () => {
    if (!point?.client?.adresse) return;
    if (point.client.latitude && point.client.longitude) {
      window.open(`https://waze.com/ul?ll=${point.client.latitude},${point.client.longitude}&navigate=yes`, '_blank');
    } else {
      const address = encodeURIComponent(
        `${point.client.adresse}, ${point.client.codePostal} ${point.client.ville}`
      );
      window.open(`https://waze.com/ul?q=${address}`, '_blank');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600" />
      </div>
    );
  }

  if (!point || !tournee) {
    return (
      <div className="p-4">
        <Card className="p-8 text-center">
          <p className="text-gray-500">Point non trouvé</p>
          <Button variant="secondary" className="mt-4" onClick={() => navigate('/chauffeur/tournee')}>
            Retour
          </Button>
        </Card>
      </div>
    );
  }

  const typeConfig = getTypeConfig(point.type);
  const isActive = (point.statut === 'a_faire' || point.statut === 'en_cours') && tournee.statut === 'en_cours';

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate('/chauffeur/tournee')}>
          <ArrowLeftIcon className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="font-bold text-lg">Point #{point.ordre + 1}</h1>
          <span className={clsx('px-2 py-0.5 text-xs font-medium rounded', typeConfig.color)}>
            {typeConfig.label}
          </span>
        </div>
        <Badge
          variant={
            point.statut === 'termine'
              ? 'success'
              : point.statut === 'en_cours'
              ? 'warning'
              : point.statut === 'incident'
              ? 'danger'
              : 'default'
          }
        >
          {point.statut === 'termine'
            ? 'Terminé'
            : point.statut === 'en_cours'
            ? 'En cours'
            : point.statut === 'incident'
            ? 'Incident'
            : 'À faire'}
        </Badge>
      </div>

      {/* Client Info */}
      <Card className="p-4">
        <h2 className="font-semibold text-lg mb-3">{point.client?.nom}</h2>

        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <MapPinIcon className="h-5 w-5 text-gray-400 mt-0.5" />
            <div>
              <p>{point.client?.adresse}</p>
              {point.client?.complementAdresse && (
                <p className="text-sm text-gray-500">{point.client.complementAdresse}</p>
              )}
              <p className="text-sm text-gray-500">
                {point.client?.codePostal} {point.client?.ville}
              </p>
            </div>
          </div>

          {(point.creneauDebut || point.creneauFin) && (
            <div className="flex items-center gap-3">
              <ClockIcon className="h-5 w-5 text-gray-400" />
              <span>Créneau: {formatTimeRange(point.creneauDebut, point.creneauFin)}</span>
            </div>
          )}

          {point.client?.contactNom && (
            <div className="flex items-center gap-3">
              <PhoneIcon className="h-5 w-5 text-gray-400" />
              <div className="flex-1">
                <p className="font-medium mb-1">{point.client.contactNom}</p>
                {point.client.contactTelephone && (
                  <PhoneNumbers phones={point.client.contactTelephone} variant="links" size="md" />
                )}
              </div>
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="flex gap-2 mt-4">
          <Button variant="outline" className="flex-1" onClick={openGoogleMaps}>
            <ArrowTopRightOnSquareIcon className="h-4 w-4 mr-2" />
            Google Maps
          </Button>
          <Button variant="outline" className="flex-1" onClick={openWaze}>
            <ArrowTopRightOnSquareIcon className="h-4 w-4 mr-2" />
            Waze
          </Button>
        </div>
      </Card>

      {/* Instructions */}
      {(point.client?.instructionsAcces || point.notesClient) && (
        <Card className="p-4">
          <h3 className="font-semibold mb-2 flex items-center">
            <DocumentTextIcon className="h-5 w-5 mr-2" />
            Instructions
          </h3>
          {point.client?.instructionsAcces && (
            <p className="text-gray-600 mb-2">{point.client.instructionsAcces}</p>
          )}
          {point.notesClient && <p className="text-gray-600">{point.notesClient}</p>}
        </Card>
      )}

      {/* Products */}
      {point.produits && point.produits.length > 0 && (
        <Card className="p-4">
          <h3 className="font-semibold mb-3">Produits</h3>
          <div className="space-y-2">
            {point.produits.map((pp) => (
              <div
                key={pp.id}
                className="flex items-center justify-between p-2 bg-gray-50 rounded"
              >
                <span>{pp.produit?.nom}</span>
                <Badge variant="default">x{pp.quantite}</Badge>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Photos Section */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Photos ({(point.photos?.length || 0) + uploadedPhotos.length + uploadingPhotos.length})</h3>
          {isActive && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={isSaving}
              >
                <CameraIcon className="h-4 w-4 mr-1" />
                Appareil
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => galleryInputRef.current?.click()}
                disabled={isSaving}
              >
                <PhotoIcon className="h-4 w-4 mr-1" />
                Galerie
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handlePhotoCapture}
              />
              <input
                ref={galleryInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                multiple
                className="hidden"
                onChange={handlePhotoCapture}
              />
            </div>
          )}
        </div>
        {isActive && (
          <p className="text-xs text-gray-400 mb-3 -mt-1">Galerie : sélectionnez plusieurs photos d'un coup</p>
        )}

        <div className="grid grid-cols-3 gap-2">
          {/* Photos from server (existing before this session) */}
          {point.photos?.map((photo) => (
            <div key={photo.id} className="relative aspect-square">
              <img
                src={photo.path}
                alt={photo.filename}
                className="w-full h-full object-cover rounded"
              />
            </div>
          ))}
          {/* Photos uploaded in this session */}
          {uploadedPhotos.map((photo) => (
            <div key={photo.id} className="relative aspect-square">
              <img
                src={photo.path}
                alt={photo.filename}
                className="w-full h-full object-cover rounded"
              />
            </div>
          ))}
          {/* Local previews during upload */}
          {uploadingPhotos.map((preview, index) => (
            <div key={`uploading-${index}`} className="relative aspect-square">
              <img
                src={preview}
                alt={`Upload ${index + 1}`}
                className="w-full h-full object-cover rounded opacity-60"
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white" />
              </div>
            </div>
          ))}
          {/* Add more photos button in grid */}
          {isActive && !isSaving && (
            <button
              type="button"
              onClick={() => galleryInputRef.current?.click()}
              className="aspect-square rounded border-2 border-dashed border-gray-300 flex flex-col items-center justify-center text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-colors"
            >
              <PlusIcon className="h-8 w-8" />
              <span className="text-[10px] mt-1">Ajouter</span>
            </button>
          )}
        </div>
        {(point.photos?.length || 0) === 0 && uploadedPhotos.length === 0 && uploadingPhotos.length === 0 && !isActive && (
          <p className="text-gray-400 text-center py-4">Aucune photo</p>
        )}
      </Card>

      {/* Action Buttons */}
      {isActive && (
        <div className="space-y-3">
          <Button
            variant="outline"
            className="w-full"
            onClick={() => setIsSignatureModalOpen(true)}
          >
            <PencilSquareIcon className="h-5 w-5 mr-2" />
            Signature client
          </Button>

          <Button
            className="w-full"
            onClick={() => setIsCompleteDialogOpen(true)}
          >
            <CheckCircleIcon className="h-5 w-5 mr-2" />
            Terminer ce point
          </Button>

          <Button
            variant="danger"
            className="w-full"
            onClick={() => setIsIncidentModalOpen(true)}
          >
            <ExclamationTriangleIcon className="h-5 w-5 mr-2" />
            Signaler un incident
          </Button>
        </div>
      )}

      {/* Signature Modal */}
      <Modal
        isOpen={isSignatureModalOpen}
        onClose={() => setIsSignatureModalOpen(false)}
        title="Signature client"
      >
        <div className="space-y-4">
          <Input
            label="Nom du signataire (optionnel)"
            value={signatureName}
            onChange={(e) => setSignatureName(e.target.value)}
            placeholder="Nom et prénom"
          />

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Commentaire
            </label>
            <textarea
              value={clientComment}
              onChange={(e) => setClientComment(e.target.value)}
              rows={4}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              placeholder="Commentaire ou observations du client..."
            />
          </div>

          <div className="flex gap-3">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => setIsSignatureModalOpen(false)}
            >
              Annuler
            </Button>
            <Button
              className="flex-1"
              onClick={handleSaveClientInfo}
              isLoading={isSaving}
              disabled={!signatureName && !clientComment}
            >
              Enregistrer
            </Button>
          </div>
        </div>
      </Modal>

      {/* Incident Modal */}
      <Modal
        isOpen={isIncidentModalOpen}
        onClose={() => setIsIncidentModalOpen(false)}
        title="Signaler un incident"
      >
        <div className="space-y-4">
          <Select
            label="Type d'incident"
            value={incidentType}
            onChange={(e) => setIncidentType(e.target.value)}
            options={[
              { value: '', label: 'Sélectionner le type' },
              ...incidentTypes,
            ]}
            required
          />

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              value={incidentDescription}
              onChange={(e) => setIncidentDescription(e.target.value)}
              rows={4}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              placeholder="Décrivez l'incident..."
            />
          </div>

          <div className="flex gap-3">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => setIsIncidentModalOpen(false)}
            >
              Annuler
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              onClick={handleReportIncident}
              isLoading={isSaving}
              disabled={!incidentType}
            >
              Signaler
            </Button>
          </div>
        </div>
      </Modal>

      {/* Complete Confirmation */}
      <ConfirmDialog
        isOpen={isCompleteDialogOpen}
        onClose={() => setIsCompleteDialogOpen(false)}
        onConfirm={handleCompletePoint}
        title="Terminer le point"
        message="Confirmez-vous avoir terminé ce point ?"
        confirmText="Terminer"
        variant="warning"
        isLoading={isSaving}
      />
    </div>
  );
}

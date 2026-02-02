import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, Badge, Button, Modal, Input, Select } from '@/components/ui';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { tourneesService } from '@/services/tournees.service';
import { useToast } from '@/hooks/useToast';
import { Point, Tournee } from '@/types';
import { format } from 'date-fns';
import { formatTimeRange } from '@/utils/format';
import {
  ArrowLeftIcon,
  MapPinIcon,
  ClockIcon,
  PhoneIcon,
  ArrowTopRightOnSquareIcon,
  CameraIcon,
  PencilSquareIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  PlayIcon,
  XMarkIcon,
  DocumentTextIcon,
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
  const { success, error: showError } = useToast();

  const [tournee, setTournee] = useState<Tournee | null>(null);
  const [point, setPoint] = useState<Point | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Modals
  const [isSignatureModalOpen, setIsSignatureModalOpen] = useState(false);
  const [isIncidentModalOpen, setIsIncidentModalOpen] = useState(false);
  const [isCompleteDialogOpen, setIsCompleteDialogOpen] = useState(false);

  // Signature
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [signatureName, setSignatureName] = useState('');

  // Incident
  const [incidentType, setIncidentType] = useState('');
  const [incidentDescription, setIncidentDescription] = useState('');

  // Photos
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<string[]>([]);

  useEffect(() => {
    fetchPoint();
  }, [pointId]);

  const fetchPoint = async () => {
    if (!pointId) return;

    setIsLoading(true);
    try {
      // We need to find the tournee that contains this point
      const today = format(new Date(), 'yyyy-MM-dd');
      const result = await tourneesService.list({ date: today });

      for (const t of result.data) {
        const fullTournee = await tourneesService.getById(t.id);
        const foundPoint = fullTournee.points?.find((p) => p.id === pointId);
        if (foundPoint) {
          setTournee(fullTournee);
          setPoint(foundPoint);
          break;
        }
      }
    } catch (err) {
      showError('Erreur', (err as Error).message);
      navigate('/chauffeur/tournee');
    } finally {
      setIsLoading(false);
    }
  };

  const handleStartPoint = async () => {
    if (!tournee || !point) return;

    setIsSaving(true);
    try {
      await tourneesService.updatePoint(tournee.id, point.id, {
        statut: 'en_cours',
      });
      success('Point démarré');
      fetchPoint();
    } catch (err) {
      showError('Erreur', (err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCompletePoint = async () => {
    if (!tournee || !point) return;

    setIsSaving(true);
    try {
      await tourneesService.updatePoint(tournee.id, point.id, {
        statut: 'termine',
      });
      success('Point terminé');
      setIsCompleteDialogOpen(false);
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
      navigate('/chauffeur/tournee');
    } catch (err) {
      showError('Erreur', (err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  // Signature Canvas Functions
  const initCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
  };

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    setIsDrawing(true);
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = 'touches' in e ? e.touches[0].clientX - rect.left : e.clientX - rect.left;
    const y = 'touches' in e ? e.touches[0].clientY - rect.top : e.clientY - rect.top;

    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = 'touches' in e ? e.touches[0].clientX - rect.left : e.clientX - rect.left;
    const y = 'touches' in e ? e.touches[0].clientY - rect.top : e.clientY - rect.top;

    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const clearSignature = () => {
    initCanvas();
  };

  const handleSaveSignature = async () => {
    if (!canvasRef.current || !signatureName || !tournee || !point) {
      showError('Erreur', 'Veuillez signer et entrer un nom');
      return;
    }

    setIsSaving(true);
    try {
      const signatureData = canvasRef.current.toDataURL();

      await tourneesService.updatePoint(tournee.id, point.id, {
        signatureData,
        signatureNom: signatureName,
      });

      success('Signature enregistrée');
      setIsSignatureModalOpen(false);
    } catch (err) {
      showError('Erreur', (err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const handlePhotoCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !tournee || !point) return;

    const newFiles = Array.from(files);

    // Upload immediately to server
    setIsSaving(true);
    try {
      await tourneesService.uploadPhotos(tournee.id, point.id, newFiles);

      // Also show preview
      newFiles.forEach((file) => {
        const reader = new FileReader();
        reader.onload = (ev) => {
          if (ev.target?.result) {
            setPhotos((prev) => [...prev, ev.target!.result as string]);
          }
        };
        reader.readAsDataURL(file);
      });

      success(`${newFiles.length} photo(s) ajoutée(s)`);
    } catch (err) {
      showError('Erreur', (err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const openNavigation = () => {
    if (!point?.client?.latitude || !point?.client?.longitude) return;

    const address = encodeURIComponent(
      `${point.client.adresse}, ${point.client.codePostal} ${point.client.ville}`
    );
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${address}`, '_blank');
  };

  const callClient = (phone: string) => {
    window.location.href = `tel:${phone}`;
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
  const canStart = point.statut === 'a_faire' && tournee.statut === 'en_cours';
  const canComplete = point.statut === 'en_cours';
  const isActive = canStart || canComplete;

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
              <div>
                <p>{point.client.contactNom}</p>
                {point.client.contactTelephone && (
                  <button
                    onClick={() => callClient(point.client!.contactTelephone!)}
                    className="text-primary-600 underline"
                  >
                    {point.client.contactTelephone}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="flex gap-2 mt-4">
          <Button variant="outline" className="flex-1" onClick={openNavigation}>
            <ArrowTopRightOnSquareIcon className="h-4 w-4 mr-2" />
            Itinéraire
          </Button>
          {(point.client?.telephone || point.client?.contactTelephone) && (
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => callClient(point.client?.contactTelephone || point.client?.telephone || '')}
            >
              <PhoneIcon className="h-4 w-4 mr-2" />
              Appeler
            </Button>
          )}
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
      {isActive && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">Photos</h3>
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
            >
              <CameraIcon className="h-4 w-4 mr-1" />
              Ajouter
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              className="hidden"
              onChange={handlePhotoCapture}
            />
          </div>

          {photos.length > 0 ? (
            <div className="grid grid-cols-3 gap-2">
              {photos.map((photo, index) => (
                <div key={index} className="relative aspect-square">
                  <img
                    src={photo}
                    alt={`Photo ${index + 1}`}
                    className="w-full h-full object-cover rounded"
                  />
                  <button
                    onClick={() => setPhotos((prev) => prev.filter((_, i) => i !== index))}
                    className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1"
                  >
                    <XMarkIcon className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-400 text-center py-4">Aucune photo</p>
          )}
        </Card>
      )}

      {/* Action Buttons */}
      {isActive && (
        <div className="space-y-3">
          {canStart && (
            <Button className="w-full" onClick={handleStartPoint} isLoading={isSaving}>
              <PlayIcon className="h-5 w-5 mr-2" />
              Démarrer ce point
            </Button>
          )}

          {canComplete && (
            <>
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
            </>
          )}
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
            label="Nom du signataire"
            value={signatureName}
            onChange={(e) => setSignatureName(e.target.value)}
            placeholder="Nom et prénom"
          />

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Signature
            </label>
            <canvas
              ref={canvasRef}
              width={300}
              height={150}
              className="border rounded-lg w-full touch-none"
              onMouseDown={startDrawing}
              onMouseMove={draw}
              onMouseUp={stopDrawing}
              onMouseLeave={stopDrawing}
              onTouchStart={startDrawing}
              onTouchMove={draw}
              onTouchEnd={stopDrawing}
            />
            <Button
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={clearSignature}
            >
              Effacer
            </Button>
          </div>

          <div className="flex gap-3">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => setIsSignatureModalOpen(false)}
            >
              Annuler
            </Button>
            <Button className="flex-1" onClick={handleSaveSignature}>
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

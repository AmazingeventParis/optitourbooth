import { useState, useRef } from 'react';
import { Modal, Button, Badge } from '@/components/ui';
import { tourneesService, ImportParsedPoint, ImportResult } from '@/services/tournees.service';
import { useToast } from '@/hooks/useToast';
import {
  ArrowUpTrayIcon,
  DocumentArrowUpIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';

interface ImportExcelModalProps {
  isOpen: boolean;
  onClose: () => void;
  tourneeId: string;
  onSuccess: () => void;
}

type Step = 'upload' | 'preview' | 'result';

export default function ImportExcelModal({
  isOpen,
  onClose,
  tourneeId,
  onSuccess,
}: ImportExcelModalProps) {
  const { success, error: showError } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [previewData, setPreviewData] = useState<ImportParsedPoint[]>([]);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    setIsLoading(true);

    try {
      const result = await tourneesService.importPreview(tourneeId, selectedFile);
      setPreviewData(result.points);
      setStep('preview');
    } catch (err) {
      showError('Erreur', (err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleImport = async () => {
    if (!file) return;

    setIsLoading(true);
    try {
      const result = await tourneesService.importPoints(tourneeId, file);
      setImportResult(result);
      setStep('result');

      if (result.imported > 0) {
        success(`${result.imported} point(s) importé(s)`);
        onSuccess();
      }
    } catch (err) {
      showError('Erreur', (err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setStep('upload');
    setFile(null);
    setPreviewData([]);
    setImportResult(null);
    onClose();
  };

  const validPoints = previewData.filter(p => p.clientFound);
  const invalidPoints = previewData.filter(p => !p.clientFound);

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Importer des points depuis Excel"
      size="lg"
    >
      {step === 'upload' && (
        <div className="space-y-6">
          <div className="text-sm text-gray-600">
            <p className="mb-2">Importez un fichier Excel (.xlsx, .xls) ou CSV contenant vos points de livraison.</p>
            <p className="font-medium">Colonnes attendues :</p>
            <ul className="list-disc list-inside mt-1 text-gray-500">
              <li><strong>CLIENT</strong> - Nom du client (requis)</li>
              <li><strong>PRODUIT</strong> - Nom du produit</li>
              <li><strong>TYPE</strong> - Livraison, Ramassage ou Livraison + Ramassage</li>
              <li><strong>DEBUT CRENEAU</strong> - Heure de début (ex: 09:00)</li>
              <li><strong>FIN CRENEAU</strong> - Heure de fin (ex: 12:00)</li>
              <li><strong>CONTACT</strong> - Nom du contact sur place</li>
              <li><strong>TELEPHONE</strong> - Téléphone du contact</li>
              <li><strong>INFOS</strong> - Notes / informations</li>
            </ul>
          </div>

          <div
            onClick={() => fileInputRef.current?.click()}
            className={clsx(
              'border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors',
              'hover:border-primary-500 hover:bg-primary-50'
            )}
          >
            <DocumentArrowUpIcon className="h-12 w-12 mx-auto text-gray-400 mb-4" />
            <p className="text-gray-600 mb-2">
              Cliquez pour sélectionner un fichier
            </p>
            <p className="text-sm text-gray-400">
              .xlsx, .xls ou .csv (max 5 Mo)
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>

          {isLoading && (
            <div className="flex items-center justify-center py-4">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
              <span className="ml-3 text-gray-600">Analyse du fichier...</span>
            </div>
          )}

          <div className="flex justify-end">
            <Button variant="secondary" onClick={handleClose}>
              Annuler
            </Button>
          </div>
        </div>
      )}

      {step === 'preview' && (
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <Badge variant="success" size="md">
              <CheckCircleIcon className="h-4 w-4 mr-1" />
              {validPoints.length} valide(s)
            </Badge>
            {invalidPoints.length > 0 && (
              <Badge variant="danger" size="md">
                <XCircleIcon className="h-4 w-4 mr-1" />
                {invalidPoints.length} erreur(s)
              </Badge>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto border rounded-lg">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    Client
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    Produit
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    Type
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    Créneau
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    Statut
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {previewData.map((point, index) => (
                  <tr
                    key={index}
                    className={clsx(
                      !point.clientFound && 'bg-red-50'
                    )}
                  >
                    <td className="px-3 py-2 text-sm">
                      <div className="font-medium">{point.clientName}</div>
                      {point.contactNom && (
                        <div className="text-gray-500 text-xs">
                          Contact: {point.contactNom}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-sm">
                      {point.produitName || '-'}
                      {point.produitName && !point.produitFound && (
                        <span className="text-orange-500 text-xs ml-1">(non trouvé)</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-sm">
                      <Badge
                        variant={
                          point.type === 'livraison' ? 'success' :
                          point.type === 'ramassage' ? 'info' : 'warning'
                        }
                        size="sm"
                      >
                        {point.type === 'livraison' ? 'Livraison' :
                         point.type === 'ramassage' ? 'Ramassage' : 'Liv. + Ram.'}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-sm text-gray-500">
                      {point.creneauDebut || point.creneauFin
                        ? `${point.creneauDebut || '...'} - ${point.creneauFin || '...'}`
                        : '-'}
                    </td>
                    <td className="px-3 py-2">
                      {point.clientFound ? (
                        <CheckCircleIcon className="h-5 w-5 text-green-500" />
                      ) : (
                        <div className="flex items-center gap-1">
                          <ExclamationCircleIcon className="h-5 w-5 text-red-500" />
                          <span className="text-xs text-red-600">Client non trouvé</span>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {invalidPoints.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-sm text-amber-800">
                <ExclamationCircleIcon className="h-4 w-4 inline mr-1" />
                Les lignes avec des erreurs (clients non trouvés) seront ignorées lors de l'import.
                Assurez-vous que les clients existent dans la base de données.
              </p>
            </div>
          )}

          <div className="flex justify-between pt-4">
            <Button
              variant="secondary"
              onClick={() => {
                setStep('upload');
                setFile(null);
                setPreviewData([]);
              }}
            >
              Retour
            </Button>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={handleClose}>
                Annuler
              </Button>
              <Button
                onClick={handleImport}
                isLoading={isLoading}
                disabled={validPoints.length === 0}
              >
                <ArrowUpTrayIcon className="h-5 w-5 mr-2" />
                Importer {validPoints.length} point(s)
              </Button>
            </div>
          </div>
        </div>
      )}

      {step === 'result' && importResult && (
        <div className="space-y-4">
          <div className={clsx(
            'p-4 rounded-lg',
            importResult.errors.length === 0 ? 'bg-green-50' : 'bg-amber-50'
          )}>
            <div className="flex items-center gap-2 mb-2">
              {importResult.errors.length === 0 ? (
                <CheckCircleIcon className="h-6 w-6 text-green-500" />
              ) : (
                <ExclamationCircleIcon className="h-6 w-6 text-amber-500" />
              )}
              <span className="font-semibold text-lg">
                {importResult.imported} / {importResult.totalRows} point(s) importé(s)
              </span>
            </div>

            {importResult.errors.length > 0 && (
              <div className="mt-3">
                <p className="text-sm font-medium text-amber-800 mb-2">Erreurs :</p>
                <ul className="text-sm text-amber-700 space-y-1">
                  {importResult.errors.map((err, index) => (
                    <li key={index}>
                      Ligne {err.row}: {err.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="flex justify-end pt-4">
            <Button onClick={handleClose}>
              Fermer
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

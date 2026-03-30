import { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui';
import { machinesService } from '@/services/machines.service';
import { useToast } from '@/hooks/useToast';
import { Machine, MachineType } from '@/types';
import {
  ComputerDesktopIcon,
  CheckIcon,
  XMarkIcon,
  PencilIcon,
  ClipboardDocumentIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
  SignalIcon,
  SignalSlashIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';

const BORNE_TYPES: MachineType[] = ['Vegas', 'Smakk'];

const typeConfig: Record<string, { label: string; color: string; bg: string }> = {
  Vegas: { label: 'Vegas', color: 'text-amber-700', bg: 'bg-amber-50 border-amber-200' },
  Smakk: { label: 'Smakk', color: 'text-purple-700', bg: 'bg-purple-50 border-purple-200' },
};

function MachineRow({ machine, onSaveRemoteId }: {
  machine: Machine;
  onSaveRemoteId: (id: string, remoteId: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(machine.remoteId || '');
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const hasRemoteId = !!machine.remoteId;

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSaveRemoteId(machine.id, value.trim());
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditing(false);
    setValue(machine.remoteId || '');
  };

  const handleConnect = () => {
    if (!machine.remoteId) return;
    // Try RustDesk URI scheme first, fallback to clipboard
    const rustdeskUrl = `rustdesk://connection/new/${machine.remoteId}`;
    window.open(rustdeskUrl, '_blank');
    // Also copy to clipboard as fallback
    navigator.clipboard.writeText(machine.remoteId).then(() => {
      toast.success(`ID ${machine.remoteId} copie — ouvrez RustDesk si la fenetre ne s'est pas lancee`);
    });
  };

  const handleCopy = () => {
    if (!machine.remoteId) return;
    navigator.clipboard.writeText(machine.remoteId).then(() => {
      toast.success(`ID copie : ${machine.remoteId}`);
    });
  };

  return (
    <div className={clsx(
      'flex items-center gap-3 px-4 py-3 border-b border-gray-100 last:border-b-0 transition-colors',
      machine.aDefaut ? 'bg-red-50/50' : 'hover:bg-gray-50'
    )}>
      {/* Numero + status indicator */}
      <div className="flex items-center gap-2 w-20 flex-shrink-0">
        <div className={clsx(
          'w-2 h-2 rounded-full flex-shrink-0',
          hasRemoteId ? 'bg-green-500' : 'bg-gray-300'
        )} />
        <span className="font-mono font-bold text-sm text-gray-900">{machine.numero}</span>
      </div>

      {/* Defaut badge */}
      {machine.aDefaut && (
        <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-semibold flex-shrink-0">
          <ExclamationTriangleIcon className="h-3 w-3" />
          Defaut
        </span>
      )}

      {/* Remote ID — display or edit */}
      <div className="flex-1 min-w-0">
        {editing ? (
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') handleCancel(); }}
              placeholder="ID distant (ex: 847 293 102)"
              className="flex-1 border border-gray-300 rounded px-2.5 py-1 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
              disabled={saving}
            />
            <button
              onClick={handleSave}
              disabled={saving}
              className="p-1 rounded text-white bg-blue-500 hover:bg-blue-600 transition-colors disabled:opacity-50"
              title="Sauvegarder"
            >
              <CheckIcon className="h-4 w-4" />
            </button>
            <button
              onClick={handleCancel}
              className="p-1 rounded text-gray-500 bg-gray-100 hover:bg-gray-200 transition-colors"
              title="Annuler"
            >
              <XMarkIcon className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            {hasRemoteId ? (
              <span className="font-mono text-sm text-gray-700">{machine.remoteId}</span>
            ) : (
              <span className="text-sm text-gray-400 italic">Non configure</span>
            )}
            <button
              onClick={() => setEditing(true)}
              className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              title="Modifier l'ID distant"
            >
              <PencilIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {hasRemoteId && (
          <>
            <button
              onClick={handleCopy}
              className="p-1.5 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 border border-gray-200 transition-colors"
              title="Copier l'ID"
            >
              <ClipboardDocumentIcon className="h-4 w-4" />
            </button>
            <button
              onClick={handleConnect}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors"
              title="Prendre le controle via RustDesk"
            >
              <ComputerDesktopIcon className="h-4 w-4" />
              Connecter
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function TelemaintenancePage() {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'configured' | 'unconfigured'>('all');
  const toast = useToast();

  const fetchMachines = useCallback(async () => {
    try {
      setLoading(true);
      const results = await Promise.all(
        BORNE_TYPES.map(type => machinesService.list({ type, actif: true }))
      );
      setMachines(results.flat());
    } catch {
      toast.error('Erreur lors du chargement des machines');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchMachines(); }, [fetchMachines]);

  const handleSaveRemoteId = async (machineId: string, remoteId: string) => {
    try {
      await machinesService.updateRemoteId(machineId, remoteId);
      toast.success('ID distant sauvegarde');
      fetchMachines();
    } catch {
      toast.error('Erreur lors de la sauvegarde');
    }
  };

  const filteredMachines = machines.filter(m => {
    if (filter === 'configured') return !!m.remoteId;
    if (filter === 'unconfigured') return !m.remoteId;
    return true;
  });

  const configuredCount = machines.filter(m => m.remoteId).length;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ComputerDesktopIcon className="h-7 w-7 text-blue-600" />
            Telemaintenance
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Controle a distance des bornes Vegas et Smakk
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-sm text-gray-500">
            <SignalIcon className="h-4 w-4 text-green-500" />
            <span>{configuredCount} / {machines.length} configurees</span>
          </div>
          <button
            onClick={fetchMachines}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            <ArrowPathIcon className={clsx('h-4 w-4', loading && 'animate-spin')} />
            Rafraichir
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 mb-4">
        {[
          { key: 'all' as const, label: 'Toutes', count: machines.length },
          { key: 'configured' as const, label: 'Configurees', count: configuredCount, icon: SignalIcon },
          { key: 'unconfigured' as const, label: 'Non configurees', count: machines.length - configuredCount, icon: SignalSlashIcon },
        ].map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
              filter === f.key
                ? 'bg-blue-50 border-blue-200 text-blue-700'
                : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
            )}
          >
            {f.icon && <f.icon className="h-3.5 w-3.5" />}
            {f.label} ({f.count})
          </button>
        ))}
      </div>

      {/* Machine groups by type */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">Chargement...</div>
      ) : (
        BORNE_TYPES.map(type => {
          const typeMachines = filteredMachines.filter(m => m.type === type);
          if (typeMachines.length === 0) return null;
          const cfg = typeConfig[type] || { label: type, color: 'text-gray-700', bg: 'bg-gray-50 border-gray-200' };

          return (
            <Card key={type} className="mb-4 overflow-hidden">
              <div className={clsx('px-4 py-2.5 border-b', cfg.bg)}>
                <h2 className={clsx('font-bold text-sm', cfg.color)}>
                  {cfg.label}
                  <span className="ml-2 font-normal text-xs opacity-70">
                    ({typeMachines.length} machine{typeMachines.length > 1 ? 's' : ''})
                  </span>
                </h2>
              </div>
              <div>
                {typeMachines
                  .sort((a, b) => a.numero.localeCompare(b.numero, undefined, { numeric: true }))
                  .map(machine => (
                    <MachineRow
                      key={machine.id}
                      machine={machine}
                      onSaveRemoteId={handleSaveRemoteId}
                    />
                  ))
                }
              </div>
            </Card>
          );
        })
      )}
    </div>
  );
}

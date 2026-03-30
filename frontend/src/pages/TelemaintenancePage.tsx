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
  KeyIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';

const BORNE_TYPES: MachineType[] = ['Vegas', 'Smakk'];

const typeConfig: Record<string, { label: string; color: string; bg: string; headerColor: string }> = {
  Vegas: { label: 'Vegas', color: 'text-amber-700', bg: 'bg-amber-50 border-amber-200', headerColor: 'border-amber-300' },
  Smakk: { label: 'Smakk', color: 'text-purple-700', bg: 'bg-purple-50 border-purple-200', headerColor: 'border-purple-300' },
};

function MachineRow({ machine, onSaveRemoteId }: {
  machine: Machine;
  onSaveRemoteId: (id: string, remoteId: string, remotePassword?: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [idValue, setIdValue] = useState(machine.remoteId || '');
  const [pwdValue, setPwdValue] = useState(machine.remotePassword || '');
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const hasRemoteId = !!machine.remoteId;

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSaveRemoteId(machine.id, idValue.trim(), pwdValue.trim());
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditing(false);
    setIdValue(machine.remoteId || '');
    setPwdValue(machine.remotePassword || '');
  };

  const handleConnect = () => {
    if (!machine.remoteId) return;
    const rustdeskUrl = `rustdesk://connection/new/${machine.remoteId}`;
    window.open(rustdeskUrl, '_blank');
    navigator.clipboard.writeText(machine.remoteId).then(() => {
      toast.success(`ID ${machine.remoteId} copie — ouvrez RustDesk si la fenetre ne s'est pas lancee`);
    });
  };

  const handleCopyId = () => {
    if (!machine.remoteId) return;
    navigator.clipboard.writeText(machine.remoteId).then(() => {
      toast.success(`ID copie : ${machine.remoteId}`);
    });
  };

  const handleCopyPassword = () => {
    if (!machine.remotePassword) return;
    navigator.clipboard.writeText(machine.remotePassword).then(() => {
      toast.success('Mot de passe copie');
    });
  };

  return (
    <div className={clsx(
      'px-3 py-2.5 border-b border-gray-100 last:border-b-0 transition-colors',
      machine.aDefaut ? 'bg-red-50/50' : 'hover:bg-gray-50'
    )}>
      {editing ? (
        /* Mode edition */
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="font-mono font-bold text-sm text-gray-900 w-12">{machine.numero}</span>
            <input
              type="text"
              value={idValue}
              onChange={(e) => setIdValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') handleCancel(); }}
              placeholder="ID distant (ex: 847 293 102)"
              className="flex-1 border border-gray-300 rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
              disabled={saving}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-12 text-[10px] text-gray-400 text-right">MDP</span>
            <input
              type="text"
              value={pwdValue}
              onChange={(e) => setPwdValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') handleCancel(); }}
              placeholder="Mot de passe"
              className="flex-1 border border-gray-300 rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={saving}
            />
            <button onClick={handleSave} disabled={saving} className="p-1 rounded text-white bg-blue-500 hover:bg-blue-600 transition-colors disabled:opacity-50" title="Sauvegarder">
              <CheckIcon className="h-3.5 w-3.5" />
            </button>
            <button onClick={handleCancel} className="p-1 rounded text-gray-500 bg-gray-100 hover:bg-gray-200 transition-colors" title="Annuler">
              <XMarkIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ) : (
        /* Mode affichage */
        <div className="flex items-center gap-2">
          {/* Status dot + Numero */}
          <div className="flex items-center gap-2 w-14 flex-shrink-0">
            <div className={clsx('w-2 h-2 rounded-full flex-shrink-0', hasRemoteId ? 'bg-green-500' : 'bg-gray-300')} />
            <span className="font-mono font-bold text-sm text-gray-900">{machine.numero}</span>
          </div>

          {/* Defaut badge */}
          {machine.aDefaut && (
            <span className="flex items-center px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-semibold flex-shrink-0">
              <ExclamationTriangleIcon className="h-3 w-3" />
            </span>
          )}

          {/* Remote ID + password */}
          <div className="flex-1 min-w-0 flex items-center gap-1.5">
            {hasRemoteId ? (
              <>
                <span className="font-mono text-xs text-gray-700">{machine.remoteId}</span>
                {machine.remotePassword && (
                  <span className="text-[10px] text-gray-400">| ******</span>
                )}
              </>
            ) : (
              <span className="text-xs text-gray-400 italic">Non configure</span>
            )}
            <button onClick={() => setEditing(true)} className="p-0.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors" title="Modifier">
              <PencilIcon className="h-3 w-3" />
            </button>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 flex-shrink-0">
            {hasRemoteId && (
              <>
                <button onClick={handleCopyId} className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors" title="Copier l'ID">
                  <ClipboardDocumentIcon className="h-3.5 w-3.5" />
                </button>
                {machine.remotePassword && (
                  <button onClick={handleCopyPassword} className="p-1 rounded text-amber-400 hover:text-amber-600 hover:bg-amber-50 transition-colors" title="Copier le mot de passe">
                    <KeyIcon className="h-3.5 w-3.5" />
                  </button>
                )}
                <button onClick={handleConnect} className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors" title="Prendre le controle">
                  <ComputerDesktopIcon className="h-3.5 w-3.5" />
                  Connecter
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MachineColumn({ type, machines, filter, onSaveRemoteId }: {
  type: MachineType;
  machines: Machine[];
  filter: 'all' | 'online' | 'offline';
  onSaveRemoteId: (id: string, remoteId: string, remotePassword?: string) => Promise<void>;
}) {
  const cfg = typeConfig[type]!;

  const filtered = machines.filter(m => {
    if (filter === 'online') return !!m.remoteId;
    if (filter === 'offline') return !m.remoteId;
    return true;
  });

  const onlineCount = machines.filter(m => m.remoteId).length;

  return (
    <Card className="overflow-hidden h-fit">
      <div className={clsx('px-4 py-3 border-b-2', cfg.bg, cfg.headerColor)}>
        <div className="flex items-center justify-between">
          <h2 className={clsx('font-bold text-sm', cfg.color)}>
            {cfg.label}
          </h2>
          <div className="flex items-center gap-2 text-xs">
            <span className="flex items-center gap-1 text-green-600">
              <SignalIcon className="h-3.5 w-3.5" />
              {onlineCount}
            </span>
            <span className="text-gray-400">/</span>
            <span className="flex items-center gap-1 text-gray-400">
              <SignalSlashIcon className="h-3.5 w-3.5" />
              {machines.length - onlineCount}
            </span>
          </div>
        </div>
      </div>
      {filtered.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-gray-400">
          Aucune machine {filter === 'online' ? 'en ligne' : filter === 'offline' ? 'hors ligne' : ''}
        </div>
      ) : (
        <div>
          {filtered
            .sort((a, b) => a.numero.localeCompare(b.numero, undefined, { numeric: true }))
            .map(machine => (
              <MachineRow key={machine.id} machine={machine} onSaveRemoteId={onSaveRemoteId} />
            ))
          }
        </div>
      )}
    </Card>
  );
}

export default function TelemaintenancePage() {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'online' | 'offline'>('all');
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

  const handleSaveRemoteId = async (machineId: string, remoteId: string, remotePassword?: string) => {
    try {
      await machinesService.updateRemoteId(machineId, remoteId, remotePassword);
      toast.success('ID distant sauvegarde');
      fetchMachines();
    } catch {
      toast.error('Erreur lors de la sauvegarde');
    }
  };

  const onlineCount = machines.filter(m => m.remoteId).length;
  const offlineCount = machines.length - onlineCount;

  const vegasMachines = machines.filter(m => m.type === 'Vegas');
  const smakkMachines = machines.filter(m => m.type === 'Smakk');

  return (
    <div className="p-6">
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
        <button
          onClick={fetchMachines}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 transition-colors disabled:opacity-50"
        >
          <ArrowPathIcon className={clsx('h-4 w-4', loading && 'animate-spin')} />
          Rafraichir
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 mb-5">
        {[
          { key: 'all' as const, label: 'Toutes', count: machines.length, icon: null },
          { key: 'online' as const, label: 'En ligne', count: onlineCount, icon: SignalIcon, iconColor: 'text-green-500' },
          { key: 'offline' as const, label: 'Hors ligne', count: offlineCount, icon: SignalSlashIcon, iconColor: 'text-gray-400' },
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
            {f.icon && <f.icon className={clsx('h-3.5 w-3.5', filter === f.key ? 'text-blue-500' : f.iconColor)} />}
            {f.label} ({f.count})
          </button>
        ))}
      </div>

      {/* Two columns: Vegas | Smakk */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">Chargement...</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <MachineColumn type="Vegas" machines={vegasMachines} filter={filter} onSaveRemoteId={handleSaveRemoteId} />
          <MachineColumn type="Smakk" machines={smakkMachines} filter={filter} onSaveRemoteId={handleSaveRemoteId} />
        </div>
      )}
    </div>
  );
}

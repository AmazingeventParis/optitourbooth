import { useState } from 'react';
import {
  UserGroupIcon,
  UsersIcon,
  TruckIcon,
  CubeIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';

// Lazy-load the sub-pages to avoid a huge bundle
import ClientsPage from '@/pages/ClientsPage';
import UsersPage from '@/pages/UsersPage';
import VehiculesPage from '@/pages/VehiculesPage';
import ProduitsPage from '@/pages/ProduitsPage';

const TABS = [
  { key: 'clients', label: 'Clients', icon: UserGroupIcon },
  { key: 'utilisateurs', label: 'Utilisateurs', icon: UsersIcon },
  { key: 'vehicules', label: 'Véhicules', icon: TruckIcon },
  { key: 'produits', label: 'Produits', icon: CubeIcon },
] as const;

type TabKey = typeof TABS[number]['key'];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('clients');

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={clsx(
                'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
                isActive
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              )}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div>
        {activeTab === 'clients' && <ClientsPage />}
        {activeTab === 'utilisateurs' && <UsersPage />}
        {activeTab === 'vehicules' && <VehiculesPage />}
        {activeTab === 'produits' && <ProduitsPage />}
      </div>
    </div>
  );
}

import { Fragment, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Dialog, Transition, Menu } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import {
  HomeIcon,
  UserGroupIcon,
  UsersIcon,
  CubeIcon,
  ChartBarIcon,
  CalendarDaysIcon,
  ClockIcon,
  ArrowRightOnRectangleIcon,
  TruckIcon,
  EyeIcon,
  WrenchScrewdriverIcon,
  ArrowDownTrayIcon,
} from '@heroicons/react/24/outline';
import { useAuthStore, User } from '@/store/authStore';
import { useChauffeurs } from '@/hooks/queries/useUsers';
import { useInstallPWA } from '@/hooks/useInstallPWA';
import { useToast } from '@/hooks/useToast';
import Avatar from '@/components/ui/Avatar';
import { UserRole } from '@/types';
import clsx from 'clsx';

interface SidebarProps {
  open?: boolean;
  onClose?: () => void;
}

const navigation: Array<{
  name: string;
  href: string;
  icon: any;
  roles: UserRole[];
}> = [
  { name: 'Dashboard', href: '/', icon: HomeIcon, roles: ['admin'] },
  { name: 'Planning', href: '/planning', icon: CalendarDaysIcon, roles: ['admin'] },
  { name: 'Historique', href: '/historique', icon: ClockIcon, roles: ['admin'] },
  { name: 'Préparations', href: '/preparations', icon: WrenchScrewdriverIcon, roles: ['admin', 'preparateur'] },
  { name: 'Clients', href: '/clients', icon: UserGroupIcon, roles: ['admin'] },
  { name: 'Utilisateurs', href: '/utilisateurs', icon: UsersIcon, roles: ['admin'] },
  { name: 'Véhicules', href: '/vehicules', icon: TruckIcon, roles: ['admin'] },
  { name: 'Produits', href: '/produits', icon: CubeIcon, roles: ['admin'] },
  { name: 'Rapports', href: '/rapports', icon: ChartBarIcon, roles: ['admin'] },
];

function SidebarContent() {
  const { user, logout, startImpersonation } = useAuthStore();

  // Filtrer les liens selon le rôle de l'utilisateur
  const filteredNavigation = navigation.filter((item) =>
    item.roles.some((role) => user?.roles.includes(role))
  );
  const navigate = useNavigate();
  const { success, error: showError } = useToast();
  const [showChauffeurPicker, setShowChauffeurPicker] = useState(false);
  const { data: chauffeurs, isLoading: isLoadingChauffeurs } = useChauffeurs();
  const { isInstallable, installApp } = useInstallPWA();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleSelectChauffeur = (chauffeur: User) => {
    startImpersonation(chauffeur);
    setShowChauffeurPicker(false);
    navigate('/chauffeur');
  };

  const handleInstallApp = async () => {
    const installed = await installApp();
    if (installed) {
      success('Application installée avec succès !');
    } else {
      showError('Erreur', 'L\'installation a été annulée ou a échoué');
    }
  };

  return (
    <div className="flex grow flex-col gap-y-5 overflow-y-auto bg-primary-900 px-6 pb-4">
      {/* Logo + bouton menu mobile */}
      <div className="flex h-16 shrink-0 items-center justify-between">
        <div className="flex items-center">
          <div className="h-10 w-10 bg-white rounded-lg flex items-center justify-center">
            <svg
              className="h-6 w-6 text-primary-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
              />
            </svg>
          </div>
          <span className="ml-3 text-xl font-bold text-white">OptiTour</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex flex-1 flex-col">
        <ul role="list" className="flex flex-1 flex-col gap-y-7">
          <li>
            <ul role="list" className="-mx-2 space-y-1">
              {filteredNavigation.map((item) => (
                <li key={item.name}>
                  <NavLink
                    to={item.href}
                    className={({ isActive }) =>
                      clsx(
                        isActive
                          ? 'bg-primary-800 text-white'
                          : 'text-primary-200 hover:text-white hover:bg-primary-800',
                        'group flex gap-x-3 rounded-md p-2 text-sm leading-6 font-semibold'
                      )
                    }
                  >
                    <item.icon
                      className="h-6 w-6 shrink-0"
                      aria-hidden="true"
                    />
                    {item.name}
                  </NavLink>
                </li>
              ))}

              {/* Mode Chauffeur (admin uniquement) */}
              {user?.roles.includes('admin') && (
                <li>
                  <button
                    onClick={() => setShowChauffeurPicker(!showChauffeurPicker)}
                    className="w-full text-amber-300 hover:text-white hover:bg-primary-800 group flex gap-x-3 rounded-md p-2 text-sm leading-6 font-semibold"
                  >
                    <EyeIcon className="h-6 w-6 shrink-0" aria-hidden="true" />
                    Mode Chauffeur
                  </button>

                {/* Chauffeur Picker Dropdown */}
                {showChauffeurPicker && (
                  <div className="mt-1 mx-1 bg-primary-800 rounded-lg p-2 max-h-60 overflow-y-auto">
                    {isLoadingChauffeurs ? (
                      <div className="flex justify-center py-3">
                        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                      </div>
                    ) : chauffeurs && chauffeurs.length > 0 ? (
                      <div className="space-y-1">
                        {chauffeurs.map((c: User) => (
                          <button
                            key={c.id}
                            onClick={() => handleSelectChauffeur(c)}
                            className="w-full text-left px-3 py-2 rounded-md text-sm text-primary-200 hover:bg-primary-700 hover:text-white transition-colors flex items-center gap-2"
                          >
                            <Avatar user={c} size="sm" />
                            <span className="truncate">{c.prenom} {c.nom}</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-primary-400 text-center py-2">Aucun chauffeur</p>
                    )}
                  </div>
                )}
                </li>
              )}
            </ul>
          </li>

          {/* Profil utilisateur avec menu déconnexion */}
          <li className="mt-auto">
            <Menu as="div" className="relative">
              <Menu.Button className="w-full flex items-center gap-x-3 rounded-md bg-primary-800 p-3 text-sm hover:bg-primary-700 transition-colors cursor-pointer">
                {user && <Avatar user={user} size="md" />}
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-sm font-semibold text-white truncate">
                    {user?.prenom} {user?.nom}
                  </p>
                  <p className="text-xs text-primary-300 truncate capitalize">
                    {user?.roles.join(', ')}
                  </p>
                </div>
              </Menu.Button>

              <Transition
                as={Fragment}
                enter="transition ease-out duration-100"
                enterFrom="transform opacity-0 scale-95"
                enterTo="transform opacity-100 scale-100"
                leave="transition ease-in duration-75"
                leaveFrom="transform opacity-100 scale-100"
                leaveTo="transform opacity-0 scale-95"
              >
                <Menu.Items className="absolute bottom-full left-0 right-0 mb-2 rounded-md bg-white py-1 shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none">
                  {/* Bouton Installer l'app (affiché uniquement si installable) */}
                  {isInstallable && (
                    <Menu.Item>
                      {({ active }) => (
                        <button
                          onClick={handleInstallApp}
                          className={clsx(
                            active ? 'bg-gray-100' : '',
                            'flex w-full items-center px-4 py-2 text-sm text-primary-700'
                          )}
                        >
                          <ArrowDownTrayIcon className="mr-3 h-5 w-5 text-primary-600" />
                          Installer l'application
                        </button>
                      )}
                    </Menu.Item>
                  )}

                  {/* Bouton Déconnexion */}
                  <Menu.Item>
                    {({ active }) => (
                      <button
                        onClick={handleLogout}
                        className={clsx(
                          active ? 'bg-gray-100' : '',
                          'flex w-full items-center px-4 py-2 text-sm text-red-700'
                        )}
                      >
                        <ArrowRightOnRectangleIcon className="mr-3 h-5 w-5 text-red-500" />
                        Déconnexion
                      </button>
                    )}
                  </Menu.Item>
                </Menu.Items>
              </Transition>
            </Menu>
          </li>
        </ul>
      </nav>
    </div>
  );
}

export default function Sidebar({ open, onClose }: SidebarProps) {
  // Version mobile avec Dialog
  if (open !== undefined && onClose) {
    return (
      <Transition.Root show={open} as={Fragment}>
        <Dialog as="div" className="relative z-50 lg:hidden" onClose={onClose}>
          <Transition.Child
            as={Fragment}
            enter="transition-opacity ease-linear duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="transition-opacity ease-linear duration-300"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-gray-900/80" />
          </Transition.Child>

          <div className="fixed inset-0 flex">
            <Transition.Child
              as={Fragment}
              enter="transition ease-in-out duration-300 transform"
              enterFrom="-translate-x-full"
              enterTo="translate-x-0"
              leave="transition ease-in-out duration-300 transform"
              leaveFrom="translate-x-0"
              leaveTo="-translate-x-full"
            >
              <Dialog.Panel className="relative mr-16 flex w-full max-w-xs flex-1">
                <Transition.Child
                  as={Fragment}
                  enter="ease-in-out duration-300"
                  enterFrom="opacity-0"
                  enterTo="opacity-100"
                  leave="ease-in-out duration-300"
                  leaveFrom="opacity-100"
                  leaveTo="opacity-0"
                >
                  <div className="absolute left-full top-0 flex w-16 justify-center pt-5">
                    <button
                      type="button"
                      className="-m-2.5 p-2.5"
                      onClick={onClose}
                    >
                      <span className="sr-only">Fermer menu</span>
                      <XMarkIcon
                        className="h-6 w-6 text-white"
                        aria-hidden="true"
                      />
                    </button>
                  </div>
                </Transition.Child>
                <SidebarContent />
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </Dialog>
      </Transition.Root>
    );
  }

  // Version desktop
  return <SidebarContent />;
}

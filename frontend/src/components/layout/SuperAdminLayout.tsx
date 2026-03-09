import { useState, useEffect } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import {
  BuildingOffice2Icon,
  ArrowRightOnRectangleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';

const SIDEBAR_COLLAPSED_KEY = 'sidebar_collapsed';

const navigation = [
  { name: 'Tenants', href: '/super-admin', icon: BuildingOffice2Icon },
];

export default function SuperAdminLayout() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(() => {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
  });

  useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
  }, [collapsed]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Sidebar */}
      <div className={clsx(
        'fixed inset-y-0 z-50 flex flex-col transition-all duration-300',
        collapsed ? 'w-20' : 'w-64'
      )}>
        <div className="flex grow flex-col gap-y-5 overflow-y-auto bg-gray-900 px-3 pb-4">
          {/* Logo */}
          <div className="flex h-16 shrink-0 items-center">
            {collapsed ? (
              <span className="text-xl font-bold text-white w-full text-center">SA</span>
            ) : (
              <span className="text-xl font-bold text-white ml-3">OptiTour SA</span>
            )}
          </div>

          {/* Navigation */}
          <nav className="flex flex-1 flex-col">
            <ul className="flex flex-1 flex-col gap-y-7">
              <li>
                <ul className="-mx-1 space-y-1">
                  {navigation.map((item) => (
                    <li key={item.name}>
                      <NavLink
                        to={item.href}
                        end
                        title={collapsed ? item.name : undefined}
                        className={({ isActive }) =>
                          clsx(
                            'group flex items-center rounded-md p-2 text-sm font-semibold leading-6',
                            isActive
                              ? 'bg-gray-800 text-white'
                              : 'text-gray-400 hover:bg-gray-800 hover:text-white',
                            collapsed ? 'justify-center' : 'gap-x-3'
                          )
                        }
                      >
                        <item.icon className="h-6 w-6 shrink-0" aria-hidden="true" />
                        {!collapsed && item.name}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </li>

              {/* Bouton collapse */}
              <li>
                <button
                  onClick={() => setCollapsed(!collapsed)}
                  className="w-full flex items-center justify-center rounded-md p-2 text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
                  title={collapsed ? 'Développer le menu' : 'Réduire le menu'}
                >
                  {collapsed ? (
                    <ChevronRightIcon className="h-5 w-5" />
                  ) : (
                    <>
                      <ChevronLeftIcon className="h-5 w-5 mr-2" />
                      <span className="text-sm font-medium">Réduire</span>
                    </>
                  )}
                </button>
              </li>

              {/* Profile & Logout */}
              <li className="mt-auto">
                <div className={clsx(
                  'flex items-center px-2 py-3 text-sm text-gray-400',
                  collapsed ? 'justify-center' : 'gap-x-3'
                )}>
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-800 text-xs font-medium text-white flex-shrink-0">
                    {user?.prenom?.[0]}{user?.nom?.[0]}
                  </div>
                  {!collapsed && (
                    <div className="flex-1 truncate">
                      <p className="text-sm font-medium text-white truncate">
                        {user?.prenom} {user?.nom}
                      </p>
                      <p className="text-xs text-gray-500 truncate">{user?.email}</p>
                    </div>
                  )}
                </div>
                <button
                  onClick={handleLogout}
                  title={collapsed ? 'Déconnexion' : undefined}
                  className={clsx(
                    '-mx-1 flex w-full rounded-md p-2 text-sm font-semibold leading-6 text-gray-400 hover:bg-gray-800 hover:text-white',
                    collapsed ? 'justify-center' : 'gap-x-3'
                  )}
                >
                  <ArrowRightOnRectangleIcon className="h-6 w-6 shrink-0" aria-hidden="true" />
                  {!collapsed && 'Déconnexion'}
                </button>
              </li>
            </ul>
          </nav>
        </div>
      </div>

      {/* Main content */}
      <div className={clsx('transition-all duration-300', collapsed ? 'pl-20' : 'pl-64')}>
        <main className="py-6 px-4 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

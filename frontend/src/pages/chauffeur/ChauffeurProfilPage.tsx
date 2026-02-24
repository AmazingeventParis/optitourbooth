import { useState } from 'react';
import { Card, Button, Input } from '@/components/ui';
import { useAuthStore } from '@/store/authStore';
import { usersService } from '@/services/users.service';
import { useToast } from '@/hooks/useToast';
import { useDarkMode } from '@/hooks/useDarkMode';
import {
  UserCircleIcon,
  EnvelopeIcon,
  PhoneIcon,
  KeyIcon,
  SunIcon,
  MoonIcon,
  ComputerDesktopIcon,
} from '@heroicons/react/24/outline';

export default function ChauffeurProfilPage() {
  const { user, setAuth, token, refreshToken } = useAuthStore();
  const { success, error: showError } = useToast();
  const { theme, setTheme, isDark } = useDarkMode();

  const [isEditing, setIsEditing] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [formData, setFormData] = useState({
    prenom: user?.prenom || '',
    nom: user?.nom || '',
    telephone: user?.telephone || '',
  });

  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  const handleSaveProfile = async () => {
    if (!user) return;

    setIsSaving(true);
    try {
      const updated = await usersService.update(user.id, {
        prenom: formData.prenom,
        nom: formData.nom,
        telephone: formData.telephone || undefined,
      });

      // Update store
      if (token && refreshToken) {
        setAuth(updated, token, refreshToken);
      }

      success('Profil mis à jour');
      setIsEditing(false);
    } catch (err) {
      showError('Erreur', (err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (!user) return;

    if (passwordData.newPassword !== passwordData.confirmPassword) {
      showError('Erreur', 'Les mots de passe ne correspondent pas');
      return;
    }

    if (passwordData.newPassword.length < 6) {
      showError('Erreur', 'Le mot de passe doit contenir au moins 6 caractères');
      return;
    }

    setIsSaving(true);
    try {
      await usersService.update(user.id, {
        password: passwordData.newPassword,
      });

      success('Mot de passe modifié');
      setIsChangingPassword(false);
      setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err) {
      showError('Erreur', (err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Mon profil</h1>

      {/* Profile Card */}
      <Card className="p-4">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center">
            <UserCircleIcon className="h-10 w-10 text-primary-600" />
          </div>
          <div>
            <h2 className="font-semibold text-lg">
              {user?.prenom} {user?.nom}
            </h2>
            <p className="text-gray-500 capitalize">{user?.roles.join(', ')}</p>
          </div>
        </div>

        {isEditing ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Prénom"
                value={formData.prenom}
                onChange={(e) => setFormData({ ...formData, prenom: e.target.value })}
                required
              />
              <Input
                label="Nom"
                value={formData.nom}
                onChange={(e) => setFormData({ ...formData, nom: e.target.value })}
                required
              />
            </div>
            <Input
              label="Téléphone"
              type="tel"
              value={formData.telephone}
              onChange={(e) => setFormData({ ...formData, telephone: e.target.value })}
            />
            <div className="flex gap-3">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => {
                  setIsEditing(false);
                  setFormData({
                    prenom: user?.prenom || '',
                    nom: user?.nom || '',
                    telephone: user?.telephone || '',
                  });
                }}
              >
                Annuler
              </Button>
              <Button
                className="flex-1"
                onClick={handleSaveProfile}
                isLoading={isSaving}
              >
                Enregistrer
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-3 text-gray-600">
              <EnvelopeIcon className="h-5 w-5 text-gray-400" />
              <span>{user?.email}</span>
            </div>
            {user?.telephone && (
              <div className="flex items-center gap-3 text-gray-600">
                <PhoneIcon className="h-5 w-5 text-gray-400" />
                <span>{user.telephone}</span>
              </div>
            )}
            <Button
              variant="outline"
              className="w-full mt-4"
              onClick={() => setIsEditing(true)}
            >
              Modifier mes informations
            </Button>
          </div>
        )}
      </Card>

      {/* Password Card */}
      <Card className="p-4">
        <div className="flex items-center gap-3 mb-4">
          <KeyIcon className="h-6 w-6 text-gray-400" />
          <h3 className="font-semibold">Mot de passe</h3>
        </div>

        {isChangingPassword ? (
          <div className="space-y-4">
            <Input
              label="Nouveau mot de passe"
              type="password"
              value={passwordData.newPassword}
              onChange={(e) =>
                setPasswordData({ ...passwordData, newPassword: e.target.value })
              }
              required
            />
            <Input
              label="Confirmer le mot de passe"
              type="password"
              value={passwordData.confirmPassword}
              onChange={(e) =>
                setPasswordData({ ...passwordData, confirmPassword: e.target.value })
              }
              required
            />
            <div className="flex gap-3">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => {
                  setIsChangingPassword(false);
                  setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
                }}
              >
                Annuler
              </Button>
              <Button
                className="flex-1"
                onClick={handleChangePassword}
                isLoading={isSaving}
              >
                Changer
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            className="w-full"
            onClick={() => setIsChangingPassword(true)}
          >
            Changer mon mot de passe
          </Button>
        )}
      </Card>

      {/* Dark Mode */}
      <Card className="p-4">
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          {isDark ? <MoonIcon className="h-5 w-5" /> : <SunIcon className="h-5 w-5" />}
          Apparence
        </h3>
        <div className="flex gap-2">
          <button
            onClick={() => setTheme('light')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
              theme === 'light' ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            <SunIcon className="h-4 w-4" />
            Clair
          </button>
          <button
            onClick={() => setTheme('dark')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
              theme === 'dark' ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            <MoonIcon className="h-4 w-4" />
            Sombre
          </button>
          <button
            onClick={() => setTheme('system')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
              theme === 'system' ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            <ComputerDesktopIcon className="h-4 w-4" />
            Auto
          </button>
        </div>
      </Card>

      {/* App Info */}
      <Card className="p-4">
        <h3 className="font-semibold mb-2">À propos</h3>
        <div className="text-sm text-gray-500 space-y-1">
          <p>OptiTour v1.0.0</p>
          <p>Application de gestion des tournées</p>
        </div>
      </Card>
    </div>
  );
}

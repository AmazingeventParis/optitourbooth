import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { EyeIcon, EyeSlashIcon, DevicePhoneMobileIcon } from '@heroicons/react/24/outline';
import { useAuthStore } from '@/store/authStore';
import api from '@/services/api';

const loginSchema = z.object({
  email: z.string().email('Email invalide'),
  password: z.string().min(1, 'Mot de passe requis'),
});

type LoginForm = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginForm) => {
    setIsLoading(true);
    try {
      const response = await api.post('/auth/login', data);
      const { user, token, refreshToken } = response.data.data;

      setAuth(user, token, refreshToken);
      toast.success(`Bienvenue ${user.prenom} !`);

      // Rediriger selon le rôle
      if (user.roles.includes('superadmin')) {
        navigate('/super-admin');
      } else if (user.roles.includes('chauffeur') && !user.roles.includes('admin')) {
        navigate('/chauffeur');
      } else if (user.roles.includes('preparateur') && !user.roles.includes('admin') && !user.roles.includes('chauffeur')) {
        navigate('/preparations');
      } else {
        navigate('/');
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : 'Identifiants incorrects';
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-600 to-primary-900 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full">
        {/* Logo et titre */}
        <div className="text-center mb-8">
          <div className="mx-auto h-16 w-16 bg-white rounded-xl flex items-center justify-center shadow-lg mb-4">
            <svg
              className="h-10 w-10 text-primary-600"
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
          <h1 className="text-3xl font-bold text-white">OptiTour Booth</h1>
          <p className="mt-2 text-primary-200">
            Gestion de tournées photobooth
          </p>
        </div>

        {/* Formulaire */}
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-6">
            Connexion
          </h2>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            <div>
              <label htmlFor="email" className="label">
                Adresse email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                className={errors.email ? 'input-error' : 'input'}
                placeholder="votre@email.fr"
                {...register('email')}
              />
              {errors.email && (
                <p className="mt-1 text-sm text-red-600">
                  {errors.email.message}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="password" className="label">
                Mot de passe
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  className={errors.password ? 'input-error pr-10' : 'input pr-10'}
                  placeholder="••••••••"
                  {...register('password')}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? (
                    <EyeSlashIcon className="h-5 w-5" />
                  ) : (
                    <EyeIcon className="h-5 w-5" />
                  )}
                </button>
              </div>
              {errors.password && (
                <p className="mt-1 text-sm text-red-600">
                  {errors.password.message}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="btn-primary w-full"
            >
              {isLoading ? (
                <span className="flex items-center justify-center">
                  <svg
                    className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                  Connexion...
                </span>
              ) : (
                'Se connecter'
              )}
            </button>
          </form>

        </div>

        {/* Download app buttons */}
        <div className="mt-6 bg-white/10 backdrop-blur-sm rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <DevicePhoneMobileIcon className="h-5 w-5 text-primary-200" />
            <p className="text-sm font-medium text-white">
              Installer l'application mobile
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <a
              href="/downloads/optitour.apk"
              download="OptiTour.apk"
              className="flex items-center justify-center gap-2 px-4 py-3 bg-white rounded-xl text-gray-900 font-medium text-sm hover:bg-gray-100 transition-colors shadow-md"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.523 2.418a.502.502 0 00-.707.016l-1.839 1.886a6.745 6.745 0 00-2.478-.459c-.893 0-1.74.165-2.478.459L8.182 2.434a.502.502 0 00-.707-.016.502.502 0 00-.016.707l1.639 1.68C7.532 5.814 6.5 7.316 6.5 9h11c0-1.684-1.032-3.186-2.598-4.195l1.639-1.68a.502.502 0 00-.018-.707zM9.5 7.5a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm6.5 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM6 10v8a2 2 0 002 2h8a2 2 0 002-2v-8H6z"/>
              </svg>
              Android
            </a>
            <a
              href="https://testflight.apple.com/join/optitourbooth"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 px-4 py-3 bg-white rounded-xl text-gray-900 font-medium text-sm hover:bg-gray-100 transition-colors shadow-md"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
              </svg>
              iPhone
            </a>
          </div>
          <p className="text-xs text-primary-300 mt-2 text-center">
            Pour les chauffeurs : installez l'app pour recevoir les notifications
          </p>
        </div>
      </div>
    </div>
  );
}

import { useMemo } from 'react';
import rht from 'react-hot-toast';
import { ToastType } from '@/components/ui/Toast';

// IMPORTANT : l'ancien système (store Zustand + composant <Toast>) n'était monté
// NULLE PART dans l'app → tous les success()/error()/warning()/info() écrivaient
// dans le vide et restaient invisibles (toasts Sync, erreurs de drag, etc.).
// On délègue désormais à react-hot-toast, dont le <Toaster> est monté dans main.tsx.
// L'API publique (success/error/warning/info + toast/hideToast) est conservée pour
// ne casser aucun appelant.

const compose = (title: string, message?: string) =>
  message ? `${title} — ${message}` : title;

export function useToast() {
  return useMemo(
    () => ({
      success: (title: string, message?: string) => rht.success(compose(title, message)),
      error: (title: string, message?: string) => rht.error(compose(title, message)),
      warning: (title: string, message?: string) => rht(compose(title, message), { icon: '⚠️' }),
      info: (title: string, message?: string) => rht(compose(title, message), { icon: 'ℹ️' }),
      hideToast: () => rht.dismiss(),
      toast: { show: false, type: 'info' as ToastType, title: '', message: undefined as string | undefined },
    }),
    []
  );
}

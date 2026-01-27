import { useCallback, useMemo } from 'react';
import { create } from 'zustand';
import { ToastType } from '@/components/ui/Toast';

interface ToastState {
  show: boolean;
  type: ToastType;
  title: string;
  message?: string;
}

interface ToastStore {
  toast: ToastState;
  showToast: (type: ToastType, title: string, message?: string) => void;
  hideToast: () => void;
}

export const useToastStore = create<ToastStore>((set) => ({
  toast: {
    show: false,
    type: 'info',
    title: '',
    message: undefined,
  },
  showToast: (type, title, message) => {
    set({ toast: { show: true, type, title, message } });
    // Auto-hide after 5 seconds
    setTimeout(() => {
      set((state) => ({
        toast: { ...state.toast, show: false },
      }));
    }, 5000);
  },
  hideToast: () =>
    set((state) => ({ toast: { ...state.toast, show: false } })),
}));

export function useToast() {
  const { showToast, hideToast, toast } = useToastStore();

  const success = useCallback(
    (title: string, message?: string) => showToast('success', title, message),
    [showToast]
  );

  const error = useCallback(
    (title: string, message?: string) => showToast('error', title, message),
    [showToast]
  );

  const warning = useCallback(
    (title: string, message?: string) => showToast('warning', title, message),
    [showToast]
  );

  const info = useCallback(
    (title: string, message?: string) => showToast('info', title, message),
    [showToast]
  );

  return useMemo(
    () => ({
      toast,
      hideToast,
      success,
      error,
      warning,
      info,
    }),
    [toast, hideToast, success, error, warning, info]
  );
}

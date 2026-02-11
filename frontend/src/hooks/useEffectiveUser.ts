import { useAuthStore } from '@/store/authStore';

/**
 * Retourne l'utilisateur effectif (impersoné si actif, sinon le vrai user)
 * + booléen isImpersonating + le vrai user admin
 */
export function useEffectiveUser() {
  const { user, impersonatedChauffeur } = useAuthStore();
  return {
    effectiveUser: impersonatedChauffeur || user,
    isImpersonating: !!impersonatedChauffeur,
    realUser: user,
  };
}

import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { WifiIcon } from '@heroicons/react/24/outline';

export default function OfflineBanner() {
  const { isOnline } = useNetworkStatus();

  if (isOnline) return null;

  return (
    <div className="bg-yellow-500 text-white px-4 py-2 flex items-center gap-2 text-sm font-medium">
      <WifiIcon className="h-5 w-5 flex-shrink-0" />
      <span>Mode hors-ligne — Les données seront synchronisées au retour du réseau</span>
    </div>
  );
}

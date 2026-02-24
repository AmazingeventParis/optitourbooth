import { useNotificationStore } from '@/store/notificationStore';

interface NotificationBadgeProps {
  className?: string;
}

export default function NotificationBadge({ className }: NotificationBadgeProps) {
  const count = useNotificationStore((s) => s.notifications.filter((n) => !n.read).length);

  if (count === 0) return null;

  return (
    <span
      className={`absolute -top-1 -right-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold text-white bg-red-500 rounded-full ${className || ''}`}
    >
      {count > 9 ? '9+' : count}
    </span>
  );
}

import clsx from 'clsx';

interface AvatarUser {
  prenom?: string;
  nom?: string;
  avatarUrl?: string;
  couleur?: string;
}

interface AvatarProps {
  user: AvatarUser;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeClasses = {
  sm: 'h-7 w-7 text-xs',
  md: 'h-10 w-10 text-base',
  lg: 'h-16 w-16 text-xl',
};

export default function Avatar({ user, size = 'md', className }: AvatarProps) {
  const initials = `${user.prenom?.charAt(0) ?? ''}${user.nom?.charAt(0) ?? ''}`;

  if (user.avatarUrl) {
    return (
      <img
        src={user.avatarUrl}
        alt={`${user.prenom} ${user.nom}`}
        className={clsx(
          'rounded-full object-cover flex-shrink-0',
          sizeClasses[size],
          className
        )}
      />
    );
  }

  return (
    <div
      className={clsx(
        'rounded-full flex items-center justify-center font-semibold text-white flex-shrink-0',
        sizeClasses[size],
        className
      )}
      style={{ backgroundColor: user.couleur || '#1d4ed8' }}
    >
      {initials}
    </div>
  );
}

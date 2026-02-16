import { PhoneIcon } from '@heroicons/react/24/outline';

interface PhoneNumbersProps {
  phones: string | null | undefined;
  className?: string;
  variant?: 'badges' | 'links' | 'compact';
  size?: 'sm' | 'md' | 'lg';
}

/**
 * Composant pour afficher joliment des numéros de téléphone
 * Supporte plusieurs formats : badges colorés, liens cliquables, ou compact
 */
export default function PhoneNumbers({
  phones,
  className = '',
  variant = 'badges',
  size = 'md'
}: PhoneNumbersProps) {
  if (!phones || phones.trim() === '') {
    return null;
  }

  // Séparer les numéros (format stocké : "06 12 34 56 78, 07 98 76 54 32")
  const phoneList = phones
    .split(',')
    .map(p => p.trim())
    .filter(p => p.length > 0);

  if (phoneList.length === 0) {
    return null;
  }

  // Enlever les espaces pour les liens tel:
  const cleanPhone = (phone: string) => phone.replace(/\s/g, '');

  // Tailles selon le prop size
  const sizeClasses = {
    sm: 'text-xs px-2 py-0.5',
    md: 'text-sm px-2.5 py-1',
    lg: 'text-base px-3 py-1.5',
  };

  // Variante badges : pastilles colorées cliquables
  if (variant === 'badges') {
    return (
      <div className={`flex flex-wrap gap-2 ${className}`}>
        {phoneList.map((phone, index) => (
          <a
            key={index}
            href={`tel:${cleanPhone(phone)}`}
            className={`
              inline-flex items-center gap-1.5
              ${sizeClasses[size]}
              bg-blue-50 text-blue-700 hover:bg-blue-100
              border border-blue-200 rounded-full
              transition-colors duration-200
              font-medium
            `}
          >
            <PhoneIcon className="h-3.5 w-3.5" />
            {phone}
          </a>
        ))}
      </div>
    );
  }

  // Variante links : liens simples soulignés
  if (variant === 'links') {
    return (
      <div className={`flex flex-wrap gap-3 ${className}`}>
        {phoneList.map((phone, index) => (
          <a
            key={index}
            href={`tel:${cleanPhone(phone)}`}
            className={`
              ${size === 'sm' ? 'text-xs' : size === 'md' ? 'text-sm' : 'text-base'}
              text-primary-600 hover:text-primary-700
              underline decoration-1 underline-offset-2
              transition-colors duration-200
            `}
          >
            {phone}
          </a>
        ))}
      </div>
    );
  }

  // Variante compact : séparés par •
  if (variant === 'compact') {
    return (
      <div className={className}>
        {phoneList.map((phone, index) => (
          <span key={index}>
            <a
              href={`tel:${cleanPhone(phone)}`}
              className={`
                ${size === 'sm' ? 'text-xs' : size === 'md' ? 'text-sm' : 'text-base'}
                text-gray-700 hover:text-primary-600
                transition-colors duration-200
              `}
            >
              {phone}
            </a>
            {index < phoneList.length - 1 && (
              <span className="mx-2 text-gray-400">•</span>
            )}
          </span>
        ))}
      </div>
    );
  }

  return null;
}

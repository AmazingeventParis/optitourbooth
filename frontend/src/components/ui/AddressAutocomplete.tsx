import { useState, useEffect, useRef, useCallback } from 'react';
import { clsx } from 'clsx';
import { MapPinIcon, UserIcon } from '@heroicons/react/24/outline';

export interface AddressResult {
  label: string;
  adresse: string;
  codePostal: string;
  ville: string;
  latitude?: number;
  longitude?: number;
  source: 'client' | 'api';
  clientId?: string;
  clientNom?: string;
}

interface AddressAutocompleteProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  onSelect: (result: AddressResult) => void;
  placeholder?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  clients?: Array<{
    id: string;
    nom: string;
    societe?: string | null;
    adresse: string;
    codePostal?: string | null;
    ville?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  }>;
}

export default function AddressAutocomplete({
  label,
  value,
  onChange,
  onSelect,
  placeholder = 'Tapez une adresse...',
  error,
  required,
  disabled,
  className,
  clients = [],
}: AddressAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<AddressResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const abortRef = useRef<AbortController>();

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const searchAddresses = useCallback(
    async (query: string) => {
      if (query.length < 3) {
        setSuggestions([]);
        setIsOpen(false);
        return;
      }

      setIsLoading(true);
      const results: AddressResult[] = [];

      // 1. Search in existing clients
      const queryLower = query.toLowerCase().replace(/\s+/g, '');
      const clientResults = clients
        .filter((c) => {
          const fullAddress = `${c.adresse} ${c.codePostal || ''} ${c.ville || ''}`.toLowerCase().replace(/\s+/g, '');
          const clientName = `${c.nom} ${c.societe || ''}`.toLowerCase().replace(/\s+/g, '');
          return fullAddress.includes(queryLower) || clientName.includes(queryLower);
        })
        .slice(0, 5)
        .map((c) => ({
          label: `${c.nom}${c.societe ? ` (${c.societe})` : ''} - ${c.adresse}, ${c.codePostal || ''} ${c.ville || ''}`,
          adresse: c.adresse,
          codePostal: c.codePostal || '',
          ville: c.ville || '',
          latitude: c.latitude ?? undefined,
          longitude: c.longitude ?? undefined,
          source: 'client' as const,
          clientId: c.id,
          clientNom: c.nom,
        }));

      results.push(...clientResults);

      // 2. Search via French government address API
      try {
        // Cancel previous API request
        if (abortRef.current) {
          abortRef.current.abort();
        }
        abortRef.current = new AbortController();

        const response = await fetch(
          `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(query)}&autocomplete=1&limit=5`,
          { signal: abortRef.current.signal }
        );
        const data = await response.json();

        const apiResults: AddressResult[] = (data.features || []).map(
          (feature: {
            properties: { label: string; name: string; postcode: string; city: string };
            geometry: { coordinates: [number, number] };
          }) => ({
            label: feature.properties.label,
            adresse: feature.properties.name,
            codePostal: feature.properties.postcode,
            ville: feature.properties.city,
            latitude: feature.geometry.coordinates[1],
            longitude: feature.geometry.coordinates[0],
            source: 'api' as const,
          })
        );

        results.push(...apiResults);
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          // Request cancelled, ignore
          return;
        }
        // API error, just show client results
      }

      setSuggestions(results);
      setIsOpen(results.length > 0);
      setHighlightedIndex(-1);
      setIsLoading(false);
    },
    [clients]
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    onChange(val);

    // Debounce search
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      searchAddresses(val);
    }, 300);
  };

  const handleSelect = (result: AddressResult) => {
    onChange(result.adresse);
    onSelect(result);
    setIsOpen(false);
    setSuggestions([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen || suggestions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1));
    } else if (e.key === 'Enter' && highlightedIndex >= 0) {
      e.preventDefault();
      handleSelect(suggestions[highlightedIndex]);
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  // Split suggestions into groups
  const clientSuggestions = suggestions.filter((s) => s.source === 'client');
  const apiSuggestions = suggestions.filter((s) => s.source === 'api');

  // Calculate global index for highlighting
  let globalIndex = 0;

  return (
    <div ref={wrapperRef} className={clsx('relative', className)}>
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (suggestions.length > 0) setIsOpen(true);
          }}
          placeholder={placeholder}
          disabled={disabled}
          className={clsx(
            'block w-full rounded-lg border px-3 py-2 text-sm shadow-sm transition-colors',
            'focus:outline-none focus:ring-2 focus:ring-offset-0',
            error
              ? 'border-red-300 text-red-900 placeholder-red-300 focus:border-red-500 focus:ring-red-500'
              : 'border-gray-300 focus:border-primary-500 focus:ring-primary-500',
            disabled && 'bg-gray-50 text-gray-500 cursor-not-allowed'
          )}
        />
        {isLoading && (
          <div className="absolute inset-y-0 right-0 flex items-center pr-3">
            <svg
              className="animate-spin h-4 w-4 text-gray-400"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
          </div>
        )}
      </div>

      {isOpen && suggestions.length > 0 && (
        <div
          className={clsx(
            'absolute z-[9999] mt-1 w-full overflow-auto rounded-lg bg-white',
            'max-h-72 py-1 text-sm shadow-lg ring-1 ring-black/5'
          )}
        >
          {clientSuggestions.length > 0 && (
            <>
              <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50">
                Clients existants
              </div>
              {clientSuggestions.map((suggestion) => {
                const currentIndex = globalIndex++;
                return (
                  <button
                    key={`client-${suggestion.clientId}`}
                    type="button"
                    className={clsx(
                      'w-full text-left px-3 py-2 flex items-center gap-2 cursor-pointer',
                      currentIndex === highlightedIndex
                        ? 'bg-primary-600 text-white'
                        : 'text-gray-900 hover:bg-gray-100'
                    )}
                    onMouseEnter={() => setHighlightedIndex(currentIndex)}
                    onClick={() => handleSelect(suggestion)}
                  >
                    <UserIcon
                      className={clsx(
                        'h-4 w-4 flex-shrink-0',
                        currentIndex === highlightedIndex ? 'text-white' : 'text-primary-500'
                      )}
                    />
                    <span className="truncate">{suggestion.label}</span>
                  </button>
                );
              })}
            </>
          )}

          {apiSuggestions.length > 0 && (
            <>
              <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50">
                Adresses
              </div>
              {apiSuggestions.map((suggestion, idx) => {
                const currentIndex = globalIndex++;
                return (
                  <button
                    key={`api-${idx}`}
                    type="button"
                    className={clsx(
                      'w-full text-left px-3 py-2 flex items-center gap-2 cursor-pointer',
                      currentIndex === highlightedIndex
                        ? 'bg-primary-600 text-white'
                        : 'text-gray-900 hover:bg-gray-100'
                    )}
                    onMouseEnter={() => setHighlightedIndex(currentIndex)}
                    onClick={() => handleSelect(suggestion)}
                  >
                    <MapPinIcon
                      className={clsx(
                        'h-4 w-4 flex-shrink-0',
                        currentIndex === highlightedIndex ? 'text-white' : 'text-gray-400'
                      )}
                    />
                    <span className="truncate">{suggestion.label}</span>
                  </button>
                );
              })}
            </>
          )}
        </div>
      )}

      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}

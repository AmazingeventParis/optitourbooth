import { useState, useCallback, Fragment } from 'react';
import { Combobox, Transition } from '@headlessui/react';
import { CheckIcon, ChevronUpDownIcon } from '@heroicons/react/24/outline';
import { clsx } from 'clsx';

interface Option {
  value: string;
  label: string;
}

interface SearchableSelectProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  placeholder?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
}

export default function SearchableSelect({
  label,
  value,
  onChange,
  options,
  placeholder = 'Rechercher...',
  error,
  required,
  disabled,
  className,
}: SearchableSelectProps) {
  const [query, setQuery] = useState('');

  const selectedOption = options.find((opt) => opt.value === value) || null;

  const filteredOptions =
    query === ''
      ? options
      : options.filter((option) =>
          option.label
            .toLowerCase()
            .replace(/\s+/g, '')
            .includes(query.toLowerCase().replace(/\s+/g, ''))
        );

  const handleChange = useCallback(
    (option: Option | null) => {
      onChange(option?.value || '');
    },
    [onChange]
  );

  return (
    <div className={className}>
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}
      <Combobox value={selectedOption} onChange={handleChange} disabled={disabled}>
        <div className="relative">
          <div className="relative w-full">
            <Combobox.Input
              className={clsx(
                'w-full rounded-lg border bg-white py-2 pl-3 pr-10 text-sm',
                'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500',
                error
                  ? 'border-red-300 focus:ring-red-500 focus:border-red-500'
                  : 'border-gray-300',
                disabled && 'bg-gray-100 cursor-not-allowed'
              )}
              displayValue={(option: Option | null) => option?.label || ''}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={placeholder}
            />
            <Combobox.Button className="absolute inset-y-0 right-0 flex items-center pr-2">
              <ChevronUpDownIcon className="h-5 w-5 text-gray-400" aria-hidden="true" />
            </Combobox.Button>
          </div>
          <Transition
            as={Fragment}
            leave="transition ease-in duration-100"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
            afterLeave={() => setQuery('')}
          >
            <Combobox.Options
              className={clsx(
                'absolute z-[9999] mt-1 max-h-60 w-full overflow-auto rounded-lg bg-white',
                'py-1 text-sm shadow-lg ring-1 ring-black/5 focus:outline-none'
              )}
            >
              {filteredOptions.length === 0 && query !== '' ? (
                <div className="relative cursor-default select-none px-4 py-2 text-gray-500">
                  Aucun résultat trouvé.
                </div>
              ) : (
                filteredOptions.map((option) => (
                  <Combobox.Option
                    key={option.value}
                    className={({ active }) =>
                      clsx(
                        'relative cursor-pointer select-none py-2 pl-10 pr-4',
                        active ? 'bg-primary-600 text-white' : 'text-gray-900'
                      )
                    }
                    value={option}
                  >
                    {({ selected, active }) => (
                      <>
                        <span
                          className={clsx(
                            'block truncate',
                            selected ? 'font-medium' : 'font-normal'
                          )}
                        >
                          {option.label}
                        </span>
                        {selected && (
                          <span
                            className={clsx(
                              'absolute inset-y-0 left-0 flex items-center pl-3',
                              active ? 'text-white' : 'text-primary-600'
                            )}
                          >
                            <CheckIcon className="h-5 w-5" aria-hidden="true" />
                          </span>
                        )}
                      </>
                    )}
                  </Combobox.Option>
                ))
              )}
            </Combobox.Options>
          </Transition>
        </div>
      </Combobox>
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}

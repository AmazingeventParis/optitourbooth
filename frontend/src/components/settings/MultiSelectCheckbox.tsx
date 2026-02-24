interface Option {
  value: string;
  label: string;
}

interface MultiSelectCheckboxProps {
  options: Option[];
  selected: string[];
  onChange: (selected: string[]) => void;
  columns?: 2 | 3 | 4;
}

export default function MultiSelectCheckbox({
  options,
  selected,
  onChange,
  columns = 3,
}: MultiSelectCheckboxProps) {
  const toggle = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  const gridClass =
    columns === 2
      ? 'grid-cols-1 sm:grid-cols-2'
      : columns === 4
        ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'
        : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';

  return (
    <div className={`grid ${gridClass} gap-2`}>
      {options.map((opt) => (
        <label
          key={opt.value}
          className="flex items-center gap-2 px-3 py-2 rounded-md border border-gray-200 hover:bg-gray-50 cursor-pointer transition-colors text-sm"
        >
          <input
            type="checkbox"
            checked={selected.includes(opt.value)}
            onChange={() => toggle(opt.value)}
            className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-600"
          />
          <span className="text-gray-700">{opt.label}</span>
        </label>
      ))}
    </div>
  );
}

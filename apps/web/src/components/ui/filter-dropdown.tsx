"use client";

import type { SelectHTMLAttributes } from "react";

export interface FilterOption<T extends string = string> {
  value: T;
  label: string;
}

interface FilterDropdownProps<T extends string = string>
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange"> {
  value: T;
  options: FilterOption<T>[];
  onChangeValue: (value: T) => void;
  ariaLabel?: string;
}

export function FilterDropdown<T extends string = string>({
  value,
  options,
  onChangeValue,
  ariaLabel = "Filtrar por status",
  className = "",
  ...props
}: FilterDropdownProps<T>) {
  return (
    <select
      value={value}
      onChange={(e) => onChangeValue(e.target.value as T)}
      aria-label={ariaLabel}
      className={`h-10 rounded-lg border border-border bg-muted/60 px-3 text-sm text-foreground outline-none transition-all hover:bg-muted focus:border-primary focus:ring-1 focus:ring-primary ${className}`}
      {...props}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value} className="bg-card text-foreground">
          {opt.label}
        </option>
      ))}
    </select>
  );
}

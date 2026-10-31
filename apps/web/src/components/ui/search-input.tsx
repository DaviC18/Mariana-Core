"use client";

import { Search, X } from "lucide-react";
import type { InputHTMLAttributes } from "react";

interface SearchInputProps extends InputHTMLAttributes<HTMLInputElement> {
  value: string;
  onChangeValue: (value: string) => void;
  onClear?: () => void;
}

export function SearchInput({
  value,
  onChangeValue,
  onClear,
  placeholder = "Buscar...",
  className = "",
  ...props
}: SearchInputProps) {
  return (
    <div className={`relative flex items-center ${className}`}>
      <Search className="pointer-events-none absolute left-3 size-4 text-muted-foreground" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChangeValue(e.target.value)}
        placeholder={placeholder}
        className="h-10 w-full rounded-lg border border-border bg-muted/60 pl-9 pr-8 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:bg-background focus:outline-none focus:ring-1 focus:ring-primary transition-all"
        {...props}
      />
      {value && (
        <button
          type="button"
          onClick={() => {
            onChangeValue("");
            onClear?.();
          }}
          className="absolute right-2.5 rounded-md p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Limpar busca"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

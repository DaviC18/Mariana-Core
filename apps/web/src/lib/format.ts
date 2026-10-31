export function dateTime(value: string | null | undefined) {
  return value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
}

export function shortId(value: string) { return value.slice(0, 8); }

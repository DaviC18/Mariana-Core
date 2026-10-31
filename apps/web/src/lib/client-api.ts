"use client";
import { useEffect, useState } from "react";

export function useApi<T>(path: string) {
  const [data, setData] = useState<T>(); const [error, setError] = useState<string>(); const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/admin/${path}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => { if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? "Não foi possível carregar estes dados."); return response.json() as Promise<T>; })
      .then(setData).catch((reason: unknown) => { if ((reason as Error).name !== "AbortError") setError(reason instanceof Error ? reason.message : "Erro inesperado."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [path]);
  return { data, error, loading };
}

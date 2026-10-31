"use client";

import { useEffect, useState } from "react";

type ApiState<T> = {
  data?: T;
  error?: string;
  loading: boolean;
};

export function useApi<T>(path: string) {
  const [state, setState] = useState<ApiState<T>>({
    loading: true,
  });

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    fetch(`/api/admin/${path}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.error ?? `Erro HTTP ${response.status}`);
        }
        return response.json() as Promise<T>;
      })
      .then((data) => {
        if (active) {
          setState({ data, loading: false });
        }
      })
      .catch((err: unknown) => {
        if (active && (err as Error).name !== "AbortError") {
          setState({
            error: err instanceof Error ? err.message : "Erro inesperado ao consultar a API.",
            loading: false,
          });
        }
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [path]);

  return state;
}

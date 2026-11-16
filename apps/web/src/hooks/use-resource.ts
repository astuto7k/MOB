"use client";
import { useCallback, useEffect, useRef, useState } from "react";
export function useResource<T>(loader: (signal: AbortSignal) => Promise<T>, dependencies: unknown[] = [], interval = 0) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const loaderRef = useRef(loader);
  useEffect(() => { loaderRef.current = loader; }, [loader]);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(n => n + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    let running = false;
    const run = async () => {
      if (running) return;
      running = true;
      try {
        const value = await loaderRef.current(controller.signal);
        if (!controller.signal.aborted) { setData(value); setError(""); }
      } catch (e) {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Falha ao atualizar dados.");
      } finally { running = false; if (!controller.signal.aborted) setLoading(false); }
    };
    void run();
    const timer = interval ? setInterval(() => void run(), interval) : undefined;
    return () => { controller.abort(); if (timer) clearInterval(timer); };
    // Primitive caller dependencies deliberately determine the resource identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependencies, revision, interval]);
  return { data, error, loading, refresh };
}

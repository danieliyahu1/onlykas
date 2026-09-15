import { useEffect, useState } from "react";

export function useAsyncResource<T>(
  load: (signal: AbortSignal) => Promise<T>,
  dependencies: readonly unknown[],
): { data: T | null; loading: boolean; error: unknown } {
  const [state, setState] = useState<{
    data: T | null;
    loading: boolean;
    error: unknown;
  }>({ data: null, loading: true, error: null });

  useEffect(() => {
    const controller = new AbortController();
    setState({ data: null, loading: true, error: null });
    void load(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ data, loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ data: null, loading: false, error });
      });
    return () => controller.abort();
  }, dependencies);

  return state;
}

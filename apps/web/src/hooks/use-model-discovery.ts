import { useCallback, useEffect, useRef, useState } from "react";
import { postApiV1BridgeModelsDiscover } from "../../lib/api/sdk.gen";
import type {
  PostApiV1BridgeModelsDiscoverData,
  PostApiV1BridgeModelsDiscoverResponse,
} from "../../lib/api/types.gen";

/** Credentials stay out of query keys and cached mutation variables. */
export function useModelDiscovery() {
  const request = useRef<AbortController | null>(null);
  const revision = useRef(0);
  const [loading, setLoading] = useState(false);
  const [result, setResult] =
    useState<PostApiV1BridgeModelsDiscoverResponse | null>(null);
  useEffect(
    () => () => {
      revision.current++;
      request.current?.abort();
      request.current = null;
    },
    [],
  );

  const reset = useCallback(() => {
    revision.current++;
    request.current?.abort();
    request.current = null;
    setLoading(false);
    setResult(null);
  }, []);

  const discover = useCallback(
    async (body: PostApiV1BridgeModelsDiscoverData["body"]) => {
      if (request.current) return;
      const controller = new AbortController();
      request.current = controller;
      const current = ++revision.current;
      setLoading(true);
      setResult(null);
      try {
        const { data } = await postApiV1BridgeModelsDiscover({
          body,
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(25_000),
          ]),
          throwOnError: true,
        });
        if (current !== revision.current) return;
        setResult(data ?? null);
        return data;
      } catch {
        if (current !== revision.current) return;
        setResult({
          ok: false,
          code: "network",
          models: [],
          incomplete: false,
          message: "读取失败，请检查本地服务后重试，或手动填写模型。",
        });
      } finally {
        if (current === revision.current) {
          setLoading(false);
          request.current = null;
        }
      }
    },
    [],
  );
  return { loading, result, discover, reset };
}

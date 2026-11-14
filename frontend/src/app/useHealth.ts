import { useCallback, useEffect, useState } from "react";
import { healthApi } from "./healthService";
import type { Health } from "../shared/types";
import { errorMessage } from "../shared/utils";
export function useHealth() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState("");
  const check = useCallback(async () => {
    try {
      setHealth(await healthApi.health());
      setError("");
    } catch (reason) {
      setHealth(null);
      setError(errorMessage(reason));
    }
  }, []);
  useEffect(() => {
    void check();
    const timer = window.setInterval(() => void check(), 30_000);
    return () => clearInterval(timer);
  }, [check]);
  return { health, error, check };
}

import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import type { Health } from "../types";
import { errorMessage } from "../utils";
export function useHealth() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState("");
  const check = useCallback(async () => {
    try {
      setHealth(await api.health());
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

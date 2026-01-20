// src/hooks/useTimeline.ts
import { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";

import { db } from "../firebase";
import type { TimelineEvent } from "../types/domain";

type Result = {
  timeline: TimelineEvent[];
  loading: boolean;
  error: string;
};

/**
 * Subscribes to timeline events for a given batchId.
 *
 * Design:
 * - Pure data hook (no UI state)
 * - Returns loading + error for safe rendering
 */
export function useTimeline(batchId: string | null): Result {
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    setError("");

    if (!batchId) {
      setTimeline([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    const q = query(collection(db, "batches", batchId, "timeline"), orderBy("at", "asc"));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows: TimelineEvent[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as any),
        }));
        setTimeline(rows);
        setLoading(false);
      },
      (err) => {
        setError(`Timeline failed: ${err.message}`);
        setTimeline([]);
        setLoading(false);
      }
    );

    return () => {
      unsub();
    };
  }, [batchId]);

  return { timeline, loading, error };
}

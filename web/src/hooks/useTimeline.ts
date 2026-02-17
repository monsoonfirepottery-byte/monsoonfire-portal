// src/hooks/useTimeline.ts
import { useEffect, useState } from "react";
import { collection, getDocs, orderBy, query } from "firebase/firestore";

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

    const load = async () => {
      try {
        const q = query(collection(db, "batches", batchId, "timeline"), orderBy("at", "asc"));
        const snap = await getDocs(q);
        const rows: TimelineEvent[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Partial<TimelineEvent>),
        }));
        setTimeline(rows);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        setError(`Timeline failed: ${message}`);
        setTimeline([]);
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [batchId]);

  return { timeline, loading, error };
}

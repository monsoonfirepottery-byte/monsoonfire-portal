// src/hooks/useBatches.ts
import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";

import { db } from "../firebase";
import type { Batch } from "../types/domain";

type Result = {
  active: Batch[];
  history: Batch[];
  error: string;
};

/**
 * Subscribes to Active + History batches for the signed-in user.
 *
 * Notes:
 * - Requires composite indexes for:
 *   - ownerUid + isClosed + orderBy(updatedAt)
 *   - ownerUid + isClosed + orderBy(closedAt)
 * - Tolerant typing: spreads doc data into Batch
 */
export function useBatches(user: User | null): Result {
  const [active, setActive] = useState<Batch[]>([]);
  const [history, setHistory] = useState<Batch[]>([]);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    setError("");

    if (!user) {
      setActive([]);
      setHistory([]);
      return;
    }

    const uid = user.uid;

    const qActive = query(
      collection(db, "batches"),
      where("ownerUid", "==", uid),
      where("isClosed", "==", false),
      orderBy("updatedAt", "desc")
    );

    const unsubActive = onSnapshot(
      qActive,
      (snap) => {
        const rows: Batch[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as any),
        }));
        setActive(rows);
      },
      (err) => setError(`Active query failed: ${err.message}`)
    );

    const qHistory = query(
      collection(db, "batches"),
      where("ownerUid", "==", uid),
      where("isClosed", "==", true),
      orderBy("closedAt", "desc")
    );

    const unsubHistory = onSnapshot(
      qHistory,
      (snap) => {
        const rows: Batch[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as any),
        }));
        setHistory(rows);
      },
      (err) => setError(`History query failed: ${err.message}`)
    );

    return () => {
      unsubActive();
      unsubHistory();
    };
  }, [user]);

  return { active, history, error };
}

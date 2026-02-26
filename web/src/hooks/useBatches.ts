// src/hooks/useBatches.ts
import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { collection, getDocs, orderBy, query, where } from "firebase/firestore";

import { db } from "../firebase";
import type { Batch } from "../types/domain";
import { isMissingFirestoreIndexError, toAppError } from "../errors/appError";

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
  const [loadedUid, setLoadedUid] = useState<string | null>(null);

  const visibleActive = user && loadedUid === user.uid ? active : [];
  const visibleHistory = user && loadedUid === user.uid ? history : [];
  const visibleError = user && loadedUid === user.uid ? error : "";

  useEffect(() => {
    let cancelled = false;

    if (!user) {
      return;
    }

    const uid = user.uid;

    const load = async () => {
      try {
        const qActive = query(
          collection(db, "batches"),
          where("ownerUid", "==", uid),
          where("isClosed", "==", false),
          orderBy("updatedAt", "desc")
        );

        const qHistory = query(
          collection(db, "batches"),
          where("ownerUid", "==", uid),
          where("isClosed", "==", true),
          orderBy("closedAt", "desc")
        );

        const [activeResult, historyResult] = await Promise.allSettled([getDocs(qActive), getDocs(qHistory)]);

        if (cancelled) return;
        const activeRows =
          activeResult.status === "fulfilled"
            ? activeResult.value.docs.map((d) => ({
                id: d.id,
                ...(d.data() as Partial<Batch>),
              }))
            : [];
        const historyRows =
          historyResult.status === "fulfilled"
            ? historyResult.value.docs.map((d) => ({
                id: d.id,
                ...(d.data() as Partial<Batch>),
              }))
            : [];

        setActive(activeRows);
        setHistory(historyRows);

        const failures = [activeResult, historyResult].filter(
          (result): result is PromiseRejectedResult => result.status === "rejected"
        );
        if (failures.length === 0) {
          setLoadedUid(uid);
          setError("");
          return;
        }

        const firstError: unknown = failures[0]?.reason;
        const appError = toAppError(firstError, { kind: "firestore" });
        if (isMissingFirestoreIndexError(firstError)) {
          setLoadedUid(uid);
          setError(
            `${appError.userMessage} See docs/runbooks/FIRESTORE_INDEX_TROUBLESHOOTING.md (support code: ${appError.correlationId}).`
          );
          return;
        }

        if (activeRows.length > 0 || historyRows.length > 0) {
          setLoadedUid(uid);
          setError(
            `Some check-ins could not be loaded. ${appError.userMessage} (support code: ${appError.correlationId})`
          );
          return;
        }

        setLoadedUid(uid);
        setError(`${appError.userMessage} (support code: ${appError.correlationId})`);
      } catch (err: unknown) {
        if (cancelled) return;
        const appError = toAppError(err, { kind: "firestore" });
        if (isMissingFirestoreIndexError(err)) {
          setLoadedUid(uid);
          setError(
            `${appError.userMessage} See docs/runbooks/FIRESTORE_INDEX_TROUBLESHOOTING.md (support code: ${appError.correlationId}).`
          );
          return;
        }
        setActive([]);
        setHistory([]);
        setLoadedUid(uid);
        setError(`${appError.userMessage} (support code: ${appError.correlationId})`);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [user]);

  return { active: visibleActive, history: visibleHistory, error: visibleError };
}

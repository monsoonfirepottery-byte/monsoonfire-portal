// src/components/ActiveBatchCard.tsx
import type { Batch } from "../types/domain";
import { styles as S } from "../ui/styles";

type Props = {
  batch: Batch;
  disabled: boolean;
  closeDisabled: boolean;
  closeBusy: boolean;
  closeTitle?: string;
  onViewHistory: (batchId: string) => void;
  onCloseBatch: (batchId: string) => void;
};

function formatMoney(cents?: number) {
  if (typeof cents !== "number") return "$0.00";
  return `$${(cents / 100).toFixed(2)}`;
}

type TimestampLike = { toDate?: () => Date };

function formatTs(ts: unknown) {
  if (!ts) return "";
  try {
    const value = ts as TimestampLike;
    return typeof value.toDate === "function" ? value.toDate().toLocaleString() : String(ts);
  } catch {
    return "";
  }
}

export default function ActiveBatchCard({
  batch,
  disabled,
  closeDisabled,
  closeBusy,
  closeTitle,
  onViewHistory,
  onCloseBatch,
}: Props) {
  const price = batch.priceCents ?? batch.estimatedCostCents;
  const status = (batch.status as string) || (batch.intakeMode as string) || "—";

  return (
    <div style={S.batchCard}>
      <div style={{ minWidth: 360 }}>
        <div style={{ fontSize: 18, fontWeight: 800 }}>{batch.title || "Batch"}</div>
        <div style={{ ...S.muted, fontSize: 13, marginTop: 3 }}>
          {formatMoney(price)} • {status} • {batch.id}
        </div>
        <div style={{ ...S.muted, fontSize: 13, marginTop: 3 }}>
          Updated: {formatTs(batch.updatedAt)}
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button
          style={S.btnSmall}
          onClick={() => onViewHistory(batch.id)}
          disabled={disabled}
        >
          History
        </button>

        <button
          style={S.btnSmall}
          onClick={() => onCloseBatch(batch.id)}
          disabled={closeDisabled}
          title={closeTitle}
        >
          {closeBusy ? "Working..." : "Picked up & close"}
        </button>
      </div>
    </div>
  );
}

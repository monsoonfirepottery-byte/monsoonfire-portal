// src/components/ActiveBatchCard.tsx
import type { Batch } from "../types/domain";

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
    <div className="panel active-batch-card">
      <div className="active-batch-info">
        <div className="active-batch-title">{batch.title || "Batch"}</div>
        <div className="active-batch-meta">
          {formatMoney(price)} • {status} • {batch.id}
        </div>
        <div className="active-batch-meta">Updated: {formatTs(batch.updatedAt)}</div>
      </div>

      <div className="active-batch-actions">
        <button className="btn-small" onClick={() => onViewHistory(batch.id)} disabled={disabled} type="button">
          History
        </button>

        <button
          className="btn-small"
          onClick={() => onCloseBatch(batch.id)}
          disabled={closeDisabled}
          title={closeTitle}
          type="button"
        >
          {closeBusy ? "Working..." : "Picked up & close"}
        </button>
      </div>
    </div>
  );
}

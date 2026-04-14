import { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import {
  collection,
  doc,
  limit,
  orderBy,
  query,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase";
import { useBatches } from "../hooks/useBatches";
import { formatMaybeTimestamp } from "../utils/format";
import { toVoidHandler } from "../utils/toVoidHandler";
import { shortId, track } from "../lib/analytics";
import RevealCard from "../components/RevealCard";
import { useUiSettings } from "../context/UiSettingsContext";
import {
  trackedAddDoc,
  trackedGetDocs,
  trackedUpdateDoc,
} from "../lib/firestoreTelemetry";
import "./MyPiecesView.css";

const HISTORY_PIECES_PAGE_SIZE = 6;
const HISTORY_BATCHES_PAGE_SIZE = 5;
const RATING_PIECES_VISIBLE_COUNT = 6;
const BATCH_PIECES_QUERY_LIMIT = 50;
const NOTE_LOAD_LIMIT = 40;
const MEDIA_LOAD_LIMIT = 30;
const AUDIT_LOAD_LIMIT = 60;

const STAGES = [
  "GREENWARE",
  "BISQUE",
  "GLAZED",
  "FINISHED",
  "HOLD",
  "UNKNOWN",
] as const;
const WARE_CATEGORIES = [
  "STONEWARE",
  "EARTHENWARE",
  "PORCELAIN",
  "RAKU",
  "OTHER",
  "UNKNOWN",
] as const;

type Stage = (typeof STAGES)[number];
type WareCategory = (typeof WARE_CATEGORIES)[number];

const WARE_CATEGORY_LABELS: Record<WareCategory, string> = {
  STONEWARE: "Stoneware",
  EARTHENWARE: "Earthenware",
  PORCELAIN: "Porcelain",
  RAKU: "Raku",
  OTHER: "Other",
  UNKNOWN: "Unknown",
};

const STAGE_LABELS: Record<Stage, string> = {
  GREENWARE: "Greenware",
  BISQUE: "Bisque",
  GLAZED: "Glazed",
  FINISHED: "Finished",
  HOLD: "On hold",
  UNKNOWN: "In review",
};

type Props = {
  user: User;
  adminToken?: string;
  isStaff: boolean;
  focusTarget?: {
    batchId: string;
    pieceId?: string;
  } | null;
  onFocusTargetConsumed?: () => void;
};

type PieceDoc = {
  id: string;
  key: string;
  batchId: string;
  batchTitle: string;
  batchIsHistory: boolean;
  pieceCode: string;
  shortDesc: string;
  ownerName: string;
  stage: Stage;
  wareCategory: WareCategory;
  isArchived: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
  clientRating?: number | null;
  clientRatingUpdatedAt?: unknown;
};

type BatchRow = {
  id: string;
  title?: string;
  ownerUid?: string;
  editors?: unknown;
};

type PieceNoteStream = "client" | "studio";

type PieceNote = {
  id: string;
  text: string;
  at?: unknown;
  updatedAt?: unknown;
  authorUid?: string;
  authorName: string;
  searchTokens?: string[];
};

type PieceAuditEvent = {
  id: string;
  type: string;
  at?: unknown;
  actorUid?: string;
  actorName?: string;
  noteStream?: PieceNoteStream;
  noteId?: string;
  notes?: string;
};

type PieceMedia = {
  id: string;
  stage: Stage;
  storagePath: string;
  caption?: string;
  at?: unknown;
  uploadedByUid?: string;
  uploadedByName?: string;
  searchTokens?: string[];
};

function normalizeStage(value: unknown): Stage {
  if (typeof value !== "string") return "UNKNOWN";
  const match = STAGES.find((stage) => stage === value);
  return match ?? "UNKNOWN";
}

function normalizeWareCategory(value: unknown): WareCategory {
  if (typeof value !== "string") return "UNKNOWN";
  const match = WARE_CATEGORIES.find((category) => category === value);
  return match ?? "UNKNOWN";
}

function toTokens(text: string): string[] {
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
  return Array.from(new Set(normalized)).slice(0, 24);
}

function buildNoteDoc(note: Partial<PieceNote> & { id: string }): PieceNote {
  return {
    id: note.id,
    text: note.text ?? "",
    at: note.at,
    updatedAt: note.updatedAt,
    authorUid: note.authorUid,
    authorName: note.authorName ?? "",
    searchTokens: Array.isArray(note.searchTokens) ? note.searchTokens : [],
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isPermissionDeniedError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  const code =
    typeof error === "object" &&
    error !== null &&
    typeof (error as { code?: unknown }).code === "string"
      ? ((error as { code: string }).code || "").toLowerCase()
      : "";
  return (
    code.includes("permission-denied") ||
    message.includes("missing or insufficient permissions") ||
    message.includes("permission denied")
  );
}

function normalizeAuditDoc(
  id: string,
  raw: Partial<PieceAuditEvent>,
): PieceAuditEvent {
  return {
    id,
    type: typeof raw.type === "string" ? raw.type : "UNKNOWN",
    at: raw.at ?? null,
    actorUid: raw.actorUid,
    actorName: raw.actorName,
    noteStream: raw.noteStream,
    noteId: raw.noteId,
    notes: raw.notes,
  };
}

function normalizeMediaDoc(id: string, raw: Partial<PieceMedia>): PieceMedia {
  return {
    id,
    stage: normalizeStage(raw.stage),
    storagePath: typeof raw.storagePath === "string" ? raw.storagePath : "",
    caption: raw.caption,
    at: raw.at ?? null,
    uploadedByUid: raw.uploadedByUid,
    uploadedByName: raw.uploadedByName,
    searchTokens: Array.isArray(raw.searchTokens) ? raw.searchTokens : [],
  };
}

function toMillis(value: unknown): number {
  if (
    value &&
    typeof value === "object" &&
    typeof (value as { toMillis?: () => number }).toMillis === "function"
  ) {
    return (value as { toMillis: () => number }).toMillis();
  }
  return new Date((value as string | number | Date | null) ?? 0).getTime();
}

function getPieceNextStepLabel(piece: Pick<PieceDoc, "stage" | "batchIsHistory" | "isArchived">): string {
  if (piece.batchIsHistory || piece.isArchived) {
    return "Next step: review the history or leave feedback";
  }

  switch (piece.stage) {
    case "GREENWARE":
      return "Next step: bisque firing";
    case "BISQUE":
      return "Next step: glaze and stage for the next firing";
    case "GLAZED":
      return "Next step: finish firing and cooldown";
    case "FINISHED":
      return "Next step: pickup or feedback";
    case "HOLD":
      return "Next step: studio review";
    default:
      return "Next step: studio review";
  }
}

function getPieceLatestUpdateLabel(piece: Pick<PieceDoc, "updatedAt">): string {
  return `Latest update: ${formatMaybeTimestamp(piece.updatedAt)}`;
}

function getPieceJourneyStatus(piece: PieceDoc): string {
  return STAGE_LABELS[piece.stage];
}

type StarRatingProps = {
  value: number | null | undefined;
  onSelect: (value: number) => void;
  disabled?: boolean;
  pulse?: boolean;
};

function StarRating({ value, onSelect, disabled, pulse }: StarRatingProps) {
  return (
    <div
      className={`rating-stars ${pulse ? "rating-pulse" : ""}`}
      aria-label="Piece rating"
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          className={`star-button ${value && value >= star ? "active" : ""}`}
          onClick={() => onSelect(star)}
          disabled={disabled}
          aria-label={`Rate ${star} star${star === 1 ? "" : "s"}`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

export default function MyPiecesView({
  user,
  adminToken: _adminToken,
  isStaff,
  focusTarget,
  onFocusTargetConsumed,
}: Props) {
  const { themeName, portalMotion } = useUiSettings();
  const motionEnabled = themeName === "memoria" && portalMotion === "enhanced";
  const { active, history, error } = useBatches(user);
  const [status, setStatus] = useState("");
  const [inFlight, setInFlight] = useState<Record<string, boolean>>({});

  const isBusy = useCallback((key: string) => !!inFlight[key], [inFlight]);
  const setBusy = useCallback((key: string, value: boolean) => {
    setInFlight((prev) => ({ ...prev, [key]: value }));
  }, []);

  const [pieces, setPieces] = useState<PieceDoc[]>([]);
  const [piecesLoading, setPiecesLoading] = useState(false);
  const [piecesError, setPiecesError] = useState("");
  const [piecesWarning, setPiecesWarning] = useState("");
  const [selectedPieceKey, setSelectedPieceKey] = useState<string | null>(null);
  const [selectedPieceTab, setSelectedPieceTab] = useState<
    "client" | "studio" | "photos" | "audit"
  >("client");
  const [clientNotes, setClientNotes] = useState<PieceNote[]>([]);
  const [studioNotes, setStudioNotes] = useState<PieceNote[]>([]);
  const [auditEvents, setAuditEvents] = useState<PieceAuditEvent[]>([]);
  const [mediaItems, setMediaItems] = useState<PieceMedia[]>([]);
  const [pieceDetailLoading, setPieceDetailLoading] = useState(false);
  const [pieceDetailError, setPieceDetailError] = useState("");
  const [detailRefreshKey, setDetailRefreshKey] = useState(0);

  const [clientNoteDraft, setClientNoteDraft] = useState("");
  const [studioNoteDraft, setStudioNoteDraft] = useState("");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteStream, setEditingNoteStream] =
    useState<PieceNoteStream | null>(null);
  const [editingNoteText, setEditingNoteText] = useState("");

  const [historyBatchWindow, setHistoryBatchWindow] = useState(
    HISTORY_BATCHES_PAGE_SIZE,
  );
  const [historyVisibleCount, setHistoryVisibleCount] = useState(
    HISTORY_PIECES_PAGE_SIZE,
  );
  const [activeCarouselIndex, setActiveCarouselIndex] = useState(0);
  const [ratingStatus, setRatingStatus] = useState<Record<string, string>>({});
  const [ratingPulseKey, setRatingPulseKey] = useState<string | null>(null);

  const historyBatchIds = useMemo(
    () => new Set(history.map((batch) => batch.id)),
    [history],
  );
  const activePieceCount = useMemo(
    () => pieces.filter((piece) => !piece.batchIsHistory).length,
    [pieces],
  );
  const historyPieceCount = useMemo(
    () => pieces.filter((piece) => piece.batchIsHistory).length,
    [pieces],
  );

  useEffect(() => {
    let cancelled = false;

    if (!user) {
      setPieces([]);
      setPiecesError("");
      setPiecesWarning("");
      setPiecesLoading(false);
      return;
    }

    const loadPieces = async () => {
      setPiecesLoading(true);
      setPiecesError("");
      setPiecesWarning("");

      try {
        const isReadableBatch = (batch: BatchRow) => {
          if (isStaff) return true;
          const ownerUid =
            typeof batch.ownerUid === "string" ? batch.ownerUid : "";
          const editors = Array.isArray(batch.editors)
            ? batch.editors.filter(
                (entry): entry is string => typeof entry === "string",
              )
            : [];
          return ownerUid === user.uid || editors.includes(user.uid);
        };

        const readableActive = active.filter((batch) =>
          isReadableBatch(batch as BatchRow),
        );
        const readableHistory = history.filter((batch) =>
          isReadableBatch(batch as BatchRow),
        );
        const visibleBatches = [
          ...readableActive,
          ...readableHistory.slice(0, historyBatchWindow),
        ];
        if (cancelled) return;
        if (visibleBatches.length === 0) {
          setPieces([]);
          setPiecesWarning("");
          return;
        }

        if (readableActive.length + readableHistory.length === 0) {
          setPieces([]);
          setPiecesWarning("");
          setPiecesError("No readable check-ins were found for this account.");
          return;
        }

        const fetchRows = async () =>
          await Promise.allSettled(
            visibleBatches.map(async (batch) => {
              const batchTitle =
                typeof batch.title === "string" && batch.title.trim()
                  ? batch.title
                  : "Check-in";
              const toPiece = (
                docId: string,
                data: Partial<PieceDoc>,
              ): PieceDoc => ({
                id: docId,
                key: `${batch.id}:${docId}`,
                batchId: batch.id,
                batchTitle,
                batchIsHistory: historyBatchIds.has(batch.id),
                pieceCode: data.pieceCode ?? "",
                shortDesc: data.shortDesc ?? "",
                ownerName: data.ownerName ?? "",
                stage: normalizeStage(data.stage),
                wareCategory: normalizeWareCategory(data.wareCategory),
                isArchived: data.isArchived === true,
                createdAt: data.createdAt,
                updatedAt: data.updatedAt,
                clientRating:
                  typeof data.clientRating === "number"
                    ? data.clientRating
                    : null,
                clientRatingUpdatedAt: data.clientRatingUpdatedAt ?? null,
              });
              const byUpdatedDesc = query(
                collection(db, "batches", batch.id, "pieces"),
                orderBy("updatedAt", "desc"),
                limit(BATCH_PIECES_QUERY_LIMIT),
              );
              try {
                const snap = await trackedGetDocs("pieces:list", byUpdatedDesc);
                return snap.docs.map((docSnap) =>
                  toPiece(docSnap.id, docSnap.data() as Partial<PieceDoc>),
                );
              } catch (error: unknown) {
                if (!isPermissionDeniedError(error)) {
                  throw error;
                }

                // Fallback without orderBy for edge cases where older docs break ordered reads.
                const fallbackQuery = query(
                  collection(db, "batches", batch.id, "pieces"),
                  limit(BATCH_PIECES_QUERY_LIMIT),
                );
                const snap = await trackedGetDocs("pieces:list", fallbackQuery);
                return snap.docs.map((docSnap) =>
                  toPiece(docSnap.id, docSnap.data() as Partial<PieceDoc>),
                );
              }
            }),
          );

        let rows = await fetchRows();
        let successfulRows = rows
          .filter(
            (result): result is PromiseFulfilledResult<PieceDoc[]> =>
              result.status === "fulfilled",
          )
          .flatMap((result) => result.value);
        let failedRows = rows
          .filter(
            (result): result is PromiseRejectedResult =>
              result.status === "rejected",
          )
          .map((result): unknown => result.reason);

        const deniedOnlyInitial =
          failedRows.length > 0 &&
          failedRows.every((reason) => isPermissionDeniedError(reason));
        if (successfulRows.length === 0 && deniedOnlyInitial) {
          try {
            await user.getIdToken(true);
            rows = await fetchRows();
            successfulRows = rows
              .filter(
                (result): result is PromiseFulfilledResult<PieceDoc[]> =>
                  result.status === "fulfilled",
              )
              .flatMap((result) => result.value);
            failedRows = rows
              .filter(
                (result): result is PromiseRejectedResult =>
                  result.status === "rejected",
              )
              .map((result): unknown => result.reason);
          } catch {
            // If refresh fails we surface the original permission state below.
          }
        }

        if (cancelled) return;
        setPieces(successfulRows);

        if (failedRows.length > 0) {
          const deniedOnly = failedRows.every((reason) =>
            isPermissionDeniedError(reason),
          );
          if (successfulRows.length > 0) {
            setPiecesWarning(
              deniedOnly
                ? `Some check-ins could not be loaded due to permissions (${failedRows.length}/${visibleBatches.length}).`
                : `Some check-ins could not be loaded (${failedRows.length}/${visibleBatches.length}).`,
            );
            setPiecesError("");
          } else {
            setPiecesWarning("");
            setPiecesError(`Pieces failed: ${getErrorMessage(failedRows[0])}`);
          }
        } else {
          setPiecesWarning("");
        }
      } catch (error: unknown) {
        if (cancelled) return;
        setPiecesWarning("");
        setPiecesError(`Pieces failed: ${getErrorMessage(error)}`);
      } finally {
        if (!cancelled) {
          setPiecesLoading(false);
        }
      }
    };

    void loadPieces();
    return () => {
      cancelled = true;
    };
  }, [user, isStaff, active, history, historyBatchIds, historyBatchWindow]);

  const selectedPiece = useMemo(
    () => pieces.find((piece) => piece.key === selectedPieceKey) ?? null,
    [pieces, selectedPieceKey],
  );

  useEffect(() => {
    if (!selectedPieceKey) return;
    const stillExists = pieces.some((piece) => piece.key === selectedPieceKey);
    if (!stillExists) setSelectedPieceKey(null);
  }, [pieces, selectedPieceKey]);

  useEffect(() => {
    if (!focusTarget || piecesLoading) return;

    const targetBatchId =
      typeof focusTarget.batchId === "string" ? focusTarget.batchId.trim() : "";
    const targetPieceId =
      typeof focusTarget.pieceId === "string" ? focusTarget.pieceId.trim() : "";

    const exactMatch =
      targetBatchId && targetPieceId
        ? (pieces.find(
            (piece) =>
              piece.batchId === targetBatchId && piece.id === targetPieceId,
          ) ?? null)
        : null;

    let nextSelected = exactMatch;
    if (!nextSelected && targetBatchId) {
      const batchMatches = pieces.filter(
        (piece) => piece.batchId === targetBatchId,
      );
      if (batchMatches.length > 0) {
        nextSelected = [...batchMatches].sort(
          (left, right) => toMillis(right.updatedAt) - toMillis(left.updatedAt),
        )[0];
      }
    }
    if (!nextSelected && targetPieceId) {
      nextSelected = pieces.find((piece) => piece.id === targetPieceId) ?? null;
    }

    if (nextSelected) {
      setSelectedPieceKey(nextSelected.key);
      setSelectedPieceTab("client");
    }
    onFocusTargetConsumed?.();
  }, [focusTarget, onFocusTargetConsumed, pieces, piecesLoading]);

  useEffect(() => {
    let cancelled = false;

    if (!selectedPiece) {
      setClientNotes([]);
      setStudioNotes([]);
      setAuditEvents([]);
      setMediaItems([]);
      setPieceDetailLoading(false);
      setPieceDetailError("");
      return;
    }

    const loadPieceDetails = async () => {
      setPieceDetailLoading(true);
      setPieceDetailError("");

      try {
        const clientQuery = query(
          collection(
            db,
            "batches",
            selectedPiece.batchId,
            "pieces",
            selectedPiece.id,
            "clientNotes",
          ),
          orderBy("at", "desc"),
          limit(NOTE_LOAD_LIMIT),
        );
        const studioQuery = query(
          collection(
            db,
            "batches",
            selectedPiece.batchId,
            "pieces",
            selectedPiece.id,
            "studioNotes",
          ),
          orderBy("at", "desc"),
          limit(NOTE_LOAD_LIMIT),
        );
        const auditQuery = query(
          collection(
            db,
            "batches",
            selectedPiece.batchId,
            "pieces",
            selectedPiece.id,
            "audit",
          ),
          orderBy("at", "desc"),
          limit(AUDIT_LOAD_LIMIT),
        );
        const mediaQuery = query(
          collection(
            db,
            "batches",
            selectedPiece.batchId,
            "pieces",
            selectedPiece.id,
            "media",
          ),
          orderBy("at", "desc"),
          limit(MEDIA_LOAD_LIMIT),
        );

        const [clientResult, studioResult, auditResult, mediaResult] =
          await Promise.allSettled([
            trackedGetDocs("pieces:detail", clientQuery),
            trackedGetDocs("pieces:detail", studioQuery),
            trackedGetDocs("pieces:detail", auditQuery),
            trackedGetDocs("pieces:detail", mediaQuery),
          ]);

        if (cancelled) return;
        const clientSnap =
          clientResult.status === "fulfilled" ? clientResult.value : null;
        const studioSnap =
          studioResult.status === "fulfilled" ? studioResult.value : null;
        const auditSnap =
          auditResult.status === "fulfilled" ? auditResult.value : null;
        const mediaSnap =
          mediaResult.status === "fulfilled" ? mediaResult.value : null;

        setClientNotes(
          (clientSnap?.docs ?? []).map((docSnap) =>
            buildNoteDoc({
              id: docSnap.id,
              ...(docSnap.data() as Partial<PieceNote>),
            }),
          ),
        );
        setStudioNotes(
          (studioSnap?.docs ?? []).map((docSnap) =>
            buildNoteDoc({
              id: docSnap.id,
              ...(docSnap.data() as Partial<PieceNote>),
            }),
          ),
        );
        setAuditEvents(
          (auditSnap?.docs ?? []).map((docSnap) =>
            normalizeAuditDoc(
              docSnap.id,
              docSnap.data() as Partial<PieceAuditEvent>,
            ),
          ),
        );
        setMediaItems(
          (mediaSnap?.docs ?? []).map((docSnap) =>
            normalizeMediaDoc(
              docSnap.id,
              docSnap.data() as Partial<PieceMedia>,
            ),
          ),
        );

        const detailFailures = [
          clientResult,
          studioResult,
          auditResult,
          mediaResult,
        ].filter(
          (result): result is PromiseRejectedResult =>
            result.status === "rejected",
        );
        if (detailFailures.length > 0) {
          const deniedOnly = detailFailures.every((result) =>
            isPermissionDeniedError(result.reason),
          );
          setPieceDetailError(
            deniedOnly
              ? "Some piece detail sections are unavailable due to permissions."
              : "Some piece detail sections could not be loaded.",
          );
        }

        track("timeline_load_success", {
          uid: shortId(user.uid),
          batchId: shortId(selectedPiece.batchId),
          eventCount: auditSnap?.size ?? 0,
        });
      } catch (error: unknown) {
        if (cancelled) return;
        setPieceDetailError(`Piece detail failed: ${getErrorMessage(error)}`);
        track("timeline_load_error", {
          uid: shortId(user.uid),
          batchId: shortId(selectedPiece.batchId),
          message: getErrorMessage(error).slice(0, 160),
        });
      } finally {
        if (!cancelled) {
          setPieceDetailLoading(false);
        }
      }
    };

    void loadPieceDetails();
    return () => {
      cancelled = true;
    };
  }, [detailRefreshKey, selectedPiece, user.uid]);

  const activePieces = useMemo(
    () =>
      [...pieces]
        .filter((piece) => !piece.batchIsHistory)
        .sort(
          (left, right) => toMillis(right.updatedAt) - toMillis(left.updatedAt),
        ),
    [pieces],
  );
  const piecesNeedingRating = useMemo(
    () =>
      [...pieces]
        .filter((piece) => piece.batchIsHistory && piece.clientRating == null)
        .sort(
          (left, right) => toMillis(right.updatedAt) - toMillis(left.updatedAt),
        ),
    [pieces],
  );
  const visiblePiecesNeedingRating = piecesNeedingRating.slice(
    0,
    RATING_PIECES_VISIBLE_COUNT,
  );
  const historyPieces = useMemo(
    () =>
      [...pieces]
        .filter((piece) => piece.batchIsHistory)
        .sort(
          (left, right) => toMillis(right.updatedAt) - toMillis(left.updatedAt),
        ),
    [pieces],
  );
  const visibleHistoryPieces = historyPieces.slice(0, historyVisibleCount);
  const hasMoreHistoryPieces =
    historyPieces.length > historyVisibleCount ||
    history.length > historyBatchWindow;

  const openPieceDetail = useCallback(
    (
      piece: PieceDoc,
      tab: "client" | "studio" | "photos" | "audit" = "client",
    ) => {
      setSelectedPieceKey(piece.key);
      setSelectedPieceTab(tab);
      track("piece_detail_open", {
        uid: shortId(user.uid),
        batchId: shortId(piece.batchId),
      });
    },
    [user.uid],
  );

  const closePieceDetail = useCallback(() => {
    setSelectedPieceKey(null);
    setSelectedPieceTab("client");
  }, []);

  const handleShowMoreHistory = useCallback(() => {
    setHistoryVisibleCount((current) => current + HISTORY_PIECES_PAGE_SIZE);
    if (history.length > historyBatchWindow) {
      setHistoryBatchWindow((current) => current + HISTORY_BATCHES_PAGE_SIZE);
    }
  }, [history.length, historyBatchWindow]);

  const advanceCarousel = useCallback(
    (direction: number) => {
      if (activePieces.length <= 1) return;
      setActiveCarouselIndex(
        (current) =>
          (current + direction + activePieces.length) % activePieces.length,
      );
    },
    [activePieces.length],
  );

  useEffect(() => {
    if (activePieces.length === 0) {
      setActiveCarouselIndex(0);
      return;
    }
    if (activeCarouselIndex >= activePieces.length) {
      setActiveCarouselIndex(0);
    }
  }, [activeCarouselIndex, activePieces.length]);

  useEffect(() => {
    if (!selectedPiece) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closePieceDetail();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closePieceDetail, selectedPiece]);

  const handleUpdatePiece = async (
    piece: PieceDoc,
    payload: Record<string, unknown>,
  ) => {
    const busyKey = `update:${piece.key}`;
    if (isBusy(busyKey)) return;
    setBusy(busyKey, true);
    setStatus("");

    try {
      await trackedUpdateDoc(
        "pieces:update",
        doc(db, "batches", piece.batchId, "pieces", piece.id),
        {
          ...payload,
          updatedAt: serverTimestamp(),
        },
      );
      setPieces((prev) =>
        prev.map((row) =>
          row.key === piece.key ? { ...row, ...payload } : row,
        ),
      );
      return true;
    } catch (error: unknown) {
      setStatus(`Update failed: ${getErrorMessage(error)}`);
      return false;
    } finally {
      setBusy(busyKey, false);
    }
  };

  const handleArchivePiece = async (piece: PieceDoc, archived: boolean) => {
    track("batch_close_clicked", {
      uid: shortId(user.uid),
      batchId: shortId(piece.batchId),
      archived,
    });
    const ok = await handleUpdatePiece(piece, { isArchived: archived });
    track(ok ? "batch_close_success" : "batch_close_error", {
      uid: shortId(user.uid),
      batchId: shortId(piece.batchId),
      archived,
    });
  };

  const handleRating = async (piece: PieceDoc, rating: number) => {
    const busyKey = `rating:${piece.key}`;
    if (isBusy(busyKey)) return;
    setBusy(busyKey, true);
    setRatingStatus((prev) => ({ ...prev, [piece.key]: "" }));

    try {
      await trackedUpdateDoc(
        "pieces:rating",
        doc(db, "batches", piece.batchId, "pieces", piece.id),
        {
          clientRating: rating,
          clientRatingUpdatedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
      );
      setPieces((prev) =>
        prev.map((row) =>
          row.key === piece.key
            ? {
                ...row,
                clientRating: rating,
                clientRatingUpdatedAt: new Date(),
              }
            : row,
        ),
      );
      setRatingStatus((prev) => ({ ...prev, [piece.key]: "Thanks — saved." }));
      setRatingPulseKey(piece.key);
      setTimeout(() => {
        setRatingPulseKey((current) =>
          current === piece.key ? null : current,
        );
      }, 900);
      setTimeout(() => {
        setRatingStatus((prev) => ({ ...prev, [piece.key]: "" }));
      }, 2000);
    } catch (error: unknown) {
      setStatus(`Rating failed: ${getErrorMessage(error)}`);
    } finally {
      setBusy(busyKey, false);
    }
  };

  const refreshDetails = () => setDetailRefreshKey((prev) => prev + 1);

  const handleAddNote = async (stream: PieceNoteStream) => {
    if (!selectedPiece) return;
    const text =
      stream === "client" ? clientNoteDraft.trim() : studioNoteDraft.trim();
    if (!text) return;
    const busyKey = `addNote:${selectedPiece.key}:${stream}`;
    if (isBusy(busyKey)) return;
    setBusy(busyKey, true);

    try {
      const payload = {
        text,
        at: serverTimestamp(),
        authorUid: user.uid,
        authorName:
          user.displayName || (stream === "client" ? "Member" : "Staff"),
        searchTokens: toTokens(text),
      };
      await trackedAddDoc(
        "pieces:notes",
        collection(
          db,
          "batches",
          selectedPiece.batchId,
          "pieces",
          selectedPiece.id,
          stream === "client" ? "clientNotes" : "studioNotes",
        ),
        payload,
      );
      await trackedAddDoc(
        "pieces:notes",
        collection(
          db,
          "batches",
          selectedPiece.batchId,
          "pieces",
          selectedPiece.id,
          "audit",
        ),
        {
          type: "NOTE_ADDED",
          at: serverTimestamp(),
          actorUid: user.uid,
          actorName: user.displayName || "Member",
          noteStream: stream,
          notes: text,
        },
      );
      if (stream === "client") setClientNoteDraft("");
      else setStudioNoteDraft("");
      refreshDetails();
    } catch (error: unknown) {
      setStatus(`Note failed: ${getErrorMessage(error)}`);
    } finally {
      setBusy(busyKey, false);
    }
  };

  const startEditingNote = (note: PieceNote, stream: PieceNoteStream) => {
    setEditingNoteId(note.id);
    setEditingNoteStream(stream);
    setEditingNoteText(note.text);
  };

  const cancelEditingNote = () => {
    setEditingNoteId(null);
    setEditingNoteStream(null);
    setEditingNoteText("");
  };

  const handleSaveNoteEdit = async () => {
    if (!selectedPiece || !editingNoteId || !editingNoteStream) return;
    const busyKey = `editNote:${editingNoteId}`;
    if (isBusy(busyKey)) return;
    setBusy(busyKey, true);

    try {
      await trackedUpdateDoc(
        "pieces:notes",
        doc(
          db,
          "batches",
          selectedPiece.batchId,
          "pieces",
          selectedPiece.id,
          editingNoteStream === "client" ? "clientNotes" : "studioNotes",
          editingNoteId,
        ),
        {
          text: editingNoteText.trim(),
          updatedAt: serverTimestamp(),
          searchTokens: toTokens(editingNoteText),
        },
      );
      await trackedAddDoc(
        "pieces:notes",
        collection(
          db,
          "batches",
          selectedPiece.batchId,
          "pieces",
          selectedPiece.id,
          "audit",
        ),
        {
          type: "NOTE_EDITED",
          at: serverTimestamp(),
          actorUid: user.uid,
          actorName: user.displayName || "Member",
          noteStream: editingNoteStream,
          noteId: editingNoteId,
          notes: editingNoteText.trim(),
        },
      );
      cancelEditingNote();
      refreshDetails();
    } catch (error: unknown) {
      setStatus(`Edit failed: ${getErrorMessage(error)}`);
    } finally {
      setBusy(busyKey, false);
    }
  };

  const canEditNote = (note: PieceNote, stream: PieceNoteStream) => {
    if (stream === "studio") return isStaff;
    return note.authorUid === user.uid || isStaff;
  };

  return (
    <div className="page my-pieces-page">
      <div className="page-header my-pieces-header">
        <div>
          <h1>My Pieces</h1>
          <p className="my-pieces-intro">
            Follow what&apos;s moving through the studio, see the latest update
            and next step at a glance, and open any piece when you want the
            full story.
          </p>
        </div>
      </div>

      {status ? <div className="status-line">{status}</div> : null}
      {error ? <div className="card card-3d alert">{error}</div> : null}
      {piecesError ? (
        <div className="card card-3d alert">{piecesError}</div>
      ) : null}
      {piecesWarning ? (
        <div className="card card-3d alert">{piecesWarning}</div>
      ) : null}

      <RevealCard
        className="card card-3d my-pieces-carousel-shell"
        index={0}
        enabled={motionEnabled}
      >
        <div className="my-pieces-section-head">
          <div>
            <div className="card-title">Pieces in progress</div>
            <p className="piece-meta my-pieces-section-copy">
              A still-first pass through what&apos;s currently moving through
              the studio, with the latest update and next step surfaced inline.
            </p>
          </div>
          {activePieces.length > 1 ? (
            <div className="my-pieces-carousel-controls">
              <button
                type="button"
                className="btn btn-ghost btn-small"
                onClick={() => advanceCarousel(-1)}
                aria-label="Previous piece"
              >
                Back
              </button>
              <div className="my-pieces-carousel-counter">
                {activeCarouselIndex + 1} / {activePieces.length}
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-small"
                onClick={() => advanceCarousel(1)}
                aria-label="Next piece"
              >
                Next
              </button>
            </div>
          ) : null}
        </div>

        {piecesLoading ? (
          <div className="empty-state">Loading pieces...</div>
        ) : activePieceCount === 0 ? (
          <div className="empty-state">
            <div>Nothing is currently in progress.</div>
            <div className="piece-meta">
              New work will appear here as soon as it enters the studio flow.
            </div>
          </div>
        ) : (
          <div className="my-pieces-carousel-window">
            <div
              className="my-pieces-carousel-track"
              style={{
                transform: `translateX(-${activeCarouselIndex * 100}%)`,
              }}
            >
              {activePieces.map((piece) => (
                <button
                  key={piece.key}
                  type="button"
                  className="my-pieces-carousel-slide"
                  onClick={() => openPieceDetail(piece)}
                  aria-label={`Open in-progress piece ${piece.pieceCode || piece.id}`}
                >
                  <div className="my-piece-still" data-stage={piece.stage}>
                    <div className="my-piece-still-badge">
                      {STAGE_LABELS[piece.stage]}
                    </div>
                    <div className="my-piece-still-caption">Still preview</div>
                  </div>
                  <div className="my-piece-still-meta">
                    <div className="piece-title-row">
                      <div className="piece-title">
                        {piece.pieceCode || piece.id}
                      </div>
                      {piece.isArchived ? (
                        <div className="pill piece-status">Archived</div>
                      ) : null}
                    </div>
                    <div className="piece-meta">
                      {piece.shortDesc || "No description yet."}
                    </div>
                    <div className="piece-meta">
                      Check-in: {piece.batchTitle}
                    </div>
                    <div className="piece-meta">
                      {getPieceLatestUpdateLabel(piece)}
                    </div>
                    <div className="piece-meta">
                      {getPieceNextStepLabel(piece)}
                    </div>
                    <div className="my-piece-still-footer">
                      Tap to expose the full piece detail.
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </RevealCard>

      <RevealCard
        className="card card-3d my-pieces-rating-shell"
        index={1}
        enabled={motionEnabled}
      >
        <div className="my-pieces-section-head">
          <div>
            <div className="card-title">Needs rating</div>
            <p className="piece-meta my-pieces-section-copy">
              Recent finished pieces that still need your feedback.
            </p>
          </div>
          <div className="my-pieces-section-count">
            {piecesNeedingRating.length}
          </div>
        </div>

        {piecesLoading ? (
          <div className="empty-state">Loading ratings queue...</div>
        ) : piecesNeedingRating.length === 0 ? (
          <div className="empty-state">
            Everything currently loaded already has feedback.
          </div>
        ) : (
          <div className="my-pieces-list">
            {visiblePiecesNeedingRating.map((piece) => (
              <article className="my-pieces-list-row" key={piece.key}>
                <div className="my-pieces-list-summary">
                  <div className="piece-title-row">
                    <div className="piece-title">
                      {piece.pieceCode || piece.id}
                    </div>
                    <div className="pill piece-status">
                      {STAGE_LABELS[piece.stage]}
                    </div>
                  </div>
                  <div className="piece-meta">
                    {piece.shortDesc || "No description yet."}
                  </div>
                  <div className="piece-meta">Check-in: {piece.batchTitle}</div>
                  <div className="piece-meta">
                    {getPieceLatestUpdateLabel(piece)}
                  </div>
                  <div className="piece-meta">
                    {getPieceNextStepLabel(piece)}
                  </div>
                </div>
                <div className="my-pieces-list-actions">
                  <div className="my-pieces-list-inline-rating">
                    <StarRating
                      value={piece.clientRating}
                      onSelect={toVoidHandler((value: number) =>
                        handleRating(piece, value),
                      )}
                      disabled={isBusy(`rating:${piece.key}`)}
                      pulse={ratingPulseKey === piece.key}
                    />
                    <div className="feedback-meta">
                      {ratingStatus[piece.key] ||
                        "Rate this load whenever you’re ready."}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => openPieceDetail(piece)}
                    aria-label={`Open piece needing rating ${piece.pieceCode || piece.id}`}
                  >
                    Explore piece
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </RevealCard>

      <RevealCard
        className="card card-3d my-pieces-history-shell"
        index={2}
        enabled={motionEnabled}
      >
        <div className="my-pieces-section-head">
          <div>
            <div className="card-title">History</div>
            <p className="piece-meta my-pieces-section-copy">
              Completed pieces from earlier firings, with a simple way to open
              more.
            </p>
          </div>
          <div className="my-pieces-section-count">{historyPieceCount}</div>
        </div>

        {piecesLoading ? (
          <div className="empty-state">Loading history...</div>
        ) : historyPieceCount === 0 ? (
          <div className="empty-state">
            <div>Your first completed pieces will land here.</div>
            <div className="piece-meta">
              Older work appears automatically as batches close out.
            </div>
          </div>
        ) : (
          <div className="my-pieces-list">
            {visibleHistoryPieces.map((piece) => (
              <article className="my-pieces-list-row" key={piece.key}>
                <div className="my-pieces-list-summary">
                  <div className="piece-title-row">
                    <div className="piece-title">
                      {piece.pieceCode || piece.id}
                    </div>
                    <div className="pill piece-status">
                      {STAGE_LABELS[piece.stage]}
                    </div>
                    {piece.isArchived ? (
                      <div className="pill piece-status">Archived</div>
                    ) : null}
                  </div>
                  <div className="piece-meta">
                    {piece.shortDesc || "No description yet."}
                  </div>
                  <div className="piece-meta">Check-in: {piece.batchTitle}</div>
                  <div className="piece-meta">
                    {getPieceLatestUpdateLabel(piece)}
                  </div>
                  <div className="piece-meta">
                    {getPieceNextStepLabel(piece)}
                  </div>
                </div>
                <div className="my-pieces-list-actions">
                  <div className="piece-meta">
                    {piece.clientRating
                      ? `Rated ${piece.clientRating}★`
                      : "No rating yet"}
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => openPieceDetail(piece)}
                    aria-label={`Open history piece ${piece.pieceCode || piece.id}`}
                  >
                    Explore piece
                  </button>
                </div>
              </article>
            ))}
            {hasMoreHistoryPieces ? (
              <button
                type="button"
                className="btn btn-ghost my-pieces-show-more"
                onClick={handleShowMoreHistory}
              >
                Show more pieces
              </button>
            ) : null}
          </div>
        )}
      </RevealCard>

      {selectedPiece ? (
        <div
          className="my-piece-exploded-shell"
          role="dialog"
          aria-modal="true"
          aria-labelledby="piece-detail-title"
        >
          <button
            type="button"
            className="my-piece-exploded-backdrop"
            aria-label="Close piece detail"
            onClick={closePieceDetail}
          />
          <RevealCard
            className="card card-3d my-piece-exploded-panel"
            index={3}
            enabled={motionEnabled}
          >
            <div className="my-piece-exploded-header">
              <div className="my-piece-exploded-hero">
                <div
                  className="my-piece-still my-piece-exploded-visual"
                  data-stage={selectedPiece.stage}
                >
                  <div className="my-piece-still-badge">
                    {STAGE_LABELS[selectedPiece.stage]}
                  </div>
                  <div className="my-piece-still-caption">Still preview</div>
                </div>
                  <div className="my-piece-exploded-meta">
                    <div id="piece-detail-title" className="detail-title">
                      {selectedPiece.pieceCode || selectedPiece.id}
                    </div>
                    <div className="piece-meta">
                      {selectedPiece.shortDesc || "No description yet."}
                    </div>
                    <div className="piece-meta">
                      Check-in: {selectedPiece.batchTitle}
                    </div>
                    <div className="piece-meta">
                      {getPieceLatestUpdateLabel(selectedPiece)}
                    </div>
                    <div className="piece-meta">
                      {getPieceNextStepLabel(selectedPiece)}
                    </div>
                  </div>
                </div>
              <button className="btn btn-ghost" onClick={closePieceDetail}>
                Close
              </button>
            </div>

            <div className="my-piece-overview-grid">
              <div className="my-piece-overview-item">
                <span className="my-piece-overview-label">Stage</span>
                <strong>{getPieceJourneyStatus(selectedPiece)}</strong>
              </div>
              <div className="my-piece-overview-item">
                <span className="my-piece-overview-label">Latest update</span>
                <strong>{formatMaybeTimestamp(selectedPiece.updatedAt)}</strong>
              </div>
              <div className="my-piece-overview-item">
                <span className="my-piece-overview-label">Next step</span>
                <strong>{getPieceNextStepLabel(selectedPiece)}</strong>
              </div>
              <div className="my-piece-overview-item">
                <span className="my-piece-overview-label">Category</span>
                <strong>
                  {WARE_CATEGORY_LABELS[selectedPiece.wareCategory]}
                </strong>
              </div>
              <div className="my-piece-overview-item">
                <span className="my-piece-overview-label">Owner</span>
                <strong>{selectedPiece.ownerName || "Member"}</strong>
              </div>
              <div className="my-piece-overview-item">
                <span className="my-piece-overview-label">Feedback</span>
                <strong>
                  {selectedPiece.clientRating
                    ? `${selectedPiece.clientRating}★`
                    : "Not rated yet"}
                </strong>
              </div>
            </div>

            {isStaff ? (
              <div className="my-piece-studio-controls">
                <div className="section-title">Studio controls</div>
                <div className="form-grid collection-form-grid">
                  <div>
                    <label className="field-label" htmlFor="piece-desc">
                      Description
                    </label>
                    <input
                      id="piece-desc"
                      value={selectedPiece.shortDesc}
                      onChange={(event) =>
                        toVoidHandler(handleUpdatePiece)(selectedPiece, {
                          shortDesc: event.target.value,
                        })
                      }
                      placeholder="Short description"
                    />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="piece-category">
                      Category
                    </label>
                    <select
                      id="piece-category"
                      value={selectedPiece.wareCategory}
                      onChange={(event) =>
                        toVoidHandler(handleUpdatePiece)(selectedPiece, {
                          wareCategory: normalizeWareCategory(
                            event.target.value,
                          ),
                        })
                      }
                    >
                      {WARE_CATEGORIES.map((category) => (
                        <option value={category} key={category}>
                          {WARE_CATEGORY_LABELS[category]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="field-label" htmlFor="stage-select">
                      Stage
                    </label>
                    <select
                      id="stage-select"
                      value={selectedPiece.stage}
                      onChange={(event) =>
                        toVoidHandler(handleUpdatePiece)(selectedPiece, {
                          stage: normalizeStage(event.target.value),
                        })
                      }
                    >
                      {STAGES.map((stage) => (
                        <option value={stage} key={stage}>
                          {STAGE_LABELS[stage]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="piece-actions">
                    <button
                      className="btn btn-ghost"
                      onClick={toVoidHandler(() =>
                        handleArchivePiece(
                          selectedPiece,
                          !selectedPiece.isArchived,
                        ),
                      )}
                      disabled={isBusy(`update:${selectedPiece.key}`)}
                    >
                      {isBusy(`update:${selectedPiece.key}`)
                        ? "Saving..."
                        : selectedPiece.isArchived
                          ? "Restore piece"
                          : "Archive piece"}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="section-title">Feedback for the studio</div>
            <div className="feedback-card">
              <div className="feedback-copy">
                Tap to rate how the loading went. This helps the loaders and
                makers dial it in.
              </div>
              <StarRating
                value={selectedPiece.clientRating}
                onSelect={toVoidHandler((value: number) =>
                  handleRating(selectedPiece, value),
                )}
                disabled={isBusy(`rating:${selectedPiece.key}`)}
                pulse={ratingPulseKey === selectedPiece.key}
              />
              <div className="feedback-meta">
                {ratingStatus[selectedPiece.key] ||
                  "You can update this anytime."}
              </div>
            </div>

            <div className="tab-row">
              <button
                className={`chip ${selectedPieceTab === "client" ? "active" : ""}`}
                onClick={() => setSelectedPieceTab("client")}
              >
                {isStaff ? "Client notes" : "Your notes"}
              </button>
              {isStaff ? (
                <button
                  className={`chip ${selectedPieceTab === "studio" ? "active" : ""}`}
                  onClick={() => setSelectedPieceTab("studio")}
                >
                  Studio notes
                </button>
              ) : null}
              <button
                className={`chip ${selectedPieceTab === "photos" ? "active" : ""}`}
                onClick={() => setSelectedPieceTab("photos")}
              >
                Photos
              </button>
              <button
                className={`chip ${selectedPieceTab === "audit" ? "active" : ""}`}
                onClick={() => {
                  setSelectedPieceTab("audit");
                  track("timeline_open", {
                    uid: shortId(user.uid),
                    batchId: shortId(selectedPiece.batchId),
                  });
                }}
              >
                Timeline
              </button>
            </div>

            {pieceDetailLoading ? (
              <div className="empty-state">Loading detail...</div>
            ) : null}
            {pieceDetailError ? (
              <div className="alert inline-alert">{pieceDetailError}</div>
            ) : null}

            {selectedPieceTab === "client" ? (
              <div>
                <div className="form-grid note-form-grid">
                  <textarea
                    value={clientNoteDraft}
                    onChange={(event) => setClientNoteDraft(event.target.value)}
                    placeholder={
                      isStaff
                        ? "Add a client note"
                        : "Add a note about this piece"
                    }
                  />
                  <button
                    className="btn btn-primary"
                    onClick={toVoidHandler(() => handleAddNote("client"))}
                    disabled={isBusy(`addNote:${selectedPiece.key}:client`)}
                  >
                    {isBusy(`addNote:${selectedPiece.key}:client`)
                      ? "Adding..."
                      : "Add note"}
                  </button>
                </div>

                {clientNotes.length === 0 ? (
                  <div className="empty-state">No notes yet.</div>
                ) : (
                  <div className="note-list">
                    {clientNotes.map((note) => (
                      <div className="note-card" key={note.id}>
                        <div className="piece-meta">
                          {note.authorName || "Member"} ·{" "}
                          {formatMaybeTimestamp(note.at)}
                          {note.updatedAt
                            ? ` · edited ${formatMaybeTimestamp(note.updatedAt)}`
                            : ""}
                        </div>
                        {editingNoteId === note.id &&
                        editingNoteStream === "client" ? (
                          <div className="form-grid note-edit-grid">
                            <textarea
                              value={editingNoteText}
                              onChange={(event) =>
                                setEditingNoteText(event.target.value)
                              }
                            />
                            <div className="form-actions">
                              <button
                                className="btn btn-primary"
                                onClick={toVoidHandler(handleSaveNoteEdit)}
                                disabled={isBusy(`editNote:${note.id}`)}
                              >
                                {isBusy(`editNote:${note.id}`)
                                  ? "Saving..."
                                  : "Save"}
                              </button>
                              <button
                                className="btn btn-ghost"
                                onClick={cancelEditingNote}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div>
                            <div>{note.text}</div>
                            {canEditNote(note, "client") ? (
                              <button
                                className="btn btn-ghost"
                                onClick={() => startEditingNote(note, "client")}
                              >
                                Edit
                              </button>
                            ) : null}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}

            {selectedPieceTab === "studio" && isStaff ? (
              <div>
                <div className="form-grid note-form-grid">
                  <textarea
                    value={studioNoteDraft}
                    onChange={(event) => setStudioNoteDraft(event.target.value)}
                    placeholder="Add a studio note"
                  />
                  <button
                    className="btn btn-primary"
                    onClick={toVoidHandler(() => handleAddNote("studio"))}
                    disabled={isBusy(`addNote:${selectedPiece.key}:studio`)}
                  >
                    {isBusy(`addNote:${selectedPiece.key}:studio`)
                      ? "Adding..."
                      : "Add note"}
                  </button>
                </div>

                {studioNotes.length === 0 ? (
                  <div className="empty-state">No studio notes yet.</div>
                ) : (
                  <div className="note-list">
                    {studioNotes.map((note) => (
                      <div className="note-card" key={note.id}>
                        <div className="piece-meta">
                          {note.authorName || "Staff"} ·{" "}
                          {formatMaybeTimestamp(note.at)}
                          {note.updatedAt
                            ? ` · edited ${formatMaybeTimestamp(note.updatedAt)}`
                            : ""}
                        </div>
                        {editingNoteId === note.id &&
                        editingNoteStream === "studio" ? (
                          <div className="form-grid note-edit-grid">
                            <textarea
                              value={editingNoteText}
                              onChange={(event) =>
                                setEditingNoteText(event.target.value)
                              }
                            />
                            <div className="form-actions">
                              <button
                                className="btn btn-primary"
                                onClick={toVoidHandler(handleSaveNoteEdit)}
                                disabled={isBusy(`editNote:${note.id}`)}
                              >
                                {isBusy(`editNote:${note.id}`)
                                  ? "Saving..."
                                  : "Save"}
                              </button>
                              <button
                                className="btn btn-ghost"
                                onClick={cancelEditingNote}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div>
                            <div>{note.text}</div>
                            {canEditNote(note, "studio") ? (
                              <button
                                className="btn btn-ghost"
                                onClick={() => startEditingNote(note, "studio")}
                              >
                                Edit
                              </button>
                            ) : null}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}

            {selectedPieceTab === "photos" ? (
              <div>
                {mediaItems.length === 0 ? (
                  <div className="empty-state">No photos yet.</div>
                ) : (
                  <div className="note-list">
                    {mediaItems.map((item) => (
                      <div className="note-card" key={item.id}>
                        <div className="piece-title-row">
                          <div className="piece-title">{item.storagePath}</div>
                          <div className="pill piece-status">
                            {STAGE_LABELS[item.stage]}
                          </div>
                        </div>
                        <div className="piece-meta">
                          {item.uploadedByName
                            ? `by ${item.uploadedByName}`
                            : ""}
                          {item.at ? ` · ${formatMaybeTimestamp(item.at)}` : ""}
                        </div>
                        {item.caption ? <div>{item.caption}</div> : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}

            {selectedPieceTab === "audit" ? (
              <div>
                {auditEvents.length === 0 ? (
                  <div className="empty-state">No timeline events yet.</div>
                ) : (
                  <div className="note-list">
                    {auditEvents.map((event) => (
                      <div className="note-card" key={event.id}>
                        <div className="piece-title-row">
                          <div className="piece-title">{event.type}</div>
                          {event.noteStream ? (
                            <div className="pill piece-status">
                              {event.noteStream}
                            </div>
                          ) : null}
                        </div>
                        <div className="piece-meta">
                          {event.actorName ? `by ${event.actorName}` : ""}
                          {event.at
                            ? ` · ${formatMaybeTimestamp(event.at)}`
                            : ""}
                        </div>
                        {event.notes ? <div>{event.notes}</div> : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </RevealCard>
        </div>
      ) : null}
    </div>
  );
}

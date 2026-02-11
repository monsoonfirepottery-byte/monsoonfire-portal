
import { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "../firebase";
import { useBatches } from "../hooks/useBatches";
import { createPortalApi, PortalApiError } from "../api/portalApi";
import type { PortalApiMeta } from "../api/portalContracts";
import { getResultBatchId } from "../api/portalContracts";
import { formatMaybeTimestamp } from "../utils/format";
import { toVoidHandler } from "../utils/toVoidHandler";
import RevealCard from "../components/RevealCard";
import { useUiSettings } from "../context/UiSettingsContext";

const PIECES_PREVIEW_COUNT = 12;
const NOTE_LOAD_LIMIT = 40;
const MEDIA_LOAD_LIMIT = 30;
const AUDIT_LOAD_LIMIT = 60;
const CHECKIN_PREFILL_KEY = "mf_checkin_prefill";

const STAGES = ["GREENWARE", "BISQUE", "GLAZED", "FINISHED", "HOLD", "UNKNOWN"] as const;
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

type Props = {
  user: User;
  adminToken?: string;
  isStaff: boolean;
  onOpenCheckin?: () => void;
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

type LocalMeta = {
  ok: boolean;
  status: number | string | null;
  fn: string;
  url: string;
  payload: unknown;
  response: unknown;
  curlExample?: string;
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

function normalizeAuditDoc(id: string, raw: Partial<PieceAuditEvent>): PieceAuditEvent {
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
  if (value && typeof value === "object" && typeof (value as { toMillis?: () => number }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  return new Date((value as string | number | Date | null) ?? 0).getTime();
}

type StarRatingProps = {
  value: number | null | undefined;
  onSelect: (value: number) => void;
  disabled?: boolean;
  pulse?: boolean;
};

function StarRating({ value, onSelect, disabled, pulse }: StarRatingProps) {
  return (
    <div className={`rating-stars ${pulse ? "rating-pulse" : ""}`} aria-label="Piece rating">
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

export default function MyPiecesView({ user, adminToken, isStaff, onOpenCheckin }: Props) {
  const { themeName, portalMotion } = useUiSettings();
  const motionEnabled = themeName === "memoria" && portalMotion === "enhanced";
  const { active, history, error } = useBatches(user);
  const [status, setStatus] = useState("");
  const [meta, setMeta] = useState<PortalApiMeta | LocalMeta | null>(null);
  const [inFlight, setInFlight] = useState<Record<string, boolean>>({});
  const portalApi = useMemo(() => createPortalApi(), []);

  const isBusy = useCallback((key: string) => !!inFlight[key], [inFlight]);
  const setBusy = useCallback((key: string, value: boolean) => {
    setInFlight((prev) => ({ ...prev, [key]: value }));
  }, []);

  const [pieces, setPieces] = useState<PieceDoc[]>([]);
  const [piecesLoading, setPiecesLoading] = useState(false);
  const [piecesError, setPiecesError] = useState("");
  const [selectedPieceKey, setSelectedPieceKey] = useState<string | null>(null);
  const [selectedPieceTab, setSelectedPieceTab] = useState<"client" | "studio" | "photos" | "audit">(
    "client"
  );
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
  const [editingNoteStream, setEditingNoteStream] = useState<PieceNoteStream | null>(null);
  const [editingNoteText, setEditingNoteText] = useState("");

  const [piecesFilter, setPiecesFilter] = useState<"all" | "active" | "history">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"recent" | "oldest" | "stage" | "rating">("recent");
  const [ratingStatus, setRatingStatus] = useState<Record<string, string>>({});
  const [ratingPulseKey, setRatingPulseKey] = useState<string | null>(null);

  const canContinue = active.length === 0;
  const historyBatchIds = useMemo(() => new Set(history.map((batch) => batch.id)), [history]);
  const totalPieceCount = pieces.length;

  useEffect(() => {
    if (!user) {
      setPieces([]);
      return;
    }

    const loadPieces = async () => {
      const busyKey = "loadPieces";
      if (isBusy(busyKey)) return;
      setBusy(busyKey, true);
      setPiecesLoading(true);
      setPiecesError("");

      try {
        const batches = [...active, ...history];
        if (batches.length === 0) {
          setPieces([]);
          return;
        }

        const rows = await Promise.all(
          batches.map(async (batch) => {
            const piecesQuery = query(
              collection(db, "batches", batch.id, "pieces"),
              orderBy("updatedAt", "desc"),
              limit(200)
            );
            const snap = await getDocs(piecesQuery);
            return snap.docs.map((docSnap) => {
              const data = docSnap.data() as Partial<PieceDoc>;
              const batchTitle =
                typeof batch.title === "string" && batch.title.trim() ? batch.title : "Check-in";
              return {
                id: docSnap.id,
                key: `${batch.id}:${docSnap.id}`,
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
                clientRating: typeof data.clientRating === "number" ? data.clientRating : null,
                clientRatingUpdatedAt: data.clientRatingUpdatedAt ?? null,
              } as PieceDoc;
            });
          })
        );

        setPieces(rows.flat());
      } catch (error: unknown) {
        setPiecesError(`Pieces failed: ${getErrorMessage(error)}`);
      } finally {
        setPiecesLoading(false);
        setBusy(busyKey, false);
      }
    };

    void loadPieces();
  }, [user, active, history, historyBatchIds, isBusy, setBusy]);

  const selectedPiece = useMemo(
    () => pieces.find((piece) => piece.key === selectedPieceKey) ?? null,
    [pieces, selectedPieceKey]
  );

  useEffect(() => {
    if (!selectedPieceKey) return;
    const stillExists = pieces.some((piece) => piece.key === selectedPieceKey);
    if (!stillExists) setSelectedPieceKey(null);
  }, [pieces, selectedPieceKey]);

  useEffect(() => {
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
      const busyKey = `loadPiece:${selectedPiece.key}`;
      if (isBusy(busyKey)) return;
      setBusy(busyKey, true);
      setPieceDetailLoading(true);
      setPieceDetailError("");

      try {
        const clientQuery = query(
          collection(db, "batches", selectedPiece.batchId, "pieces", selectedPiece.id, "clientNotes"),
          orderBy("at", "desc"),
          limit(NOTE_LOAD_LIMIT)
        );
        const studioQuery = query(
          collection(db, "batches", selectedPiece.batchId, "pieces", selectedPiece.id, "studioNotes"),
          orderBy("at", "desc"),
          limit(NOTE_LOAD_LIMIT)
        );
        const auditQuery = query(
          collection(db, "batches", selectedPiece.batchId, "pieces", selectedPiece.id, "audit"),
          orderBy("at", "desc"),
          limit(AUDIT_LOAD_LIMIT)
        );
        const mediaQuery = query(
          collection(db, "batches", selectedPiece.batchId, "pieces", selectedPiece.id, "media"),
          orderBy("at", "desc"),
          limit(MEDIA_LOAD_LIMIT)
        );

        const [clientSnap, studioSnap, auditSnap, mediaSnap] = await Promise.all([
          getDocs(clientQuery),
          getDocs(studioQuery),
          getDocs(auditQuery),
          getDocs(mediaQuery),
        ]);

        setClientNotes(
          clientSnap.docs.map((docSnap) =>
            buildNoteDoc({ id: docSnap.id, ...(docSnap.data() as Partial<PieceNote>) })
          )
        );
        setStudioNotes(
          studioSnap.docs.map((docSnap) =>
            buildNoteDoc({ id: docSnap.id, ...(docSnap.data() as Partial<PieceNote>) })
          )
        );
        setAuditEvents(
          auditSnap.docs.map((docSnap) =>
            normalizeAuditDoc(docSnap.id, docSnap.data() as Partial<PieceAuditEvent>)
          )
        );
        setMediaItems(
          mediaSnap.docs.map((docSnap) =>
            normalizeMediaDoc(docSnap.id, docSnap.data() as Partial<PieceMedia>)
          )
        );
      } catch (error: unknown) {
        setPieceDetailError(`Piece detail failed: ${getErrorMessage(error)}`);
      } finally {
        setPieceDetailLoading(false);
        setBusy(busyKey, false);
      }
    };

    void loadPieceDetails();
  }, [selectedPiece, detailRefreshKey, isBusy, setBusy]);

  const filteredPieces = useMemo(() => {
    let list = pieces;
    if (piecesFilter === "active") {
      list = list.filter((piece) => !piece.batchIsHistory);
    } else if (piecesFilter === "history") {
      list = list.filter((piece) => piece.batchIsHistory);
    }

    if (searchQuery.trim()) {
      const queryLower = searchQuery.toLowerCase();
      list = list.filter((piece) => {
        const fields = [piece.pieceCode, piece.shortDesc, piece.ownerName, piece.batchTitle];
        return fields.some((field) => field?.toLowerCase().includes(queryLower));
      });
    }

    const sorted = [...list];
    sorted.sort((a, b) => {
      const timeA = toMillis(a.updatedAt);
      const timeB = toMillis(b.updatedAt);
      switch (sortBy) {
        case "oldest":
          return timeA - timeB;
        case "stage":
          return a.stage.localeCompare(b.stage);
        case "rating":
          return (b.clientRating ?? 0) - (a.clientRating ?? 0);
        case "recent":
        default:
          return timeB - timeA;
      }
    });
    return sorted;
  }, [pieces, piecesFilter, searchQuery, sortBy]);

  const visiblePieces =
    piecesFilter === "all" ? filteredPieces.slice(0, PIECES_PREVIEW_COUNT) : filteredPieces;

  const selectedPieceCanContinue =
    selectedPiece?.stage === "BISQUE" || selectedPiece?.stage === "GREENWARE";

  const handleUpdatePiece = async (piece: PieceDoc, payload: Record<string, unknown>) => {
    const busyKey = `update:${piece.key}`;
    if (isBusy(busyKey)) return;
    setBusy(busyKey, true);
    setStatus("");

    try {
      await updateDoc(doc(db, "batches", piece.batchId, "pieces", piece.id), {
        ...payload,
        updatedAt: serverTimestamp(),
      });
      setPieces((prev) =>
        prev.map((row) => (row.key === piece.key ? { ...row, ...payload } : row))
      );
    } catch (error: unknown) {
      setStatus(`Update failed: ${getErrorMessage(error)}`);
    } finally {
      setBusy(busyKey, false);
    }
  };

  const handleArchivePiece = async (piece: PieceDoc, archived: boolean) => {
    await handleUpdatePiece(piece, { isArchived: archived });
  };

  const handleRating = async (piece: PieceDoc, rating: number) => {
    const busyKey = `rating:${piece.key}`;
    if (isBusy(busyKey)) return;
    setBusy(busyKey, true);
    setRatingStatus((prev) => ({ ...prev, [piece.key]: "" }));

    try {
      await updateDoc(doc(db, "batches", piece.batchId, "pieces", piece.id), {
        clientRating: rating,
        clientRatingUpdatedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setPieces((prev) =>
        prev.map((row) =>
          row.key === piece.key ? { ...row, clientRating: rating, clientRatingUpdatedAt: new Date() } : row
        )
      );
      setRatingStatus((prev) => ({ ...prev, [piece.key]: "Thanks — saved." }));
      setRatingPulseKey(piece.key);
      setTimeout(() => {
        setRatingPulseKey((current) => (current === piece.key ? null : current));
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
    const text = stream === "client" ? clientNoteDraft.trim() : studioNoteDraft.trim();
    if (!text) return;
    const busyKey = `addNote:${selectedPiece.key}:${stream}`;
    if (isBusy(busyKey)) return;
    setBusy(busyKey, true);

    try {
      const payload = {
        text,
        at: serverTimestamp(),
        authorUid: user.uid,
        authorName: user.displayName || (stream === "client" ? "Member" : "Staff"),
        searchTokens: toTokens(text),
      };
      await addDoc(
        collection(
          db,
          "batches",
          selectedPiece.batchId,
          "pieces",
          selectedPiece.id,
          stream === "client" ? "clientNotes" : "studioNotes"
        ),
        payload
      );
      await addDoc(
        collection(db, "batches", selectedPiece.batchId, "pieces", selectedPiece.id, "audit"),
        {
          type: "NOTE_ADDED",
          at: serverTimestamp(),
          actorUid: user.uid,
          actorName: user.displayName || "Member",
          noteStream: stream,
          notes: text,
        }
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
      await updateDoc(
        doc(
          db,
          "batches",
          selectedPiece.batchId,
          "pieces",
          selectedPiece.id,
          editingNoteStream === "client" ? "clientNotes" : "studioNotes",
          editingNoteId
        ),
        {
          text: editingNoteText.trim(),
          updatedAt: serverTimestamp(),
          searchTokens: toTokens(editingNoteText),
        }
      );
      await addDoc(
        collection(db, "batches", selectedPiece.batchId, "pieces", selectedPiece.id, "audit"),
        {
          type: "NOTE_EDITED",
          at: serverTimestamp(),
          actorUid: user.uid,
          actorName: user.displayName || "Member",
          noteStream: editingNoteStream,
          noteId: editingNoteId,
          notes: editingNoteText.trim(),
        }
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

  async function continueJourneyAndGetBatchId(batchId: string) {
    if (!batchId) return null;
    const busyKey = `continue:${batchId}`;
    if (isBusy(busyKey)) return null;

    setBusy(busyKey, true);
    setStatus("Continuing journey...");
    setMeta(null);

    try {
      const idToken = await user.getIdToken();
      const trimmedAdminToken = adminToken ? adminToken.trim() : "";
      const response = await portalApi.continueJourney({
        idToken,
        adminToken: trimmedAdminToken ? trimmedAdminToken : undefined,
        payload: { uid: user.uid, fromBatchId: batchId },
      });
      setMeta(response.meta);
      const newId = getResultBatchId(response.data);
      setStatus(newId ? `Journey continued. New batch id: ${newId}` : "Journey continued.");
      return newId ?? batchId;
    } catch (error: unknown) {
      if (error instanceof PortalApiError) {
        setMeta(error.meta);
        setStatus(`Continue journey failed: ${error.message}`);
      } else {
        setStatus(`Continue journey failed: ${getErrorMessage(error)}`);
      }
      return null;
    } finally {
      setBusy(busyKey, false);
    }
  }

  async function handleSendToNextFiring(piece: PieceDoc) {
    if (!onOpenCheckin) return;
    const nextFiringType = piece.stage === "BISQUE" ? "glaze" : piece.stage === "GREENWARE" ? "bisque" : null;
    if (!nextFiringType) {
      setStatus("This ware is already past firing.");
      return;
    }
    const nextBatchId = await continueJourneyAndGetBatchId(piece.batchId);
    if (!nextBatchId) return;

    try {
      sessionStorage.setItem(
        CHECKIN_PREFILL_KEY,
        JSON.stringify({
          linkedBatchId: nextBatchId,
          firingType: nextFiringType,
          pieceCode: piece.pieceCode || piece.id,
        })
      );
    } catch {
      // Ignore storage issues.
    }

    onOpenCheckin();
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>My Pieces</h1>
      </div>

      {status ? <div className="status-line">{status}</div> : null}
      {error ? <div className="card card-3d alert">{error}</div> : null}

      {!canContinue && history.length > 0 ? (
        <div className="card card-3d alert">
          Continue journey is available once all active pieces are closed.
        </div>
      ) : null}

      <div className="pieces-toolbar">
        <div className="filter-chips">
          <button
            className={`chip ${piecesFilter === "all" ? "active" : ""}`}
            onClick={() => setPiecesFilter("all")}
          >
            All ({totalPieceCount})
          </button>
          <button
            className={`chip ${piecesFilter === "active" ? "active" : ""}`}
            onClick={() => setPiecesFilter("active")}
          >
            In progress ({pieces.filter((piece) => !piece.batchIsHistory).length})
          </button>
          <button
            className={`chip ${piecesFilter === "history" ? "active" : ""}`}
            onClick={() => setPiecesFilter("history")}
          >
            History ({pieces.filter((piece) => piece.batchIsHistory).length})
          </button>
        </div>
        <div className="toolbar-fields">
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search pieces"
          />
          <select value={sortBy} onChange={(event) => setSortBy(event.target.value as typeof sortBy)}>
            <option value="recent">Newest updates</option>
            <option value="oldest">Oldest updates</option>
            <option value="stage">Stage</option>
            <option value="rating">Rating</option>
          </select>
        </div>
      </div>

      <div className="cta-bar">
        <div className="piece-meta">
          Use Ware Check-in to add new pieces. You can archive, rate, and update details right here.
        </div>
      </div>

      <div className="wares-layout">
        <div className="pieces-grid collections-pane">
          <RevealCard className="card card-3d" index={0} enabled={motionEnabled}>
            <div className="card-title">
              {piecesFilter === "history" ? "History" : piecesFilter === "active" ? "In progress" : "Your pieces"}
            </div>
            {piecesLoading ? (
              <div className="empty-state">Loading pieces...</div>
            ) : piecesError ? (
              <div className="alert inline-alert">{piecesError}</div>
            ) : visiblePieces.length === 0 ? (
              <div className="empty-state">No pieces yet.</div>
            ) : (
              <div className="pieces-list">
                {visiblePieces.map((piece) => (
                  <div className="piece-row" key={piece.key}>
                    <div>
                      <div className="piece-title-row">
                        <div className="piece-title">{piece.pieceCode || piece.id}</div>
                        <div className="pill piece-status">{piece.stage}</div>
                        {piece.isArchived ? <div className="pill piece-status">Archived</div> : null}
                      </div>
                      <div className="piece-meta">{piece.shortDesc || "No description yet."}</div>
                      <div className="piece-meta">Check-in: {piece.batchTitle}</div>
                      <div className="piece-meta">
                        Updated: {formatMaybeTimestamp(piece.updatedAt)}
                      </div>
                    </div>
                    <div className="piece-right">
                      <div className="piece-meta">
                        {piece.clientRating ? `Rating: ${piece.clientRating}★` : "No rating yet"}
                      </div>
                      <div className="piece-actions">
                        <button className="btn btn-ghost" onClick={() => setSelectedPieceKey(piece.key)}>
                          View details
                        </button>
                        <button
                          className="btn btn-ghost"
                          onClick={toVoidHandler(() => handleArchivePiece(piece, !piece.isArchived))}
                          disabled={isBusy(`update:${piece.key}`)}
                        >
                          {isBusy(`update:${piece.key}`)
                            ? "Saving..."
                            : piece.isArchived
                              ? "Restore"
                              : "Archive"}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                {piecesFilter === "all" && filteredPieces.length > PIECES_PREVIEW_COUNT ? (
                  <div className="piece-meta">
                    Showing {PIECES_PREVIEW_COUNT} of {filteredPieces.length}. Use filters to see more.
                  </div>
                ) : null}
              </div>
            )}
          </RevealCard>
        </div>

        <RevealCard className="card card-3d collection-detail-pane" index={1} enabled={motionEnabled}>
          <div className="card-title">Piece detail</div>
          {!selectedPiece ? (
            <div className="empty-state">Select a piece to view details.</div>
          ) : (
            <div className="detail-grid">
              <div className="detail-block">
                <div className="detail-header">
                  <div>
                    <div className="detail-title">{selectedPiece.pieceCode || selectedPiece.id}</div>
                    <div className="piece-meta">{selectedPiece.shortDesc}</div>
                    <div className="piece-meta">Owner: {selectedPiece.ownerName}</div>
                    <div className="piece-meta">Check-in: {selectedPiece.batchTitle}</div>
                    <div className="piece-meta">
                      Updated: {formatMaybeTimestamp(selectedPiece.updatedAt)}
                    </div>
                  </div>
                  <button className="btn btn-ghost" onClick={() => setSelectedPieceKey(null)}>
                    Close
                  </button>
                </div>

                <div className="section-title">Piece details</div>
                <div className="form-grid collection-form-grid">
                  <div>
                    <label className="field-label" htmlFor="piece-desc">
                      Description
                    </label>
                    <input
                      id="piece-desc"
                      value={selectedPiece.shortDesc}
                      onChange={(event) =>
                        toVoidHandler(handleUpdatePiece)(
                          selectedPiece,
                          { shortDesc: event.target.value }
                        )
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
                          wareCategory: normalizeWareCategory(event.target.value),
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
                          {stage}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="piece-actions">
                    <button
                      className="btn btn-ghost"
                      onClick={toVoidHandler(() =>
                        handleArchivePiece(selectedPiece, !selectedPiece.isArchived)
                      )}
                    >
                      {selectedPiece.isArchived ? "Restore piece" : "Archive piece"}
                    </button>
                    {selectedPieceCanContinue ? (
                      <button
                        className="btn btn-ghost"
                        onClick={toVoidHandler(() => handleSendToNextFiring(selectedPiece))}
                      >
                        Send to next firing
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="section-title">Feedback for the studio</div>
                <div className="feedback-card">
                  <div className="feedback-copy">
                    Tap to rate how the loading went. This helps the loaders and makers dial it in.
                  </div>
                  <StarRating
                    value={selectedPiece.clientRating}
                    onSelect={toVoidHandler((value: number) => handleRating(selectedPiece, value))}
                    disabled={isBusy(`rating:${selectedPiece.key}`)}
                    pulse={ratingPulseKey === selectedPiece.key}
                  />
                  <div className="feedback-meta">
                    {ratingStatus[selectedPiece.key] || "You can update this anytime."}
                  </div>
                </div>

                <div className="tab-row">
                  <button
                    className={`chip ${selectedPieceTab === "client" ? "active" : ""}`}
                    onClick={() => setSelectedPieceTab("client")}
                  >
                    Client notes
                  </button>
                  <button
                    className={`chip ${selectedPieceTab === "studio" ? "active" : ""}`}
                    onClick={() => setSelectedPieceTab("studio")}
                  >
                    Studio notes
                  </button>
                  <button
                    className={`chip ${selectedPieceTab === "photos" ? "active" : ""}`}
                    onClick={() => setSelectedPieceTab("photos")}
                  >
                    Photos
                  </button>
                  <button
                    className={`chip ${selectedPieceTab === "audit" ? "active" : ""}`}
                    onClick={() => setSelectedPieceTab("audit")}
                  >
                    Audit
                  </button>
                </div>

                {pieceDetailLoading ? <div className="empty-state">Loading detail...</div> : null}
                {pieceDetailError ? <div className="alert inline-alert">{pieceDetailError}</div> : null}

                {selectedPieceTab === "client" ? (
                  <div>
                    <div className="form-grid note-form-grid">
                      <textarea
                        value={clientNoteDraft}
                        onChange={(event) => setClientNoteDraft(event.target.value)}
                        placeholder="Add a client note"
                      />
                      <button
                        className="btn btn-primary"
                        onClick={toVoidHandler(() => handleAddNote("client"))}
                        disabled={isBusy(`addNote:${selectedPiece.key}:client`)}
                      >
                        {isBusy(`addNote:${selectedPiece.key}:client`) ? "Adding..." : "Add note"}
                      </button>
                    </div>

                    {clientNotes.length === 0 ? (
                      <div className="empty-state">No client notes yet.</div>
                    ) : (
                      <div className="note-list">
                        {clientNotes.map((note) => (
                          <div className="note-card" key={note.id}>
                            <div className="piece-meta">
                              {note.authorName || "Member"} · {formatMaybeTimestamp(note.at)}
                              {note.updatedAt ? ` · edited ${formatMaybeTimestamp(note.updatedAt)}` : ""}
                            </div>
                            {editingNoteId === note.id && editingNoteStream === "client" ? (
                              <div className="form-grid note-edit-grid">
                                <textarea
                                  value={editingNoteText}
                                  onChange={(event) => setEditingNoteText(event.target.value)}
                                />
                                <div className="form-actions">
                                  <button
                                    className="btn btn-primary"
                                    onClick={toVoidHandler(handleSaveNoteEdit)}
                                    disabled={isBusy(`editNote:${note.id}`)}
                                  >
                                    {isBusy(`editNote:${note.id}`) ? "Saving..." : "Save"}
                                  </button>
                                  <button className="btn btn-ghost" onClick={cancelEditingNote}>
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div>
                                <div>{note.text}</div>
                                {canEditNote(note, "client") ? (
                                  <button className="btn btn-ghost" onClick={() => startEditingNote(note, "client")}>
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
                {selectedPieceTab === "studio" ? (
                  <div>
                    {!isStaff ? (
                      <div className="alert inline-alert">Studio notes are staff-only.</div>
                    ) : (
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
                          {isBusy(`addNote:${selectedPiece.key}:studio`) ? "Adding..." : "Add note"}
                        </button>
                      </div>
                    )}

                    {studioNotes.length === 0 ? (
                      <div className="empty-state">No studio notes yet.</div>
                    ) : (
                      <div className="note-list">
                        {studioNotes.map((note) => (
                          <div className="note-card" key={note.id}>
                            <div className="piece-meta">
                              {note.authorName || "Staff"} · {formatMaybeTimestamp(note.at)}
                              {note.updatedAt ? ` · edited ${formatMaybeTimestamp(note.updatedAt)}` : ""}
                            </div>
                            {editingNoteId === note.id && editingNoteStream === "studio" ? (
                              <div className="form-grid note-edit-grid">
                                <textarea
                                  value={editingNoteText}
                                  onChange={(event) => setEditingNoteText(event.target.value)}
                                />
                                <div className="form-actions">
                                  <button
                                    className="btn btn-primary"
                                    onClick={toVoidHandler(handleSaveNoteEdit)}
                                    disabled={isBusy(`editNote:${note.id}`)}
                                  >
                                    {isBusy(`editNote:${note.id}`) ? "Saving..." : "Save"}
                                  </button>
                                  <button className="btn btn-ghost" onClick={cancelEditingNote}>
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div>
                                <div>{note.text}</div>
                                {canEditNote(note, "studio") ? (
                                  <button className="btn btn-ghost" onClick={() => startEditingNote(note, "studio")}>
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
                              <div className="pill piece-status">{item.stage}</div>
                            </div>
                            <div className="piece-meta">
                              {item.uploadedByName ? `by ${item.uploadedByName}` : ""}
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
                      <div className="empty-state">No audit events yet.</div>
                    ) : (
                      <div className="note-list">
                        {auditEvents.map((event) => (
                          <div className="note-card" key={event.id}>
                            <div className="piece-title-row">
                              <div className="piece-title">{event.type}</div>
                              {event.noteStream ? (
                                <div className="pill piece-status">{event.noteStream}</div>
                              ) : null}
                            </div>
                            <div className="piece-meta">
                              {event.actorName ? `by ${event.actorName}` : ""}
                              {event.at ? ` · ${formatMaybeTimestamp(event.at)}` : ""}
                            </div>
                            {event.notes ? <div>{event.notes}</div> : null}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </RevealCard>
      </div>

      {meta ? (
        <details className="card card-3d troubleshooting">
          <summary>Request details</summary>
          <div className="troubleshooting-grid">
            <div className="troubleshooting-block">
              <div className="troubleshooting-label">Status</div>
              <div className="troubleshooting-value">
                {meta.ok ? "OK" : "Error"} · {meta.status ?? "No status"}
              </div>
            </div>
            <div className="troubleshooting-block">
              <div className="troubleshooting-label">Endpoint</div>
              <div className="troubleshooting-value">
                {meta.fn} · {meta.url}
              </div>
            </div>
          </div>
          <div className="troubleshooting-block">
            <div className="troubleshooting-label">Curl (copy/paste)</div>
            <pre className="mono">{meta.curlExample || "Unavailable"}</pre>
          </div>
          <div className="troubleshooting-block">
            <div className="troubleshooting-label">Request payload</div>
            <pre className="mono">{JSON.stringify(meta.payload ?? {}, null, 2)}</pre>
          </div>
          <div className="troubleshooting-block">
            <div className="troubleshooting-label">Response body</div>
            <pre className="mono">{JSON.stringify(meta.response ?? {}, null, 2)}</pre>
          </div>
          <div className="troubleshooting-block">
            <div className="troubleshooting-label">Raw meta</div>
            <pre className="mono">{JSON.stringify(meta, null, 2)}</pre>
          </div>
        </details>
      ) : null}
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  getDoc,
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
import type { TimelineEvent } from "../types/domain";
import { TIMELINE_EVENT_LABELS, normalizeTimelineEventType } from "../timelineEventTypes";
import { formatCents, formatMaybeTimestamp } from "../utils/format";

const PIECES_PREVIEW_COUNT = 10;
const SEARCH_PIECE_LIMIT = 20;
const SEARCH_NOTES_PER_PIECE = 30;
const NOTE_LOAD_LIMIT = 40;
const MEDIA_LOAD_LIMIT = 30;
const AUDIT_LOAD_LIMIT = 60;

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
};

type PieceDoc = {
  id: string;
  pieceCode: string;
  shortDesc: string;
  ownerName: string;
  stage: Stage;
  wareCategory: WareCategory;
  isArchived: boolean;
  createdAt?: any;
  updatedAt?: any;
};

type PieceNoteStream = "client" | "studio";

type PieceNote = {
  id: string;
  text: string;
  at?: any;
  updatedAt?: any;
  authorUid?: string;
  authorName: string;
  searchTokens?: string[];
};

function makeClientRequestId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `req_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
  }
}

type PieceAuditEvent = {
  id: string;
  type: string;
  at?: any;
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
  at?: any;
  uploadedByUid?: string;
  uploadedByName?: string;
  searchTokens?: string[];
};

type NoteSearchResult = {
  pieceId: string;
  pieceCode: string;
  stream: PieceNoteStream;
  note: PieceNote;
};

type LocalMeta = {
  ok: boolean;
  status: number | string | null;
  fn: string;
  url: string;
  payload: any;
  response: any;
  curlExample?: string;
};

function getTimelineLabel(type: unknown): string {
  const normalized = normalizeTimelineEventType(type);
  if (normalized) return TIMELINE_EVENT_LABELS[normalized];
  if (typeof type === "string" && type.trim()) return type;
  return "Event";
}

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

function buildNoteDoc(note: any): PieceNote {
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

function groupPiecesByCategory(pieces: PieceDoc[]) {
  const groups: Record<WareCategory, PieceDoc[]> = {
    STONEWARE: [],
    EARTHENWARE: [],
    PORCELAIN: [],
    RAKU: [],
    OTHER: [],
    UNKNOWN: [],
  };
  pieces.forEach((piece) => {
    groups[piece.wareCategory].push(piece);
  });
  return groups;
}
export default function MyPiecesView({ user, adminToken, isStaff }: Props) {
  const { active, history, error } = useBatches(user);
  const canContinue = active.length === 0;
  const [status, setStatus] = useState("");
  const [meta, setMeta] = useState<PortalApiMeta | LocalMeta | null>(null);
  const [inFlight, setInFlight] = useState<Record<string, boolean>>({});
  const portalApi = useMemo(() => createPortalApi(), []);
  const [createCollectionRequestId, setCreateCollectionRequestId] = useState<string | null>(null);

  const isBusy = (key: string) => !!inFlight[key];
  const setBusy = (key: string, value: boolean) => {
    setInFlight((prev) => ({ ...prev, [key]: value }));
  };
  const [showAllActive, setShowAllActive] = useState(false);
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [timelineBatchId, setTimelineBatchId] = useState<string | null>(null);
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState("");
  const [piecesFilter, setPiecesFilter] = useState<"all" | "active" | "history">("all");

  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [selectedBatchTitle, setSelectedBatchTitle] = useState("");
  const [collectionNameDraft, setCollectionNameDraft] = useState("");
  const [collectionDescDraft, setCollectionDescDraft] = useState("");
  const [collectionMetaLoading, setCollectionMetaLoading] = useState(false);
  const [collectionMetaError, setCollectionMetaError] = useState("");
  const [collectionOverrides, setCollectionOverrides] = useState<Record<string, { name: string; desc: string }>>({});
  const [pieces, setPieces] = useState<PieceDoc[]>([]);
  const [piecesLoading, setPiecesLoading] = useState(false);
  const [piecesError, setPiecesError] = useState("");
  const [selectedPieceId, setSelectedPieceId] = useState<string | null>(null);
  const [selectedPieceTab, setSelectedPieceTab] = useState<"client" | "studio" | "photos" | "audit">(
    "client"
  );
  const [clientNotes, setClientNotes] = useState<PieceNote[]>([]);
  const [studioNotes, setStudioNotes] = useState<PieceNote[]>([]);
  const [auditEvents, setAuditEvents] = useState<PieceAuditEvent[]>([]);
  const [mediaItems, setMediaItems] = useState<PieceMedia[]>([]);
  const [pieceDetailLoading, setPieceDetailLoading] = useState(false);
  const [pieceDetailError, setPieceDetailError] = useState("");

  const [newPieceCode, setNewPieceCode] = useState("");
  const [newPieceDesc, setNewPieceDesc] = useState("");
  const [newPieceOwner, setNewPieceOwner] = useState("");
  const [newPieceStage, setNewPieceStage] = useState<Stage>("UNKNOWN");
  const [newPieceCategory, setNewPieceCategory] = useState<WareCategory>("UNKNOWN");
  const [archivedExpanded, setArchivedExpanded] = useState(false);

  const [clientNoteDraft, setClientNoteDraft] = useState("");
  const [studioNoteDraft, setStudioNoteDraft] = useState("");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteStream, setEditingNoteStream] = useState<PieceNoteStream | null>(null);
  const [editingNoteText, setEditingNoteText] = useState("");

  const [noteSearchQuery, setNoteSearchQuery] = useState("");
  const [noteSearchResults, setNoteSearchResults] = useState<NoteSearchResult[]>([]);
  const [noteSearchBusy, setNoteSearchBusy] = useState(false);
  const [noteSearchError, setNoteSearchError] = useState("");
  const [noteSearchSummary, setNoteSearchSummary] = useState("");


  const visibleActive = showAllActive ? active : active.slice(0, PIECES_PREVIEW_COUNT);
  const visibleHistory = showAllHistory ? history : history.slice(0, PIECES_PREVIEW_COUNT);

  const showActiveSection = piecesFilter === "all" || piecesFilter === "active";
  const showHistorySection = piecesFilter === "all" || piecesFilter === "history";
  const selectedBatch = useMemo(
    () => [...active, ...history].find((batch) => batch.id === selectedBatchId) ?? null,
    [active, history, selectedBatchId]
  );

  const collectionNameFor = (batch: any) => {
    const override = collectionOverrides[batch.id];
    if (override?.name) return override.name;
    const fromDoc = typeof batch.collectionName === "string" ? batch.collectionName.trim() : "";
    if (fromDoc) return fromDoc;
    const title = typeof batch.title === "string" ? batch.title.trim() : "";
    return title || "Untitled collection";
  };

  const collectionDescFor = (batch: any) => {
    const override = collectionOverrides[batch.id];
    if (override?.desc) return override.desc;
    return typeof batch.collectionDesc === "string" ? batch.collectionDesc : "";
  };

  const selectedPiece = useMemo(
    () => pieces.find((piece) => piece.id === selectedPieceId) ?? null,
    [pieces, selectedPieceId]
  );

  const activePieces = pieces.filter((piece) => !piece.isArchived);
  const archivedPieces = pieces.filter((piece) => piece.isArchived);
  const activeByCategory = useMemo(() => groupPiecesByCategory(activePieces), [activePieces]);
  const archivedByCategory = useMemo(() => groupPiecesByCategory(archivedPieces), [archivedPieces]);

  const participants = useMemo(() => {
    const names = auditEvents
      .map((event) => event.actorName)
      .filter((name): name is string => !!name && name.trim().length > 0);
    return Array.from(new Set(names));
  }, [auditEvents]);

  useEffect(() => {
    if (!timelineBatchId) return;

    setTimelineLoading(true);
    setTimelineError("");
    setTimelineEvents([]);

    const loadTimeline = async () => {
      try {
        const timelineQuery = query(
          collection(db, "batches", timelineBatchId, "timeline"),
          orderBy("at", "asc")
        );
        const snap = await getDocs(timelineQuery);
        const rows: TimelineEvent[] = snap.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as any),
        }));
        setTimelineEvents(rows);
      } catch (err: any) {
        setTimelineError(`Timeline failed: ${err.message || String(err)}`);
      } finally {
        setTimelineLoading(false);
      }
    };

    void loadTimeline();
  }, [timelineBatchId]);

  useEffect(() => {
    if (!selectedBatchId) {
      setCollectionNameDraft("");
      setCollectionDescDraft("");
      setCollectionMetaLoading(false);
      setCollectionMetaError("");
      return;
    }

    const loadCollectionMeta = async () => {
      const busyKey = `loadCollection:${selectedBatchId}`;
      if (isBusy(busyKey)) return;
      setBusy(busyKey, true);
      setCollectionMetaLoading(true);
      setCollectionMetaError("");

      try {
        const batchRef = doc(db, "batches", selectedBatchId);
        const snap = await getDoc(batchRef);
        const batchData = snap.exists() ? (snap.data() as any) : {};
        const batchFallback = [...active, ...history].find((batch) => batch.id === selectedBatchId);
        const fallbackTitle = typeof batchFallback?.title === "string" ? batchFallback.title : "";
        const nameFromDoc =
          typeof batchData.collectionName === "string" ? batchData.collectionName.trim() : "";
        const nextName = nameFromDoc || fallbackTitle || "Untitled collection";
        const nextDesc =
          typeof batchData.collectionDesc === "string" ? batchData.collectionDesc : "";

        setCollectionNameDraft(nextName);
        setCollectionDescDraft(nextDesc);
        setCollectionOverrides((prev) => ({
          ...prev,
          [selectedBatchId]: { name: nextName, desc: nextDesc },
        }));
      } catch (err: any) {
        setCollectionMetaError(`Collection failed: ${err?.message || String(err)}`);
      } finally {
        setCollectionMetaLoading(false);
        setBusy(busyKey, false);
      }
    };

    void loadCollectionMeta();
  }, [selectedBatchId]);

  useEffect(() => {
    if (!selectedBatchId) {
      setPieces([]);
      setPiecesError("");
      setPiecesLoading(false);
      setSelectedPieceId(null);
      setClientNotes([]);
      setStudioNotes([]);
      setAuditEvents([]);
      setMediaItems([]);
      return;
    }

    const loadPieces = async () => {
      const busyKey = `loadPieces:${selectedBatchId}`;
      if (isBusy(busyKey)) return;
      setBusy(busyKey, true);
      setPiecesLoading(true);
      setPiecesError("");

      try {
        const piecesQuery = query(
          collection(db, "batches", selectedBatchId, "pieces"),
          orderBy("createdAt", "desc"),
          limit(200)
        );
        const snap = await getDocs(piecesQuery);
        const rows: PieceDoc[] = snap.docs.map((docSnap) => {
          const data = docSnap.data() as any;
          return {
            id: docSnap.id,
            pieceCode: data.pieceCode ?? "",
            shortDesc: data.shortDesc ?? "",
            ownerName: data.ownerName ?? "",
            stage: normalizeStage(data.stage),
            wareCategory: normalizeWareCategory(data.wareCategory),
            isArchived: data.isArchived === true,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
          };
        });
        setPieces(rows);
      } catch (err: any) {
        setPiecesError(`Pieces failed: ${err.message || String(err)}`);
      } finally {
        setPiecesLoading(false);
        setBusy(busyKey, false);
      }
    };

    void loadPieces();
  }, [selectedBatchId]);

  useEffect(() => {
    if (!selectedBatchId) return;
    const stillExists = [...active, ...history].some((batch) => batch.id === selectedBatchId);
    if (!stillExists) {
      setSelectedBatchId(null);
      setSelectedBatchTitle("");
    }
  }, [active, history, selectedBatchId]);

  useEffect(() => {
    if (!selectedBatchId || !selectedPieceId) {
      setClientNotes([]);
      setStudioNotes([]);
      setAuditEvents([]);
      setMediaItems([]);
      setPieceDetailLoading(false);
      setPieceDetailError("");
      return;
    }

    const loadPieceDetails = async () => {
      const busyKey = `loadPiece:${selectedPieceId}`;
      if (isBusy(busyKey)) return;
      setBusy(busyKey, true);
      setPieceDetailLoading(true);
      setPieceDetailError("");

      try {
        const clientQuery = query(
          collection(db, "batches", selectedBatchId, "pieces", selectedPieceId, "clientNotes"),
          orderBy("at", "desc"),
          limit(NOTE_LOAD_LIMIT)
        );
        const studioQuery = query(
          collection(db, "batches", selectedBatchId, "pieces", selectedPieceId, "studioNotes"),
          orderBy("at", "desc"),
          limit(NOTE_LOAD_LIMIT)
        );
        const auditQuery = query(
          collection(db, "batches", selectedBatchId, "pieces", selectedPieceId, "audit"),
          orderBy("at", "desc"),
          limit(AUDIT_LOAD_LIMIT)
        );
        const mediaQuery = query(
          collection(db, "batches", selectedBatchId, "pieces", selectedPieceId, "media"),
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
          clientSnap.docs.map((docSnap) => buildNoteDoc({ id: docSnap.id, ...(docSnap.data() as any) }))
        );
        setStudioNotes(
          studioSnap.docs.map((docSnap) => buildNoteDoc({ id: docSnap.id, ...(docSnap.data() as any) }))
        );
        setAuditEvents(
          auditSnap.docs.map((docSnap) => ({
            id: docSnap.id,
            ...(docSnap.data() as any),
          }))
        );
        setMediaItems(
          mediaSnap.docs.map((docSnap) => ({
            id: docSnap.id,
            stage: normalizeStage((docSnap.data() as any).stage),
            ...(docSnap.data() as any),
          }))
        );
      } catch (err: any) {
        setPieceDetailError(`Piece detail failed: ${err.message || String(err)}`);
      } finally {
        setPieceDetailLoading(false);
        setBusy(busyKey, false);
      }
    };

    void loadPieceDetails();
  }, [selectedBatchId, selectedPieceId]);

  function toggleTimeline(batchId: string) {
    setTimelineBatchId((prev) => (prev === batchId ? null : batchId));
  }
  async function handleContinueJourney(batchId: string) {
    if (!batchId) return;
    const busyKey = `continue:${batchId}`;
    if (isBusy(busyKey)) return;

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
    } catch (err: any) {
      if (err instanceof PortalApiError) {
        setMeta(err.meta);
        setStatus(`Continue journey failed: ${err.message}`);
      } else {
        setStatus(`Continue journey failed: ${err?.message || String(err)}`);
      }
    } finally {
      setBusy(busyKey, false);
    }
  }

  async function handleArchive(batchId: string) {
    if (!batchId) return;
    const busyKey = `archive:${batchId}`;
    if (isBusy(busyKey)) return;

    setBusy(busyKey, true);
    setStatus("Archiving collection...");
    setMeta(null);

    try {
      const idToken = await user.getIdToken();
      const trimmedAdminToken = adminToken ? adminToken.trim() : "";
      const response = await portalApi.pickedUpAndClose({
        idToken,
        adminToken: trimmedAdminToken ? trimmedAdminToken : undefined,
        payload: { uid: user.uid, batchId },
      });
      setMeta(response.meta);
      setStatus("Collection archived.");
    } catch (err: any) {
      if (err instanceof PortalApiError) {
        setMeta(err.meta);
        setStatus(`Archive failed: ${err.message}`);
      } else {
        setStatus(`Archive failed: ${err?.message || String(err)}`);
      }
    } finally {
      setBusy(busyKey, false);
    }
  }

  function selectBatch(batchId: string, title?: string | null) {
    setSelectedBatchId(batchId);
    setSelectedBatchTitle(title ?? "");
    const baseName = typeof title === "string" ? title.trim() : "";
    if (baseName) {
      setCollectionNameDraft(baseName);
    }
    setCollectionDescDraft("");
    setCollectionMetaError("");
    setSelectedPieceId(null);
    setSelectedPieceTab("client");
    setNoteSearchQuery("");
    setNoteSearchResults([]);
    setNoteSearchSummary("");
    setNoteSearchError("");
  }

  async function handleCreateCollection() {
    const busyKey = "createCollection";
    if (isBusy(busyKey)) return;

    const suggestedName = (user.displayName || "My") + " collection";
    const promptValue = window.prompt("Collection name", suggestedName);
    if (promptValue === null) {
      setStatus("Collection creation cancelled.");
      return;
    }
    const title = promptValue.trim() || suggestedName;
    const ownerDisplayName = (user.displayName || user.email || "Client").trim();
    const requestId = createCollectionRequestId ?? makeClientRequestId();
    if (!createCollectionRequestId) {
      setCreateCollectionRequestId(requestId);
    }

    setBusy(busyKey, true);
    setStatus("Creating collection...");
    setMeta(null);

    const payload = {
      ownerUid: user.uid,
      ownerDisplayName,
      title,
      intakeMode: "SELF_SERVICE",
      estimatedCostCents: 0,
      kilnName: null,
      estimateNotes: null,
      clientRequestId: requestId,
    };

    try {
      const idToken = await user.getIdToken();
      const trimmedAdminToken = adminToken ? adminToken.trim() : "";
      const response = await portalApi.createBatch({
        idToken,
        adminToken: trimmedAdminToken ? trimmedAdminToken : undefined,
        payload,
      });
      setMeta(response.meta);
      const newId = getResultBatchId(response.data);
      if (newId) {
        setCollectionOverrides((prev) => ({
          ...prev,
          [newId]: { name: title, desc: "" },
        }));
        selectBatch(newId, title);
        setStatus(`Collection created. ID: ${newId}`);
      } else {
        setStatus("Collection created.");
      }
      setCreateCollectionRequestId(null);
    } catch (err: any) {
      if (err instanceof PortalApiError) {
        setMeta(err.meta);
        setStatus(`Create collection failed: ${err.message}`);
      } else {
        setStatus(`Create collection failed: ${err?.message || String(err)}`);
      }
    } finally {
      setBusy(busyKey, false);
    }
  }

  function handleNewWareCta() {
    if (!selectedBatchId) {
      const firstCollection = active[0] ?? history[0];
      if (!firstCollection) {
        setStatus("You need a collection before creating a ware.");
        return;
      }
      selectBatch(firstCollection.id, firstCollection.title);
    }
    setStatus("Ready to add a new ware.");
    setTimeout(() => {
      const input = document.getElementById("ware-code") as HTMLInputElement | null;
      input?.focus();
    }, 0);
  }

  async function handleSaveCollectionMeta() {
    if (!selectedBatchId) return;
    const busyKey = `collectionMeta:${selectedBatchId}`;
    if (isBusy(busyKey)) return;

    const trimmedName = collectionNameDraft.trim();
    const trimmedDesc = collectionDescDraft.trim();

    if (!trimmedName) {
      setStatus("Collection name is required.");
      return;
    }

    setBusy(busyKey, true);
    setStatus("Saving collection...");
    setMeta(null);

    const payload = {
      collectionName: trimmedName,
      collectionDesc: trimmedDesc || null,
      updatedAt: serverTimestamp(),
    };

    try {
      await updateDoc(doc(db, "batches", selectedBatchId), payload);
      setCollectionOverrides((prev) => ({
        ...prev,
        [selectedBatchId]: { name: trimmedName, desc: trimmedDesc },
      }));
      setSelectedBatchTitle(trimmedName);
      setMeta({
        ok: true,
        status: 200,
        fn: "firestore.updateCollectionMeta",
        url: `batches/${selectedBatchId}`,
        payload: { collectionName: trimmedName, collectionDesc: trimmedDesc || null },
        response: { ok: true },
        curlExample: "N/A (Firestore SDK)",
      });
      setStatus("Collection updated.");
    } catch (err: any) {
      setStatus(`Collection save failed: ${err?.message || String(err)}`);
      setMeta({
        ok: false,
        status: err?.code ?? "error",
        fn: "firestore.updateCollectionMeta",
        url: `batches/${selectedBatchId}`,
        payload: { collectionName: trimmedName, collectionDesc: trimmedDesc || null },
        response: { message: err?.message || String(err) },
        curlExample: "N/A (Firestore SDK)",
      });
    } finally {
      setBusy(busyKey, false);
    }
  }

  async function handleCreatePiece() {
    if (!selectedBatchId) return;
    const busyKey = `createPiece:${selectedBatchId}`;
    if (isBusy(busyKey)) return;

    const trimmedCode = newPieceCode.trim();
    const trimmedDesc = newPieceDesc.trim();
    const trimmedOwner = newPieceOwner.trim();

    if (!trimmedCode || !trimmedDesc || !trimmedOwner) {
      setStatus("Ware code, short description, and owner name are required.");
      return;
    }

    setBusy(busyKey, true);
    setStatus("Creating piece...");
    setMeta(null);

    const payload = {
      pieceCode: trimmedCode,
      shortDesc: trimmedDesc,
      ownerName: trimmedOwner,
      stage: newPieceStage,
      wareCategory: newPieceCategory,
      isArchived: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    try {
      const docRef = await addDoc(collection(db, "batches", selectedBatchId, "pieces"), payload);
      await addDoc(collection(db, "batches", selectedBatchId, "pieces", docRef.id, "audit"), {
        type: "CREATED",
        at: serverTimestamp(),
        actorUid: user.uid,
        actorName: user.displayName ?? "Member",
        notes: `Piece ${trimmedCode} created`,
      });

      setMeta({
        ok: true,
        status: 200,
        fn: "firestore.createPiece",
        url: `batches/${selectedBatchId}/pieces`,
        payload,
        response: { id: docRef.id },
        curlExample: "N/A (Firestore SDK)",
      });

      setStatus("Ware created.");
      setNewPieceCode("");
      setNewPieceDesc("");
      setNewPieceOwner("");
      setNewPieceStage("UNKNOWN");
      setNewPieceCategory("UNKNOWN");

      setPieces((prev) => [
        {
          id: docRef.id,
          pieceCode: trimmedCode,
          shortDesc: trimmedDesc,
          ownerName: trimmedOwner,
          stage: newPieceStage,
          wareCategory: newPieceCategory,
          isArchived: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        ...prev,
      ]);
    } catch (err: any) {
      setStatus(`Create piece failed: ${err?.message || String(err)}`);
      setMeta({
        ok: false,
        status: err?.code ?? "error",
        fn: "firestore.createPiece",
        url: `batches/${selectedBatchId}/pieces`,
        payload,
        response: { message: err?.message || String(err) },
        curlExample: "N/A (Firestore SDK)",
      });
    } finally {
      setBusy(busyKey, false);
    }
  }

  async function handleStageChange(pieceId: string, nextStage: Stage) {
    if (!selectedBatchId) return;
    const busyKey = `stage:${pieceId}`;
    if (isBusy(busyKey)) return;

    setBusy(busyKey, true);
    setStatus("Updating stage...");
    setMeta(null);

    const payload = { stage: nextStage, updatedAt: serverTimestamp() };

    try {
      await updateDoc(doc(db, "batches", selectedBatchId, "pieces", pieceId), payload);
      await addDoc(collection(db, "batches", selectedBatchId, "pieces", pieceId, "audit"), {
        type: "STAGE_CHANGED",
        at: serverTimestamp(),
        actorUid: user.uid,
        actorName: user.displayName ?? "Member",
        notes: `Stage → ${nextStage}`,
      });

      setMeta({
        ok: true,
        status: 200,
        fn: "firestore.updatePieceStage",
        url: `batches/${selectedBatchId}/pieces/${pieceId}`,
        payload: { stage: nextStage },
        response: { ok: true },
        curlExample: "N/A (Firestore SDK)",
      });

      setPieces((prev) =>
        prev.map((piece) => (piece.id === pieceId ? { ...piece, stage: nextStage } : piece))
      );
      setStatus("Ware stage updated.");
    } catch (err: any) {
      setStatus(`Stage update failed: ${err?.message || String(err)}`);
      setMeta({
        ok: false,
        status: err?.code ?? "error",
        fn: "firestore.updatePieceStage",
        url: `batches/${selectedBatchId}/pieces/${pieceId}`,
        payload: { stage: nextStage },
        response: { message: err?.message || String(err) },
        curlExample: "N/A (Firestore SDK)",
      });
    } finally {
      setBusy(busyKey, false);
    }
  }

  async function handleArchivePiece(pieceId: string, nextArchived: boolean) {
    if (!selectedBatchId) return;
    const busyKey = `archivePiece:${pieceId}`;
    if (isBusy(busyKey)) return;

    setBusy(busyKey, true);
    setStatus(nextArchived ? "Archiving ware..." : "Restoring ware...");
    setMeta(null);

    const payload = { isArchived: nextArchived, updatedAt: serverTimestamp() };

    try {
      await updateDoc(doc(db, "batches", selectedBatchId, "pieces", pieceId), payload);
      await addDoc(collection(db, "batches", selectedBatchId, "pieces", pieceId, "audit"), {
        type: nextArchived ? "ARCHIVED" : "UNARCHIVED",
        at: serverTimestamp(),
        actorUid: user.uid,
        actorName: user.displayName ?? "Member",
        notes: nextArchived ? "Archived piece" : "Unarchived piece",
      });

      setMeta({
        ok: true,
        status: 200,
        fn: "firestore.setPieceArchived",
        url: `batches/${selectedBatchId}/pieces/${pieceId}`,
        payload: { isArchived: nextArchived },
        response: { ok: true },
        curlExample: "N/A (Firestore SDK)",
      });

      setPieces((prev) =>
        prev.map((piece) => (piece.id === pieceId ? { ...piece, isArchived: nextArchived } : piece))
      );
      setStatus(nextArchived ? "Ware archived." : "Ware restored.");
    } catch (err: any) {
      setStatus(`Archive update failed: ${err?.message || String(err)}`);
      setMeta({
        ok: false,
        status: err?.code ?? "error",
        fn: "firestore.setPieceArchived",
        url: `batches/${selectedBatchId}/pieces/${pieceId}`,
        payload: { isArchived: nextArchived },
        response: { message: err?.message || String(err) },
        curlExample: "N/A (Firestore SDK)",
      });
    } finally {
      setBusy(busyKey, false);
    }
  }

  function canEditNote(note: PieceNote, stream: PieceNoteStream) {
    if (isStaff) return true;
    if (stream === "studio") return false;
    return note.authorUid === user.uid;
  }

  async function handleAddNote(stream: PieceNoteStream) {
    if (!selectedBatchId || !selectedPieceId) return;
    if (stream === "studio" && !isStaff) {
      setStatus("Studio notes are staff-only.");
      return;
    }

    const busyKey = `addNote:${selectedPieceId}:${stream}`;
    if (isBusy(busyKey)) return;

    const draft = stream === "client" ? clientNoteDraft.trim() : studioNoteDraft.trim();
    if (!draft) {
      setStatus("Note text is required.");
      return;
    }

    setBusy(busyKey, true);
    setStatus("Adding note...");
    setMeta(null);

    const tokens = toTokens(draft);
    const payload = {
      text: draft,
      at: serverTimestamp(),
      authorUid: user.uid,
      authorName: user.displayName ?? "Member",
      searchTokens: tokens,
    };

    const collectionName = stream === "client" ? "clientNotes" : "studioNotes";

    try {
      const noteRef = await addDoc(
        collection(db, "batches", selectedBatchId, "pieces", selectedPieceId, collectionName),
        payload
      );
      await addDoc(collection(db, "batches", selectedBatchId, "pieces", selectedPieceId, "audit"), {
        type: "NOTE_ADDED",
        at: serverTimestamp(),
        actorUid: user.uid,
        actorName: user.displayName ?? "Member",
        noteStream: stream,
        noteId: noteRef.id,
        notes: draft.slice(0, 120),
      });

      const newNote: PieceNote = {
        id: noteRef.id,
        text: draft,
        at: new Date(),
        updatedAt: null,
        authorUid: user.uid,
        authorName: user.displayName ?? "Member",
        searchTokens: tokens,
      };

      if (stream === "client") {
        setClientNotes((prev) => [newNote, ...prev]);
        setClientNoteDraft("");
      } else {
        setStudioNotes((prev) => [newNote, ...prev]);
        setStudioNoteDraft("");
      }

      setMeta({
        ok: true,
        status: 200,
        fn: "firestore.addPieceNote",
        url: `batches/${selectedBatchId}/pieces/${selectedPieceId}/${collectionName}`,
        payload: { stream, text: draft },
        response: { id: noteRef.id },
        curlExample: "N/A (Firestore SDK)",
      });

      setStatus("Note added.");
    } catch (err: any) {
      setStatus(`Add note failed: ${err?.message || String(err)}`);
      setMeta({
        ok: false,
        status: err?.code ?? "error",
        fn: "firestore.addPieceNote",
        url: `batches/${selectedBatchId}/pieces/${selectedPieceId}/${collectionName}`,
        payload: { stream, text: draft },
        response: { message: err?.message || String(err) },
        curlExample: "N/A (Firestore SDK)",
      });
    } finally {
      setBusy(busyKey, false);
    }
  }

  function startEditingNote(note: PieceNote, stream: PieceNoteStream) {
    if (!canEditNote(note, stream)) return;
    setEditingNoteId(note.id);
    setEditingNoteStream(stream);
    setEditingNoteText(note.text);
  }

  function cancelEditingNote() {
    setEditingNoteId(null);
    setEditingNoteStream(null);
    setEditingNoteText("");
  }

  async function handleSaveNoteEdit() {
    if (!selectedBatchId || !selectedPieceId || !editingNoteId || !editingNoteStream) return;

    const trimmed = editingNoteText.trim();
    if (!trimmed) {
      setStatus("Note text is required.");
      return;
    }

    const busyKey = `editNote:${editingNoteId}`;
    if (isBusy(busyKey)) return;

    setBusy(busyKey, true);
    setStatus("Saving note...");
    setMeta(null);

    const tokens = toTokens(trimmed);
    const payload = {
      text: trimmed,
      updatedAt: serverTimestamp(),
      searchTokens: tokens,
    };

    const collectionName = editingNoteStream === "client" ? "clientNotes" : "studioNotes";

    try {
      await updateDoc(
        doc(db, "batches", selectedBatchId, "pieces", selectedPieceId, collectionName, editingNoteId),
        payload
      );
      await addDoc(collection(db, "batches", selectedBatchId, "pieces", selectedPieceId, "audit"), {
        type: "NOTE_EDITED",
        at: serverTimestamp(),
        actorUid: user.uid,
        actorName: user.displayName ?? "Member",
        noteStream: editingNoteStream,
        noteId: editingNoteId,
        notes: trimmed.slice(0, 120),
      });

      const applyEdit = (notes: PieceNote[]) =>
        notes.map((note) =>
          note.id === editingNoteId
            ? { ...note, text: trimmed, updatedAt: new Date(), searchTokens: tokens }
            : note
        );

      if (editingNoteStream === "client") {
        setClientNotes((prev) => applyEdit(prev));
      } else {
        setStudioNotes((prev) => applyEdit(prev));
      }

      setMeta({
        ok: true,
        status: 200,
        fn: "firestore.editPieceNote",
        url: `batches/${selectedBatchId}/pieces/${selectedPieceId}/${collectionName}/${editingNoteId}`,
        payload: { stream: editingNoteStream, text: trimmed },
        response: { ok: true },
        curlExample: "N/A (Firestore SDK)",
      });

      setStatus("Note updated.");
      cancelEditingNote();
    } catch (err: any) {
      setStatus(`Edit note failed: ${err?.message || String(err)}`);
      setMeta({
        ok: false,
        status: err?.code ?? "error",
        fn: "firestore.editPieceNote",
        url: `batches/${selectedBatchId}/pieces/${selectedPieceId}/${collectionName}/${editingNoteId}`,
        payload: { stream: editingNoteStream, text: trimmed },
        response: { message: err?.message || String(err) },
        curlExample: "N/A (Firestore SDK)",
      });
    } finally {
      setBusy(busyKey, false);
    }
  }

  async function handleNoteSearch() {
    if (!selectedBatchId) return;
    const trimmed = noteSearchQuery.trim();
    if (!trimmed) {
      setNoteSearchResults([]);
      setNoteSearchSummary("");
      return;
    }

    if (noteSearchBusy) return;
    setNoteSearchBusy(true);
    setNoteSearchError("");
    setNoteSearchSummary("");
    setNoteSearchResults([]);

    const tokens = toTokens(trimmed);
    const piecesToScan = pieces.slice(0, SEARCH_PIECE_LIMIT);
    const streams: PieceNoteStream[] = isStaff ? ["client", "studio"] : ["client"];

    try {
      const results: NoteSearchResult[] = [];

      for (const piece of piecesToScan) {
        for (const stream of streams) {
          const collectionName = stream === "client" ? "clientNotes" : "studioNotes";
          const notesQuery = query(
            collection(db, "batches", selectedBatchId, "pieces", piece.id, collectionName),
            orderBy("at", "desc"),
            limit(SEARCH_NOTES_PER_PIECE)
          );
          const snap = await getDocs(notesQuery);
          snap.docs.forEach((docSnap) => {
            const data = buildNoteDoc({ id: docSnap.id, ...(docSnap.data() as any) });
            const haystackTokens = Array.isArray(data.searchTokens) ? data.searchTokens : [];
            const matches =
              tokens.length === 0 ||
              tokens.some((token) => haystackTokens.includes(token)) ||
              data.text.toLowerCase().includes(trimmed.toLowerCase());
            if (matches) {
              results.push({
                pieceId: piece.id,
                pieceCode: piece.pieceCode || piece.id,
                stream,
                note: data,
              });
            }
          });
        }
      }

      setNoteSearchResults(results);
      setNoteSearchSummary(
        `Searched ${piecesToScan.length} piece${piecesToScan.length === 1 ? "" : "s"} · ${results.length} match${
          results.length === 1 ? "" : "es"
        }`
      );
    } catch (err: any) {
      setNoteSearchError(`Note search failed: ${err?.message || String(err)}`);
    } finally {
      setNoteSearchBusy(false);
    }
  }
  return (
    <div className="page">
      <div className="page-header">
        <h1>My Pieces</h1>
        <p className="page-subtitle">
          Live studio tracking for your wares. Updates appear as the team moves your pieces through the kiln.
        </p>
      </div>

      {status ? <div className="status-line">{status}</div> : null}
      {error ? <div className="card card-3d alert">{error}</div> : null}

      {!canContinue && history.length > 0 ? (
        <div className="card card-3d alert">
          Continue journey is available once all active pieces are closed.
        </div>
      ) : null}

      <div className="filter-chips">
        <button
          className={`chip ${piecesFilter === "all" ? "active" : ""}`}
          onClick={() => setPiecesFilter("all")}
        >
          All ({active.length + history.length})
        </button>
        <button
          className={`chip ${piecesFilter === "active" ? "active" : ""}`}
          onClick={() => setPiecesFilter("active")}
        >
          In progress ({active.length})
        </button>
        <button
          className={`chip ${piecesFilter === "history" ? "active" : ""}`}
          onClick={() => setPiecesFilter("history")}
        >
          Completed ({history.length})
        </button>
      </div>

      <div className="cta-bar">
        <button className="btn btn-primary cta-primary" onClick={handleNewWareCta}>
          New ware
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => void handleCreateCollection()}
          disabled={isBusy("createCollection")}
        >
          {isBusy("createCollection") ? "Creating..." : "New collection"}
        </button>
        <div className="piece-meta">
          Collections group wares together for kiln submissions and cost calculation.
        </div>
      </div>

      <div className="wares-layout">
        <div className="pieces-grid collections-pane">
        {showActiveSection ? (
          <div className="card card-3d">
            <div className="card-title">Active collections</div>
            {active.length === 0 ? (
              <div className="empty-state">No active collections yet.</div>
            ) : (
              <div className="pieces-list">
                {visibleActive.map((batch) => (
                  <div className="piece-row" key={batch.id}>
                    <div>
                      <div className="piece-title-row">
                        <div className="piece-title">{collectionNameFor(batch)}</div>
                        {batch.status ? <div className="pill piece-status">{batch.status}</div> : null}
                      </div>
                      <div className="piece-meta">ID: {batch.id}</div>
                      {collectionDescFor(batch) ? (
                        <div className="piece-meta">{collectionDescFor(batch)}</div>
                      ) : null}
                    </div>
                    <div className="piece-right">
                      <div className="piece-meta">Updated: {formatMaybeTimestamp(batch.updatedAt)}</div>
                      <div className="piece-meta">
                        Est. cost: {formatCents(batch.estimatedCostCents ?? batch.priceCents)}
                      </div>
                      <div className="piece-actions">
                        <button className="btn btn-ghost" onClick={() => toggleTimeline(batch.id)}>
                          {timelineBatchId === batch.id ? "Hide timeline" : "View timeline"}
                        </button>
                        <button
                          className="btn btn-ghost"
                          onClick={() => selectBatch(batch.id, collectionNameFor(batch))}
                        >
                          Open collection
                        </button>
                        <button
                          className="btn btn-ghost"
                          onClick={() => handleArchive(batch.id)}
                          disabled={isBusy(`archive:${batch.id}`)}
                        >
                          {isBusy(`archive:${batch.id}`) ? "Closing..." : "Close"}
                        </button>
                      </div>
                    </div>
                    {timelineBatchId === batch.id ? (
                      <div className="timeline-inline">
                        {timelineLoading ? (
                          <div className="empty-state">Loading timeline...</div>
                        ) : timelineError ? (
                          <div className="alert inline-alert">{timelineError}</div>
                        ) : timelineEvents.length === 0 ? (
                          <div className="empty-state">No timeline events yet.</div>
                        ) : (
                          <div className="timeline-list">
                            {timelineEvents.map((ev) => (
                              <div className="timeline-row" key={ev.id}>
                                <div className="timeline-at">{formatMaybeTimestamp(ev.at)}</div>
                                <div>
                                  <div className="timeline-title">{getTimelineLabel(ev.type)}</div>
                                  <div className="timeline-meta">
                                    {ev.actorName ? `by ${ev.actorName}` : ""}
                                    {ev.kilnName ? `  kiln: ${ev.kilnName}` : ""}
                                  </div>
                                  {ev.notes ? <div className="timeline-notes">{ev.notes}</div> : null}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                ))}
                {active.length > PIECES_PREVIEW_COUNT ? (
                  <button
                    className="btn btn-ghost show-more"
                    onClick={() => setShowAllActive((prev) => !prev)}
                  >
                    {showAllActive ? "Show fewer" : `Show more (${active.length - PIECES_PREVIEW_COUNT})`}
                  </button>
                ) : null}
              </div>
            )}
          </div>
        ) : null}

        {showHistorySection ? (
          <div className="card card-3d">
            <div className="card-title">Completed collections</div>
            {history.length === 0 ? (
              <div className="empty-state">No completed collections yet.</div>
            ) : (
              <div className="pieces-list">
                {visibleHistory.map((batch) => (
                  <div className="piece-row" key={batch.id}>
                    <div>
                      <div className="piece-title-row">
                        <div className="piece-title">{collectionNameFor(batch)}</div>
                        <div className="pill piece-status">Complete</div>
                      </div>
                      <div className="piece-meta">ID: {batch.id}</div>
                      <div className="piece-meta">Closed: {formatMaybeTimestamp(batch.closedAt)}</div>
                      {collectionDescFor(batch) ? (
                        <div className="piece-meta">{collectionDescFor(batch)}</div>
                      ) : null}
                    </div>
                    <div className="piece-right">
                      <div className="piece-meta">Updated: {formatMaybeTimestamp(batch.updatedAt)}</div>
                      <div className="piece-meta">
                        Final cost: {formatCents(batch.priceCents ?? batch.estimatedCostCents)}
                      </div>
                      <div className="piece-actions">
                        <button className="btn btn-ghost" onClick={() => toggleTimeline(batch.id)}>
                          {timelineBatchId === batch.id ? "Hide timeline" : "View timeline"}
                        </button>
                        <button
                          className="btn btn-ghost"
                          onClick={() => selectBatch(batch.id, collectionNameFor(batch))}
                        >
                          Open collection
                        </button>
                        <button
                          className="btn btn-ghost"
                          onClick={() => handleContinueJourney(batch.id)}
                          disabled={!canContinue || isBusy(`continue:${batch.id}`)}
                        >
                          {isBusy(`continue:${batch.id}`) ? "Resubmitting..." : "Continue journey"}
                        </button>
                      </div>
                    </div>
                    {timelineBatchId === batch.id ? (
                      <div className="timeline-inline">
                        {timelineLoading ? (
                          <div className="empty-state">Loading timeline...</div>
                        ) : timelineError ? (
                          <div className="alert inline-alert">{timelineError}</div>
                        ) : timelineEvents.length === 0 ? (
                          <div className="empty-state">No timeline events yet.</div>
                        ) : (
                          <div className="timeline-list">
                            {timelineEvents.map((ev) => (
                              <div className="timeline-row" key={ev.id}>
                                <div className="timeline-at">{formatMaybeTimestamp(ev.at)}</div>
                                <div>
                                  <div className="timeline-title">{getTimelineLabel(ev.type)}</div>
                                  <div className="timeline-meta">
                                    {ev.actorName ? `by ${ev.actorName}` : ""}
                                    {ev.kilnName ? `  kiln: ${ev.kilnName}` : ""}
                                  </div>
                                  {ev.notes ? <div className="timeline-notes">{ev.notes}</div> : null}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                ))}
                {history.length > PIECES_PREVIEW_COUNT ? (
                  <button
                    className="btn btn-ghost show-more"
                    onClick={() => setShowAllHistory((prev) => !prev)}
                  >
                    {showAllHistory ? "Show fewer" : `Show more (${history.length - PIECES_PREVIEW_COUNT})`}
                  </button>
                ) : null}
              </div>
            )}
          </div>
        ) : null}
      </div>

      <div className="card card-3d collection-detail-pane">
        <div className="card-title">Collection detail</div>
        {!selectedBatchId ? (
          <div className="empty-state">Select a collection to view wares.</div>
        ) : (
          <div className="detail-grid">
            <div className="detail-block">
              <div className="detail-header">
                <div>
                  <div className="detail-title">
                    {collectionNameDraft ||
                      (selectedBatch ? collectionNameFor(selectedBatch) : selectedBatchTitle || "Collection")}
                  </div>
                  <div className="piece-meta">Collection ID: {selectedBatchId}</div>
                </div>
                <button className="btn btn-ghost" onClick={() => setSelectedBatchId(null)}>
                  Close
                </button>
              </div>

              <div className="section-title">Collection details</div>
              <div className="form-grid collection-form-grid">
                <div>
                  <label className="field-label" htmlFor="collection-name">
                    Collection name
                  </label>
                  <input
                    id="collection-name"
                    value={collectionNameDraft}
                    onChange={(event) => setCollectionNameDraft(event.target.value)}
                    placeholder="e.g. Spring kiln load"
                  />
                </div>
                <div>
                  <label className="field-label" htmlFor="collection-desc">
                    Description
                  </label>
                  <textarea
                    id="collection-desc"
                    value={collectionDescDraft}
                    onChange={(event) => setCollectionDescDraft(event.target.value)}
                    placeholder="Notes about this collection"
                  />
                </div>
              </div>
              <div className="form-actions">
                <button
                  className="btn btn-ghost"
                  onClick={handleSaveCollectionMeta}
                  disabled={isBusy(`collectionMeta:${selectedBatchId}`)}
                >
                  {isBusy(`collectionMeta:${selectedBatchId}`) ? "Saving..." : "Save collection"}
                </button>
              </div>
              {collectionMetaLoading ? <div className="piece-meta">Loading collection details...</div> : null}
              {collectionMetaError ? <div className="alert inline-alert">{collectionMetaError}</div> : null}

              <div className="section-title">New ware</div>
              <div className="form-grid ware-form-grid">
                <div>
                  <label className="field-label" htmlFor="ware-code">
                    Ware code
                  </label>
                  <input
                    id="ware-code"
                    value={newPieceCode}
                    onChange={(event) => setNewPieceCode(event.target.value)}
                    placeholder="e.g. MF-122"
                  />
                </div>
                <div>
                  <label className="field-label" htmlFor="ware-desc">
                    Short description
                  </label>
                  <input
                    id="ware-desc"
                    value={newPieceDesc}
                    onChange={(event) => setNewPieceDesc(event.target.value)}
                    placeholder="e.g. Blue vase"
                  />
                </div>
                <div>
                  <label className="field-label" htmlFor="ware-owner">
                    Owner name
                  </label>
                  <input
                    id="ware-owner"
                    value={newPieceOwner}
                    onChange={(event) => setNewPieceOwner(event.target.value)}
                    placeholder="Client name"
                  />
                </div>
                <div>
                  <label className="field-label" htmlFor="ware-stage">
                    Stage
                  </label>
                  <select
                    id="ware-stage"
                    value={newPieceStage}
                    onChange={(event) => setNewPieceStage(normalizeStage(event.target.value))}
                  >
                    {STAGES.map((stage) => (
                      <option value={stage} key={stage}>
                        {stage}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="field-label" htmlFor="ware-category">
                    Category
                  </label>
                  <select
                    id="ware-category"
                    value={newPieceCategory}
                    onChange={(event) => setNewPieceCategory(normalizeWareCategory(event.target.value))}
                  >
                    {WARE_CATEGORIES.map((category) => (
                      <option value={category} key={category}>
                        {WARE_CATEGORY_LABELS[category]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="form-actions">
                <button
                  className="btn btn-primary"
                  onClick={handleCreatePiece}
                  disabled={isBusy(`createPiece:${selectedBatchId}`)}
                >
                  {isBusy(`createPiece:${selectedBatchId}`) ? "Creating..." : "Create ware"}
                </button>
              </div>
              <div className="section-title">Wares</div>
              {piecesLoading ? (
                <div className="empty-state">Loading wares...</div>
              ) : piecesError ? (
                <div className="alert inline-alert">{piecesError}</div>
              ) : pieces.length === 0 ? (
                <div className="empty-state">No wares for this collection yet.</div>
              ) : (
                <div className="ware-groups">
                  {WARE_CATEGORIES.map((category) => {
                    const categoryPieces = activeByCategory[category];
                    if (!categoryPieces.length) return null;
                    return (
                      <div className="category-group" key={`active-${category}`}>
                        <div className="category-title">
                          {WARE_CATEGORY_LABELS[category]} ({categoryPieces.length})
                        </div>
                        <div className="pieces-list">
                          {categoryPieces.map((piece) => (
                            <div className="piece-row" key={piece.id}>
                              <div>
                                <div className="piece-title-row">
                                  <div className="piece-title">{piece.pieceCode || piece.id}</div>
                                  <div className="pill piece-status">{piece.stage}</div>
                                </div>
                                <div className="piece-meta">{piece.shortDesc}</div>
                                <div className="piece-meta">Owner: {piece.ownerName}</div>
                              </div>
                              <div className="piece-right">
                                <div className="piece-meta">
                                  Updated: {formatMaybeTimestamp(piece.updatedAt)}
                                </div>
                                <div className="piece-actions">
                                  <button
                                    className="btn btn-ghost"
                                    onClick={() => {
                                      setSelectedPieceId(piece.id);
                                      setSelectedPieceTab("client");
                                    }}
                                  >
                                    View details
                                  </button>
                                  <button
                                    className="btn btn-ghost"
                                    onClick={() => {
                                      if (!window.confirm("Archive this ware?")) return;
                                      void handleArchivePiece(piece.id, true);
                                    }}
                                    disabled={isBusy(`archivePiece:${piece.id}`)}
                                  >
                                    {isBusy(`archivePiece:${piece.id}`) ? "Archiving..." : "Archive"}
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}

                  {archivedPieces.length > 0 ? (
                    <div className="archived-group">
                      <button className="btn btn-ghost" onClick={() => setArchivedExpanded((prev) => !prev)}>
                        {archivedExpanded
                          ? `Hide archived (${archivedPieces.length})`
                          : `Show archived (${archivedPieces.length})`}
                      </button>
                      {archivedExpanded ? (
                        <div className="ware-groups">
                          {WARE_CATEGORIES.map((category) => {
                            const categoryPieces = archivedByCategory[category];
                            if (!categoryPieces.length) return null;
                            return (
                              <div className="category-group" key={`archived-${category}`}>
                                <div className="category-title">
                                  {WARE_CATEGORY_LABELS[category]} ({categoryPieces.length})
                                </div>
                                <div className="pieces-list">
                                  {categoryPieces.map((piece) => (
                                    <div className="piece-row" key={piece.id}>
                                      <div>
                                        <div className="piece-title-row">
                                          <div className="piece-title">{piece.pieceCode || piece.id}</div>
                                          <div className="pill piece-status">Archived</div>
                                        </div>
                                        <div className="piece-meta">{piece.shortDesc}</div>
                                        <div className="piece-meta">Owner: {piece.ownerName}</div>
                                      </div>
                                      <div className="piece-right">
                                        <div className="piece-meta">
                                          Updated: {formatMaybeTimestamp(piece.updatedAt)}
                                        </div>
                                        <div className="piece-actions">
                                          <button
                                            className="btn btn-ghost"
                                            onClick={() => {
                                              setSelectedPieceId(piece.id);
                                              setSelectedPieceTab("client");
                                            }}
                                          >
                                            View details
                                          </button>
                                          <button
                                            className="btn btn-ghost"
                                            onClick={() => {
                                              if (!window.confirm("Restore this ware?")) return;
                                              void handleArchivePiece(piece.id, false);
                                            }}
                                            disabled={isBusy(`archivePiece:${piece.id}`)}
                                          >
                                            {isBusy(`archivePiece:${piece.id}`) ? "Restoring..." : "Restore"}
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              )}
            </div>

            <div className="detail-block">
              <div className="section-title">Note search (this collection)</div>
              <div className="form-grid note-search-grid">
                <input
                  value={noteSearchQuery}
                  onChange={(event) => setNoteSearchQuery(event.target.value)}
                  placeholder="Search notes"
                />
                <button className="btn btn-ghost" onClick={handleNoteSearch} disabled={noteSearchBusy}>
                  {noteSearchBusy ? "Searching..." : "Search"}
                </button>
              </div>
              {noteSearchError ? <div className="alert inline-alert">{noteSearchError}</div> : null}
              {noteSearchSummary ? <div className="piece-meta">{noteSearchSummary}</div> : null}
              {noteSearchResults.length > 0 ? (
                <div className="note-results">
                  {noteSearchResults.map((result) => (
                    <div className="note-card" key={`${result.pieceId}-${result.stream}-${result.note.id}`}>
                      <div className="piece-title-row">
                        <div className="piece-title">{result.pieceCode}</div>
                        <div className="pill piece-status">{result.stream}</div>
                      </div>
                      <div className="piece-meta">{formatMaybeTimestamp(result.note.at)}</div>
                      <div>{result.note.text}</div>
                      <div className="piece-actions">
                        <button
                          className="btn btn-ghost"
                          onClick={() => {
                            setSelectedPieceId(result.pieceId);
                            setSelectedPieceTab(result.stream === "studio" ? "studio" : "client");
                          }}
                        >
                          Open ware
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="section-title">Ware detail</div>
              {!selectedPiece ? (
                <div className="empty-state">Select a ware to view details.</div>
              ) : (
                <div className="piece-detail">
                  <div className="piece-title-row">
                    <div>
                      <div className="piece-title">{selectedPiece.pieceCode || selectedPiece.id}</div>
                      <div className="piece-meta">{selectedPiece.shortDesc}</div>
                      <div className="piece-meta">Owner: {selectedPiece.ownerName}</div>
                      <div className="piece-meta">
                        Category: {WARE_CATEGORY_LABELS[selectedPiece.wareCategory]}
                      </div>
                      <div className="piece-meta">Updated: {formatMaybeTimestamp(selectedPiece.updatedAt)}</div>
                    </div>
                    <div>
                      <label className="field-label" htmlFor="stage-select">
                        Stage
                      </label>
                      <select
                        id="stage-select"
                        value={selectedPiece.stage}
                        onChange={(event) =>
                          handleStageChange(selectedPiece.id, normalizeStage(event.target.value))
                        }
                        disabled={isBusy(`stage:${selectedPiece.id}`)}
                      >
                        {STAGES.map((stage) => (
                          <option value={stage} key={stage}>
                            {stage}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {participants.length > 0 ? (
                    <div className="piece-meta">Participants: {participants.join(", ")}</div>
                  ) : (
                    <div className="piece-meta">Participants: -</div>
                  )}

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
                          onClick={() => handleAddNote("client")}
                          disabled={isBusy(`addNote:${selectedPiece.id}:client`)}
                        >
                          {isBusy(`addNote:${selectedPiece.id}:client`) ? "Adding..." : "Add note"}
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
                                      onClick={handleSaveNoteEdit}
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
                            onClick={() => handleAddNote("studio")}
                            disabled={isBusy(`addNote:${selectedPiece.id}:studio`)}
                          >
                            {isBusy(`addNote:${selectedPiece.id}:studio`) ? "Adding..." : "Add note"}
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
                                      onClick={handleSaveNoteEdit}
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
              )}
            </div>
          </div>
        )}
      </div>
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

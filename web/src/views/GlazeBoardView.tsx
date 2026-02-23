
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
import {
  connectStorageEmulator,
  deleteObject,
  getDownloadURL,
  getStorage,
  ref,
  uploadBytes,
} from "firebase/storage";
import { db } from "../firebase";
import { useBatches } from "../hooks/useBatches";
import { importGlazeMatrix } from "../lib/glazes/importMatrix";
import { ALL_TAGS, QUICK_TAGS, TAG_GROUPS, type GlazeTag } from "../lib/glazes/tags";
import { REAL_GLAZE_MATRIX_CSV } from "../lib/glazes/glazeMatrixData";
import {
  createEmptyTagFilters,
  getActiveTags,
  matchesComboFilters,
  type ComboFilterMeta,
  type ComboFilterState,
} from "../lib/glazes/filters";
import type { ComboKey, Glaze } from "../lib/glazes/types";
import {
  trackedGetDocs,
  trackedOnSnapshot,
  trackedSetDoc,
  trackedUpdateDoc,
} from "../lib/firestoreTelemetry";
import { safeStorageGetItem, safeStorageSetItem } from "../lib/safeStorage";
import { toVoidHandler } from "../utils/toVoidHandler";
import "./GlazeBoardView.css";

const GLAZY_SEARCH_BASE = "https://glazy.org/search?search=";
const MAX_IMAGE_EDGE = 1600;
const JPEG_QUALITY = 0.8;
const FAVORITES_KEY = "mf_glaze_favorites";
const GLAZE_LISTENER_LIMIT = 300;
const ATTACH_BATCH_LIMIT = 8;
const ATTACH_PIECES_PER_BATCH_LIMIT = 12;
type MatrixParseResult = ReturnType<typeof importGlazeMatrix>;
type ImportMetaEnvShape = {
  BASE_URL?: string;
  VITE_USE_EMULATORS?: string;
  VITE_STORAGE_EMULATOR_HOST?: string;
  VITE_STORAGE_EMULATOR_PORT?: string;
};
const ENV = (import.meta.env ?? {}) as ImportMetaEnvShape;

const FALLBACK_MATRIX = importGlazeMatrix(REAL_GLAZE_MATRIX_CSV);
const GLAZE_MATRIX_URL = `${(ENV.BASE_URL || "/").replace(/\/$/, "")}/glaze-matrix.csv`;

function buildGlazySearchUrl(name: string) {
  return `${GLAZY_SEARCH_BASE}${encodeURIComponent(name)}`;
}

function formatDateStamp(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function createShortId() {
  return Math.random().toString(36).slice(2, 8);
}

function getUserLabel(user: User) {
  return user.displayName || user.email || "Staff";
}

function groupHasTag(tags: readonly string[], tag: GlazeTag): boolean {
  return tags.includes(tag);
}

function normalizeTagList(tags?: string[] | null): GlazeTag[] {
  if (!Array.isArray(tags)) return [];
  return tags.filter((tag): tag is GlazeTag => ALL_TAGS.includes(tag as GlazeTag));
}

function mergeTagLists(primary: GlazeTag[], secondary: GlazeTag[]) {
  const combined = [...primary, ...secondary];
  return Array.from(new Set(combined));
}

async function compressImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const maxDimension = Math.max(bitmap.width, bitmap.height);
  const scale = maxDimension > MAX_IMAGE_EDGE ? MAX_IMAGE_EDGE / maxDimension : 1;
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close?.();
    throw new Error("Unable to read image.");
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Unable to compress image."));
          return;
        }
        resolve(blob);
      },
      "image/jpeg",
      JPEG_QUALITY
    );
  });
}

type Props = {
  user: User;
  isStaff: boolean;
};

type ComboPhotoDoc = {
  path: string;
  thumbPath?: string | null;
  caption?: string | null;
  createdAt?: string | null;
  createdBy?: string | null;
  coneNote?: string | null;
  tags?: string[] | null;
};

type ComboTileDoc = {
  comboId: number;
  coverPhotoPath?: string | null;
  photos?: ComboPhotoDoc[] | null;
  notes?: string | null;
  coneNotes?: string | null;
  flags?: string[] | null;
  updatedAt?: { toDate?: () => Date } | string | null;
  updatedBy?: string | null;
};

type ComboPhotoView = ComboPhotoDoc & {
  url?: string;
};

type TileMode = "combo" | "single";

type ComboTileView = {
  comboId: number;
  coverPhotoPath?: string | null;
  photos: ComboPhotoView[];
  notes?: string | null;
  coneNotes?: string | null;
  flags?: string[] | null;
  updatedAt?: string | null;
  updatedBy?: string | null;
};

type SingleTileDoc = {
  glazeId?: string | null;
  coverPhotoPath?: string | null;
  photos?: ComboPhotoDoc[] | null;
  notes?: string | null;
  flags?: string[] | null;
  updatedAt?: { toDate?: () => Date } | string | null;
  updatedBy?: string | null;
};

type SingleTileView = {
  glazeId: string;
  coverPhotoPath?: string | null;
  photos: ComboPhotoView[];
  notes?: string | null;
  flags?: string[] | null;
  updatedAt?: string | null;
  updatedBy?: string | null;
};

type SingleTileLookup = {
  glaze: Glaze;
  tile: SingleTileView | null;
} | null;

type ComboLookup = {
  id: number;
  base: Glaze;
  top: Glaze;
  tile?: ComboTileView;
};

type GlazeMetaDoc = {
  glazyUrl?: string | null;
  defaultTags?: string[] | null;
};

type AttachPieceOption = {
  batchId: string;
  pieceId: string;
  pieceCode: string;
  shortDesc?: string | null;
  stage?: string | null;
  selectedGlazes?: Array<{
    baseGlazeId?: string;
    topGlazeId?: string;
    comboId?: number;
  }> | null;
};

export default function GlazeBoardView({ user, isStaff }: Props) {
  const [tab, setTab] = useState<"studio" | "raku">("studio");
  const [tileMode, setTileMode] = useState<TileMode>("combo");
  const [searchQuery, setSearchQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterChipsOpen, setFilterChipsOpen] = useState(true);
  const [filtersCollapsed, setFiltersCollapsed] = useState(true);
  const [filterHasPhoto, setFilterHasPhoto] = useState(false);
  const [filterHasNotes, setFilterHasNotes] = useState(false);
  const [filterFavorites, setFilterFavorites] = useState(false);
  const [filterTagsByGroup, setFilterTagsByGroup] = useState(createEmptyTagFilters());

  const [selectedBaseId, setSelectedBaseId] = useState<string | null>(null);
  const [selectedTopId, setSelectedTopId] = useState<string | null>(null);
  const [selectedGlazeId, setSelectedGlazeId] = useState<string | null>(null);
  const [comboTilesById, setComboTilesById] = useState<Record<number, ComboTileView>>({});
  const [singleTilesById, setSingleTilesById] = useState<Record<string, SingleTileView>>({});
  const [glazeMetaById, setGlazeMetaById] = useState<Record<string, GlazeMetaDoc>>({});
  const [photoUrlByPath, setPhotoUrlByPath] = useState<Record<string, string>>({});
  const [tileStatus, setTileStatus] = useState("");

  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMode, setSheetMode] = useState<"add" | "edit">("add");
  const [sheetPhotoFile, setSheetPhotoFile] = useState<File | null>(null);
  const [sheetPreviewUrl, setSheetPreviewUrl] = useState<string | null>(null);
  const [sheetNote, setSheetNote] = useState("");
  const [sheetConeNote, setSheetConeNote] = useState("");
  const [sheetTags, setSheetTags] = useState<GlazeTag[]>([]);
  const [sheetNeedsRetest, setSheetNeedsRetest] = useState(false);
  const [sheetStatus, setSheetStatus] = useState("");
  const [sheetSaving, setSheetSaving] = useState(false);

  const [glazyBaseUrl, setGlazyBaseUrl] = useState("");
  const [glazyTopUrl, setGlazyTopUrl] = useState("");
  const [glazyStatus, setGlazyStatus] = useState("");

  const [favoriteComboIds, setFavoriteComboIds] = useState<number[]>([]);

  const [attachOpen, setAttachOpen] = useState(false);
  const [attachLoading, setAttachLoading] = useState(false);
  const [attachStatus, setAttachStatus] = useState("");
  const [attachQuery, setAttachQuery] = useState("");
  const [attachPieces, setAttachPieces] = useState<AttachPieceOption[]>([]);

  const { active: activeBatches, history: historyBatches } = useBatches(user);

  const [matrixState, setMatrixState] = useState<MatrixParseResult>(() => FALLBACK_MATRIX);

  useEffect(() => {
    let cancelled = false;
    const loadMatrix = async () => {
      try {
        const response = await fetch(GLAZE_MATRIX_URL, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Unable to load glaze matrix (${response.status} ${response.statusText})`);
        }
        const nextMatrix = importGlazeMatrix(await response.text());
        if (!cancelled) {
          setMatrixState(nextMatrix);
        }
      } catch {
        if (!cancelled) {
          setMatrixState(FALLBACK_MATRIX);
        }
      }
    };

    void loadMatrix();
    return () => {
      cancelled = true;
    };
  }, []);

  const { glazes: rawGlazes, comboKeys, baseNames, topNames } = matrixState;

  const glazes = useMemo(() => {
    return rawGlazes.map((glaze) => {
      const meta = glazeMetaById[glaze.id];
      if (!meta?.glazyUrl) return glaze;
      return {
        ...glaze,
        glazy: {
          ...glaze.glazy,
          url: meta.glazyUrl ?? glaze.glazy?.url,
        },
      };
    });
  }, [rawGlazes, glazeMetaById]);

  const glazeByName = useMemo(() => {
    const map = new Map<string, Glaze>();
    glazes.forEach((glaze) => {
      map.set(glaze.name, glaze);
    });
    return map;
  }, [glazes]);

  const baseGlazes = useMemo(
    () => baseNames.map((name) => glazeByName.get(name)).filter(Boolean) as Glaze[],
    [baseNames, glazeByName]
  );

  const topGlazes = useMemo(
    () => topNames.map((name) => glazeByName.get(name)).filter(Boolean) as Glaze[],
    [glazeByName, topNames]
  );

  const comboByKey = useMemo(() => {
    const map = new Map<string, ComboKey>();
    comboKeys.forEach((combo) => {
      map.set(`${combo.baseGlazeId}::${combo.topGlazeId}`, combo);
    });
    return map;
  }, [comboKeys]);

  useEffect(() => {
    if (!selectedBaseId && baseGlazes.length) {
      setSelectedBaseId(baseGlazes[0].id);
    }
  }, [selectedBaseId, baseGlazes]);

  useEffect(() => {
    if (!selectedTopId && topGlazes.length) {
      setSelectedTopId(topGlazes[0].id);
    }
  }, [selectedTopId, topGlazes]);

  useEffect(() => {
    if (!selectedGlazeId && glazes.length) {
      setSelectedGlazeId(glazes[0].id);
    }
  }, [selectedGlazeId, glazes]);

  const selectedComboId = useMemo(() => {
    if (!selectedBaseId || !selectedTopId) return null;
    return comboByKey.get(`${selectedBaseId}::${selectedTopId}`)?.id ?? null;
  }, [comboByKey, selectedBaseId, selectedTopId]);

  const selectedCombo: ComboLookup | null = useMemo(() => {
    if (!selectedComboId) return null;
    const combo = comboKeys.find((entry) => entry.id === selectedComboId);
    if (!combo) return null;
    const base = glazes.find((glaze) => glaze.id === combo.baseGlazeId);
    const top = glazes.find((glaze) => glaze.id === combo.topGlazeId);
    if (!base || !top) return null;
    const tile = comboTilesById[combo.id];
    return {
      id: combo.id,
      base,
      top,
      tile,
    };
  }, [comboKeys, glazes, selectedComboId, comboTilesById]);

  const selectedSingle: SingleTileLookup = useMemo(() => {
    if (!selectedGlazeId) return null;
    const glaze = glazes.find((item) => item.id === selectedGlazeId);
    if (!glaze) return null;
    return {
      glaze,
      tile: singleTilesById[selectedGlazeId] ?? null,
    };
  }, [glazes, selectedGlazeId, singleTilesById]);

  const comboMetaById = useMemo(() => {
    const meta: Record<number, ComboFilterMeta> = {};
    comboKeys.forEach((combo) => {
      meta[combo.id] = { hasPhoto: false, hasNotes: false, flags: [] };
    });
    Object.values(comboTilesById).forEach((tile) => {
      const flagList = normalizeTagList(tile.flags);
      const photoTags = tile.photos.flatMap((photo) => normalizeTagList(photo.tags));
      const tags = mergeTagLists(flagList, photoTags);
      meta[tile.comboId] = {
        hasPhoto: tile.photos.length > 0,
        hasNotes: Boolean(tile.notes || tile.coneNotes),
        flags: tags,
      };
    });
    return meta;
  }, [comboKeys, comboTilesById]);

  const singleMetaById = useMemo(() => {
    const meta: Record<string, ComboFilterMeta> = {};
    glazes.forEach((glaze) => {
      meta[glaze.id] = { hasPhoto: false, hasNotes: false, flags: [] };
    });
    Object.values(singleTilesById).forEach((tile) => {
      const flagList = normalizeTagList(tile.flags);
      const photoTags = tile.photos.flatMap((photo) => normalizeTagList(photo.tags));
      const tags = mergeTagLists(flagList, photoTags);
      meta[tile.glazeId] = {
        hasPhoto: tile.photos.length > 0,
        hasNotes: Boolean(tile.notes),
        flags: tags,
      };
    });
    return meta;
  }, [glazes, singleTilesById]);

  const isComboMode = tileMode === "combo";

  const filterState: ComboFilterState = useMemo(
    () => ({
      requirePhoto: filterHasPhoto,
      requireNotes: filterHasNotes,
      tagsByGroup: filterTagsByGroup,
    }),
    [filterHasPhoto, filterHasNotes, filterTagsByGroup]
  );

  const activeTags = useMemo(() => getActiveTags(filterTagsByGroup), [filterTagsByGroup]);
  const favoriteSet = useMemo(() => new Set(favoriteComboIds), [favoriteComboIds]);
  const filtersActive =
    filterHasPhoto || filterHasNotes || activeTags.length > 0 || (isComboMode && filterFavorites);

  const comboMatches = useMemo(() => {
    const next = new Map<number, boolean>();
    let count = 0;
    comboKeys.forEach((combo) => {
      const meta = comboMetaById[combo.id] || { hasPhoto: false, hasNotes: false, flags: [] };
      const matchesTags = matchesComboFilters(meta, filterState);
      const matchesFavorites = !filterFavorites || favoriteSet.has(combo.id);
      const match = matchesTags && matchesFavorites;
      next.set(combo.id, match);
      if (match) count += 1;
    });
    return { map: next, count };
  }, [comboKeys, comboMetaById, filterState, filterFavorites, favoriteSet]);

  const singleMatches = useMemo(() => {
    const next = new Map<string, boolean>();
    let count = 0;
    glazes.forEach((glaze) => {
      const meta = singleMetaById[glaze.id] || { hasPhoto: false, hasNotes: false, flags: [] };
      const matches = matchesComboFilters(meta, filterState);
      next.set(glaze.id, matches);
      if (matches) count += 1;
    });
    return { map: next, count };
  }, [glazes, singleMetaById, filterState]);

  const matchingCount = isComboMode
    ? filtersActive
      ? comboMatches.count
      : comboKeys.length
    : filtersActive
      ? singleMatches.count
      : glazes.length;

  const selectedComboMatches = useMemo(() => {
    if (!filtersActive || !selectedComboId) return true;
    return comboMatches.map.get(selectedComboId) ?? false;
  }, [filtersActive, selectedComboId, comboMatches.map]);

  const selectedSingleMatches = useMemo(() => {
    if (!filtersActive || !selectedGlazeId) return true;
    return singleMatches.map.get(selectedGlazeId) ?? false;
  }, [filtersActive, selectedGlazeId, singleMatches.map]);

  const selectedTileRecord = isComboMode ? selectedCombo?.tile : selectedSingle?.tile;

  const selectedTilePhotos = useMemo(() => {
    if (!selectedTileRecord?.photos.length) return [];
    return selectedTileRecord.photos.map((photo) => ({
      ...photo,
      url: photoUrlByPath[photo.path],
    }));
  }, [selectedTileRecord?.photos, photoUrlByPath]);

  const selectedTileMatches = isComboMode ? selectedComboMatches : selectedSingleMatches;

  const selectedTileTitle = useMemo(() => {
    if (isComboMode) {
      if (!selectedCombo) return null;
      return `Base: ${selectedCombo.base.name} + Top: ${selectedCombo.top.name}`;
    }
    if (!selectedSingle) return null;
    return `Glaze: ${selectedSingle.glaze.name}`;
  }, [isComboMode, selectedCombo, selectedSingle]);

  const baseMatches = useMemo(() => {
    const map = new Map<string, boolean>();
    baseGlazes.forEach((base) => {
      const hasMatch = comboKeys.some(
        (combo) => combo.baseGlazeId === base.id && (comboMatches.map.get(combo.id) ?? false)
      );
      map.set(base.id, hasMatch);
    });
    return map;
  }, [baseGlazes, comboKeys, comboMatches.map]);

  const topMatches = useMemo(() => {
    const map = new Map<string, boolean>();
    topGlazes.forEach((top) => {
      const hasMatch = comboKeys.some(
        (combo) => combo.topGlazeId === top.id && (comboMatches.map.get(combo.id) ?? false)
      );
      map.set(top.id, hasMatch);
    });
    return map;
  }, [topGlazes, comboKeys, comboMatches.map]);

  const filteredBaseGlazes = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return baseGlazes;
    return baseGlazes.filter((glaze) => glaze.name.toLowerCase().includes(query));
  }, [baseGlazes, searchQuery]);

  const filteredTopGlazes = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return topGlazes;
    return topGlazes.filter((glaze) => glaze.name.toLowerCase().includes(query));
  }, [topGlazes, searchQuery]);

  const filteredGlazes = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return glazes;
    return glazes.filter((glaze) => glaze.name.toLowerCase().includes(query));
  }, [glazes, searchQuery]);

  const storage = useMemo(() => {
    const instance = getStorage();
    if (typeof import.meta !== "undefined" && ENV.VITE_USE_EMULATORS === "true") {
      const host = String(ENV.VITE_STORAGE_EMULATOR_HOST || "127.0.0.1");
      const port = Number(ENV.VITE_STORAGE_EMULATOR_PORT || 9199);
      connectStorageEmulator(instance, host, port);
    }
    return instance;
  }, []);

  useEffect(() => {
    if (!sheetPhotoFile) {
      setSheetPreviewUrl(null);
      return undefined;
    }
    const url = URL.createObjectURL(sheetPhotoFile);
    setSheetPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [sheetPhotoFile]);

  useEffect(() => {
    const tilesRef = query(collection(db, "comboTiles"), limit(GLAZE_LISTENER_LIMIT));
    setTileStatus("");
    const unsubscribe = trackedOnSnapshot(
      "glazes:comboTiles",
      tilesRef,
      (snap) => {
        const next: Record<number, ComboTileView> = {};
        for (const docSnap of snap.docs ?? []) {
          const data = docSnap.data() as ComboTileDoc;
          const comboId = Number(data.comboId ?? docSnap.id);
          if (!Number.isFinite(comboId)) continue;
          const photos = Array.isArray(data.photos)
            ? data.photos.filter((photo) => photo && typeof photo.path === "string")
            : [];
          const updatedAt =
            typeof data.updatedAt === "string"
              ? data.updatedAt
              : data.updatedAt?.toDate?.()?.toISOString() ?? null;
          next[comboId] = {
            comboId,
            coverPhotoPath: data.coverPhotoPath ?? null,
            photos,
            notes: data.notes ?? null,
            coneNotes: data.coneNotes ?? null,
            flags: data.flags ?? null,
            updatedAt,
            updatedBy: data.updatedBy ?? null,
          };
        }
        setComboTilesById(next);
      },
      (error) => {
        setTileStatus(`Glaze tiles unavailable: ${error.message}`);
      }
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const tilesRef = query(collection(db, "singleTiles"), limit(GLAZE_LISTENER_LIMIT));
    setTileStatus("");
    const unsubscribe = trackedOnSnapshot(
      "glazes:singleTiles",
      tilesRef,
      (snap) => {
        const next: Record<string, SingleTileView> = {};
        for (const docSnap of snap.docs ?? []) {
          const data = docSnap.data() as SingleTileDoc;
          const glazeId = data.glazeId ?? docSnap.id;
          const photos = Array.isArray(data.photos)
            ? data.photos.filter((photo) => photo && typeof photo.path === "string")
            : [];
          const updatedAt =
            typeof data.updatedAt === "string"
              ? data.updatedAt
              : data.updatedAt?.toDate?.()?.toISOString() ?? null;
          next[glazeId] = {
            glazeId,
            coverPhotoPath: data.coverPhotoPath ?? null,
            photos,
            notes: data.notes ?? null,
            flags: data.flags ?? null,
            updatedAt,
            updatedBy: data.updatedBy ?? null,
          };
        }
        setSingleTilesById(next);
      },
      (error) => {
        setTileStatus(`Single glaze tiles unavailable: ${error.message}`);
      }
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const glazesRef = query(collection(db, "glazes"), limit(GLAZE_LISTENER_LIMIT));
    const unsubscribe = trackedOnSnapshot(
      "glazes:meta",
      glazesRef,
      (snap) => {
        const next: Record<string, GlazeMetaDoc> = {};
        for (const docSnap of snap.docs ?? []) {
          const data = docSnap.data() as GlazeMetaDoc;
          next[docSnap.id] = {
            glazyUrl: data.glazyUrl ?? null,
            defaultTags: data.defaultTags ?? null,
          };
        }
        setGlazeMetaById(next);
      },
      () => {
        setTileStatus("Glaze metadata is temporarily unavailable.");
      }
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!selectedTileRecord?.photos?.length) return;
    const missing = selectedTileRecord.photos
      .map((photo) => photo.path)
      .filter((path) => path && !photoUrlByPath[path]);
    if (missing.length === 0) return;

    let cancelled = false;

    Promise.all(
      missing.map(async (path) => {
        const url = await getDownloadURL(ref(storage, path));
        return { path, url };
      })
    )
      .then((entries) => {
        if (cancelled) return;
        setPhotoUrlByPath((prev) => {
          const next = { ...prev };
          entries.forEach(({ path, url }) => {
            next[path] = url;
          });
          return next;
        });
      })
      .catch(() => {
        if (!cancelled) {
          setTileStatus("Some glaze photos could not be loaded.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedTileRecord?.photos, photoUrlByPath, storage]);

  useEffect(() => {
    if (isComboMode) {
      if (!selectedCombo) {
        setGlazyBaseUrl("");
        setGlazyTopUrl("");
        return;
      }
      setGlazyBaseUrl(selectedCombo.base.glazy?.url ?? "");
      setGlazyTopUrl(selectedCombo.top.glazy?.url ?? "");
      return;
    }

    if (!selectedSingle) {
      setGlazyBaseUrl("");
      setGlazyTopUrl("");
      return;
    }
    setGlazyBaseUrl(selectedSingle.glaze.glazy?.url ?? "");
    setGlazyTopUrl("");
  }, [isComboMode, selectedCombo, selectedSingle]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = safeStorageGetItem("localStorage", FAVORITES_KEY);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setFavoriteComboIds(parsed.filter((id) => Number.isFinite(id)) as number[]);
      }
    } catch {
      // Ignore malformed favorites.
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    safeStorageSetItem("localStorage", FAVORITES_KEY, JSON.stringify(favoriteComboIds));
  }, [favoriteComboIds]);

  const selectedTileTags = useMemo(() => {
    if (!selectedTileRecord) return [];
    const tileFlags = normalizeTagList(selectedTileRecord.flags);
    const photoTags = selectedTileRecord.photos.flatMap((photo) => normalizeTagList(photo.tags));
    return mergeTagLists(tileFlags, photoTags);
  }, [selectedTileRecord]);

  const activeFilterPills = useMemo(() => {
    const pills: { key: string; label: string; onRemove: () => void }[] = [];
    if (filterHasPhoto) {
      pills.push({
        key: "has-photo",
        label: "Has photo",
        onRemove: () => setFilterHasPhoto(false),
      });
    }
    if (filterHasNotes) {
      pills.push({
        key: "has-notes",
        label: "Has notes",
        onRemove: () => setFilterHasNotes(false),
      });
    }
    if (isComboMode && filterFavorites) {
      pills.push({
        key: "favorites",
        label: "Favorites",
        onRemove: () => setFilterFavorites(false),
      });
    }
    activeTags.forEach((tag) => {
      pills.push({
        key: `tag-${tag}`,
        label: tag.replace(/-/g, " "),
        onRemove: () => {
          const group = TAG_GROUPS.find((entry) => groupHasTag(entry.tags, tag));
          if (!group) return;
          setFilterTagsByGroup((prev) => ({
            ...prev,
            [group.id]: (prev[group.id] || []).filter((value) => value !== tag),
          }));
        },
      });
    });
    return pills;
  }, [activeTags, filterHasPhoto, filterHasNotes, filterFavorites, isComboMode]);

  const openSheet = (mode: "add" | "edit") => {
    const target = isComboMode ? selectedCombo : selectedSingle;
    if (!target) return;
    const tile = selectedTileRecord;
    const tagSeed = tile ? normalizeTagList(tile.flags) : [];
    setSheetMode(mode);
    setSheetPhotoFile(null);
    setSheetNote(tile?.notes ?? "");
    setSheetConeNote(isComboMode ? selectedCombo?.tile?.coneNotes ?? "" : "");
    setSheetTags(tagSeed);
    setSheetNeedsRetest(Boolean(tile?.flags?.includes("needs-retest")));
    setSheetStatus("");
    setSheetOpen(true);
  };

  const closeSheet = () => {
    setSheetOpen(false);
    setSheetPhotoFile(null);
    setSheetStatus("");
  };

  const toggleSheetTag = (tag: GlazeTag) => {
    setSheetTags((prev) =>
      prev.includes(tag) ? prev.filter((value) => value !== tag) : [...prev, tag]
    );
  };

  const toggleFilterTag = (groupId: string, tag: GlazeTag) => {
    setFilterTagsByGroup((prev) => {
      const groupTags = prev[groupId] || [];
      const nextTags = groupTags.includes(tag)
        ? groupTags.filter((value) => value !== tag)
        : [...groupTags, tag];
      return { ...prev, [groupId]: nextTags };
    });
  };

  const resetFilters = () => {
    setFilterHasPhoto(false);
    setFilterHasNotes(false);
    setFilterFavorites(false);
    setFilterTagsByGroup(createEmptyTagFilters());
  };

  const handleSaveSheet = async () => {
    const tileId = isComboMode ? selectedComboId : selectedGlazeId;
    if (!tileId) return;
    if (!isStaff) return;

    const note = sheetNote.trim();
    const coneNote = isComboMode ? sheetConeNote.trim() : "";
    const hasNote = Boolean(note || coneNote);
    const hasPhoto = Boolean(sheetPhotoFile);

    if (!hasNote && !hasPhoto) {
      setSheetStatus(`Add a photo or a note so we can save this ${isComboMode ? "combo" : "glaze"}.`);
      return;
    }

    setSheetSaving(true);
    setSheetStatus("");

    const tileCollection = isComboMode ? "comboTiles" : "singleTiles";
    const tileRef = doc(db, tileCollection, String(tileId));
    const existingTile = isComboMode
      ? comboTilesById[selectedComboId as number]
      : singleTilesById[tileId];
    let nextPhotos = existingTile?.photos ?? [];
    let coverPhotoPath = existingTile?.coverPhotoPath ?? null;
    const storageFamily = isComboMode ? "combos" : "singles";

    try {
      if (sheetPhotoFile) {
        const dateStamp = formatDateStamp();
        const fileName = `${Date.now()}_${createShortId()}.jpg`;
        const newPhotoPath = `glazes/${tab}/${storageFamily}/${tileId}/${dateStamp}/${fileName}`;
        const photoRef = ref(storage, newPhotoPath);
        const blob = await compressImage(sheetPhotoFile);
        await uploadBytes(photoRef, blob, { contentType: "image/jpeg" });
        const createdAt = new Date().toISOString();
        const createdBy = getUserLabel(user);
        const photoEntry: ComboPhotoDoc = {
          path: newPhotoPath,
          caption: null,
          createdAt,
          createdBy,
          tags: sheetTags,
        };
        if (coneNote) {
          photoEntry.coneNote = coneNote;
        }
        nextPhotos = [...nextPhotos, photoEntry];
        if (!coverPhotoPath) {
          coverPhotoPath = newPhotoPath;
        }
        const downloadUrl = await getDownloadURL(photoRef);
        setPhotoUrlByPath((prev) => ({ ...prev, [newPhotoPath]: downloadUrl }));
      }

      const nextFlags = Array.from(
        new Set([
          ...sheetTags,
          ...(sheetNeedsRetest ? ["needs-retest"] : []),
        ])
      );

      await trackedSetDoc(
        "glazes:tileWrite",
        tileRef,
        isComboMode
          ? {
              comboId: selectedComboId ?? tileId,
              coverPhotoPath: coverPhotoPath ?? null,
              photos: nextPhotos,
              notes: note || null,
              coneNotes: coneNote || null,
              flags: nextFlags,
              updatedAt: serverTimestamp(),
              updatedBy: getUserLabel(user),
            }
          : {
              glazeId: tileId,
              coverPhotoPath: coverPhotoPath ?? null,
              photos: nextPhotos,
              notes: note || null,
              flags: nextFlags,
              updatedAt: serverTimestamp(),
              updatedBy: getUserLabel(user),
            },
        { merge: true }
      );

      setSheetStatus("Saved.");
      closeSheet();
    } catch (error: unknown) {
      setSheetStatus(
        error instanceof Error
          ? error.message
          : `Unable to save this ${isComboMode ? "combo" : "glaze"} right now.`
      );
    } finally {
      setSheetSaving(false);
    }
  };

  const handleDeletePhoto = async (path: string) => {
    const tileId = isComboMode ? selectedComboId : selectedGlazeId;
    if (!tileId || !isStaff) return;
    const tile = isComboMode ? comboTilesById[selectedComboId as number] : singleTilesById[tileId];
    if (!tile) return;
    const nextPhotos = tile.photos.filter((photo) => photo.path !== path);
    const nextCover =
      tile.coverPhotoPath === path ? nextPhotos[0]?.path ?? null : tile.coverPhotoPath ?? null;

    const tileCollection = isComboMode ? "comboTiles" : "singleTiles";
    await trackedUpdateDoc("glazes:tileWrite", doc(db, tileCollection, String(tileId)), {
      photos: nextPhotos,
      coverPhotoPath: nextCover,
      updatedAt: serverTimestamp(),
      updatedBy: getUserLabel(user),
    });

    try {
      await deleteObject(ref(storage, path));
    } catch {
      // If storage cleanup fails, keep Firestore state and let staff retry later.
    }
  };

  const handleSetCover = async (path: string) => {
    const tileId = isComboMode ? selectedComboId : selectedGlazeId;
    if (!tileId || !isStaff) return;
    const tileCollection = isComboMode ? "comboTiles" : "singleTiles";
    await trackedUpdateDoc("glazes:tileWrite", doc(db, tileCollection, String(tileId)), {
      coverPhotoPath: path,
      updatedAt: serverTimestamp(),
      updatedBy: getUserLabel(user),
    });
  };

  const handleSaveGlazyUrl = async (glazeId: string, url: string) => {
    if (!isStaff) return;
    const cleanUrl = url.trim();
    setGlazyStatus("Saving...");
    try {
      await trackedSetDoc(
        "glazes:meta",
        doc(db, "glazes", glazeId),
        {
          glazyUrl: cleanUrl || null,
          updatedAt: serverTimestamp(),
          updatedBy: getUserLabel(user),
        },
        { merge: true }
      );
      setGlazyStatus("Saved.");
    } catch (error: unknown) {
      setGlazyStatus(error instanceof Error ? error.message : "Unable to save Glazy link.");
    }
  };

  const toggleFavorite = () => {
    if (!selectedComboId) return;
    setFavoriteComboIds((prev) => {
      if (prev.includes(selectedComboId)) {
        return prev.filter((id) => id !== selectedComboId);
      }
      return [...prev, selectedComboId];
    });
  };

  const loadAttachPieces = useCallback(async () => {
    if (attachLoading) return;
    setAttachLoading(true);
    setAttachStatus("");

    const allBatches = [...activeBatches, ...historyBatches].slice(0, ATTACH_BATCH_LIMIT);
    if (!allBatches.length) {
      setAttachPieces([]);
      setAttachStatus("No pieces found yet.");
      setAttachLoading(false);
      return;
    }

    try {
      const pieceGroups = await Promise.all(
        allBatches.map(async (batch) => {
          const batchId = batch.id;
          const piecesQuery = query(
            collection(db, "batches", batchId, "pieces"),
            orderBy("updatedAt", "desc"),
            limit(ATTACH_PIECES_PER_BATCH_LIMIT)
          );
          const snap = await trackedGetDocs("glazes:attachPieces", piecesQuery);
          return snap.docs.map((docSnap) => {
            const data = docSnap.data() as {
              pieceCode?: unknown;
              shortDesc?: unknown;
              stage?: unknown;
              selectedGlazes?: unknown;
            };
            return {
              batchId,
              pieceId: docSnap.id,
              pieceCode: data?.pieceCode ?? docSnap.id,
              shortDesc: data?.shortDesc ?? "",
              stage: data?.stage ?? null,
              selectedGlazes: Array.isArray(data?.selectedGlazes)
                ? data.selectedGlazes
                : null,
            } as AttachPieceOption;
          });
        })
      );
      const combined = pieceGroups.flat();
      setAttachPieces(combined);
      if (combined.length === 0) {
        setAttachStatus("No pieces found yet.");
      } else if (activeBatches.length + historyBatches.length > ATTACH_BATCH_LIMIT) {
        setAttachStatus("Showing recent pieces from the latest check-ins. Use search to narrow quickly.");
      }
    } catch (error: unknown) {
      setAttachStatus(error instanceof Error ? error.message : "Unable to load pieces right now.");
    } finally {
      setAttachLoading(false);
    }
  }, [activeBatches, historyBatches, attachLoading]);

  useEffect(() => {
    if (!attachOpen) return;
    void loadAttachPieces();
  }, [attachOpen, loadAttachPieces]);

  const handleAttachPiece = async (piece: AttachPieceOption) => {
    if (!selectedCombo) return;
    const nextSelection = {
      baseGlazeId: selectedCombo.base.id,
      topGlazeId: selectedCombo.top.id,
      comboId: selectedCombo.id,
    };
    const existing = Array.isArray(piece.selectedGlazes) ? piece.selectedGlazes : [];
    const alreadySelected = existing.some(
      (item) =>
        item?.comboId === nextSelection.comboId &&
        item?.baseGlazeId === nextSelection.baseGlazeId &&
        item?.topGlazeId === nextSelection.topGlazeId
    );
    if (alreadySelected) {
      setAttachStatus(`Already attached to ${piece.pieceCode}.`);
      return;
    }

    const next = [...existing, nextSelection];
    await trackedUpdateDoc("glazes:attachPiece", doc(db, "batches", piece.batchId, "pieces", piece.pieceId), {
      selectedGlazes: next,
      updatedAt: serverTimestamp(),
    });
    setAttachPieces((prev) =>
      prev.map((item) =>
        item.pieceId === piece.pieceId && item.batchId === piece.batchId
          ? { ...item, selectedGlazes: next }
          : item
      )
    );
    setAttachStatus(`Attached to ${piece.pieceCode}.`);
  };

  const filteredAttachPieces = useMemo(() => {
    const queryText = attachQuery.trim().toLowerCase();
    if (!queryText) return attachPieces;
    return attachPieces.filter((piece) => {
      const code = piece.pieceCode?.toLowerCase() ?? "";
      const desc = piece.shortDesc?.toLowerCase() ?? "";
      return code.includes(queryText) || desc.includes(queryText);
    });
  }, [attachPieces, attachQuery]);

  const selectedComboFavorite =
    isComboMode && selectedComboId ? favoriteSet.has(selectedComboId) : false;

  if (tab === "raku") {
    return (
      <div className="page glaze-board-page">
        <div className="page-header">
          <div>
            <h1>Studio glaze board</h1>
            <p className="page-subtitle">Raku combos are coming next.</p>
          </div>
          <div className="glaze-tabs">
            <button type="button" onClick={() => setTab("studio")}>
              Studio
            </button>
            <button type="button" className="active" onClick={() => setTab("raku")}>
              Raku
            </button>
          </div>
        </div>
        <div className="card card-3d glaze-placeholder">
          Raku glaze board is on deck. We&apos;ll add it after the studio set is live.
        </div>
      </div>
    );
  }

  return (
    <div className="page glaze-board-page">
      <div className="page-header">
        <div>
          <h1>Studio glaze board</h1>
          <p className="page-subtitle">
            {isComboMode
              ? "Pick a base and a top glaze. The studio photo + notes sit in the middle."
              : "Pick a glaze to view its single tile photos and notes."}
          </p>
        </div>
        <div className="glaze-tabs">
          <button type="button" className="active" onClick={() => setTab("studio")}>
            Studio
          </button>
          <button type="button" onClick={() => setTab("raku")}>
            Raku
          </button>
        </div>
        <div className="glaze-mode-toggle">
          <button
            type="button"
            className={tileMode === "combo" ? "active" : ""}
            onClick={() => setTileMode("combo")}
          >
            Combo tiles
          </button>
          <button
            type="button"
            className={tileMode === "single" ? "active" : ""}
            onClick={() => setTileMode("single")}
          >
            Single glaze tiles
          </button>
        </div>
      </div>

      <div className="glaze-toolbar">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setFiltersOpen(true)}
        >
          Filters
        </button>
        <div className="glaze-filter-count">Matching tiles: {matchingCount}</div>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            setFiltersCollapsed((prev) => {
              const next = !prev;
              if (next) setFiltersOpen(false);
              return next;
            });
          }}
        >
          {filtersCollapsed ? "Show filters" : "Hide filters"}
        </button>
        {filtersActive ? (
          <button type="button" className="btn btn-ghost" onClick={resetFilters}>
            Reset filters
          </button>
        ) : null}
      </div>
      <div className="glaze-subtitle">
        Live tile streams are capped to {GLAZE_LISTENER_LIMIT} records per board in this view.
      </div>

      {filtersActive && activeFilterPills.length ? (
        <div className="glaze-active-filter-wrap">
          <div className="glaze-active-filter-header">
            <div className="glaze-active-filter-label">
              Active filters ({activeFilterPills.length})
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-small"
              onClick={() => setFilterChipsOpen((prev) => !prev)}
            >
              {filterChipsOpen ? "Hide chips" : "Show chips"}
            </button>
          </div>
          <div className={`glaze-active-filters ${filterChipsOpen ? "open" : "collapsed"}`}>
            {activeFilterPills.map((pill) => (
              <button
                key={pill.key}
                type="button"
                className="glaze-filter-pill"
                onClick={pill.onRemove}
              >
                {pill.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {filtersOpen ? (
        <button
          type="button"
          className="glaze-filter-backdrop"
          onClick={() => setFiltersOpen(false)}
          aria-label="Close filters"
        />
      ) : null}

      <section
        className={`glaze-filter-panel card card-3d ${filtersOpen ? "open" : ""} ${
          filtersCollapsed ? "collapsed" : ""
        }`}
      >
        <div className="glaze-filter-header">
          <div>
            <div className="card-title">Filters</div>
            <div className="glaze-subtitle">
              Use tags to narrow to the {isComboMode ? "combos" : "glazes"} you want.
            </div>
          </div>
        </div>

        <label className="glaze-filter-field">
          Search glaze
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={isComboMode ? "Search base or top" : "Search glaze"}
          />
        </label>

        <div className="glaze-filter-toggles">
          <label className="glaze-filter-toggle">
            <input
              type="checkbox"
              checked={filterHasPhoto}
              onChange={(event) => setFilterHasPhoto(event.target.checked)}
            />
            <span>Has photo</span>
          </label>
          <label className="glaze-filter-toggle">
            <input
              type="checkbox"
              checked={filterHasNotes}
              onChange={(event) => setFilterHasNotes(event.target.checked)}
            />
            <span>Has notes</span>
          </label>
        </div>

        <div className="glaze-filter-group">
          <div className="glaze-filter-group-title">Quick tags</div>
          <div className="glaze-tag-row">
            {QUICK_TAGS.map((tag) => (
              <button
                key={tag}
                type="button"
                className={`glaze-tag ${activeTags.includes(tag) ? "active" : ""}`}
                onClick={() => {
                  const group = TAG_GROUPS.find((entry) => groupHasTag(entry.tags, tag));
                  if (!group) return;
                  toggleFilterTag(group.id, tag);
                }}
              >
                {tag.replace(/-/g, " ")}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="glaze-clear-tags"
            onClick={() => setFilterTagsByGroup(createEmptyTagFilters())}
          >
            Clear tags
          </button>
        </div>

        {TAG_GROUPS.map((group) => (
          <div key={group.id} className="glaze-filter-group">
            <div className="glaze-filter-group-title">{group.label}</div>
            <div className="glaze-tag-row">
              {group.tags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className={`glaze-tag ${filterTagsByGroup[group.id]?.includes(tag) ? "active" : ""}`}
                  onClick={() => toggleFilterTag(group.id, tag)}
                >
                  {tag.replace(/-/g, " ")}
                </button>
              ))}
            </div>
          </div>
        ))}

        {isComboMode ? (
          <label className="glaze-filter-toggle">
            <input
              type="checkbox"
              checked={filterFavorites}
              onChange={(event) => setFilterFavorites(event.target.checked)}
            />
            <span>Only show favorites</span>
          </label>
        ) : null}
      </section>

      <div className={`glaze-board-layout ${isComboMode ? "" : "glaze-board-layout--single"}`}>
        {isComboMode ? (
          <>
            <section className="glaze-list-panel card card-3d glaze-panel-base">
              <div className="card-title">Base glazes</div>
              <div className="glaze-list">
                {filteredBaseGlazes.map((glaze) => {
                  const hasMatch = baseMatches.get(glaze.id) ?? true;
                  return (
                    <button
                      key={glaze.id}
                      type="button"
                      className={`glaze-list-item ${selectedBaseId === glaze.id ? "active" : ""} ${
                        filtersActive && !hasMatch ? "muted" : ""
                      }`}
                      onClick={() => setSelectedBaseId(glaze.id)}
                    >
                      {glaze.name}
                    </button>
                  );
                })}
                {filteredBaseGlazes.length === 0 ? (
                  <div className="glaze-empty">No base glazes match.</div>
                ) : null}
              </div>
            </section>

            <aside className="glaze-detail card card-3d glaze-panel-detail">
              {selectedCombo ? (
                <>
                  <div className="glaze-detail-header">
                    <div className="card-title">Combo details</div>
                    <div className="glaze-detail-actions">
                      <button
                        type="button"
                        className={`glaze-favorite ${selectedComboFavorite ? "active" : ""}`}
                        onClick={toggleFavorite}
                        aria-pressed={selectedComboFavorite}
                      >
                        {selectedComboFavorite ? "★ Favorite" : "☆ Favorite"}
                      </button>
                      {!selectedTileMatches ? (
                        <span className="glaze-filter-flag">Doesn&apos;t match filters</span>
                      ) : null}
                    </div>
                  </div>
                  <h2>{selectedTileTitle}</h2>
                  {selectedTileTags.length ? (
                    <div className="glaze-tag-row compact">
                      {selectedTileTags.map((tag) => (
                        <span key={tag} className="glaze-tag active">
                          {tag.replace(/-/g, " ")}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {selectedTilePhotos.length ? (
                    <div className="glaze-photo-strip">
                      {selectedTilePhotos.map((photo, index) => (
                        <figure key={`${photo.path}-${index}`}>
                          {photo.url ? (
                            <img src={photo.url} alt={photo.caption || "Glaze photo"} />
                          ) : (
                            <div className="glaze-photo-placeholder">Loading image...</div>
                          )}
                          <figcaption>{photo.caption || "Studio photo"}</figcaption>
                          {isStaff ? (
                            <div className="glaze-photo-actions">
                              <button
                                type="button"
                                className={
                                  selectedTileRecord?.coverPhotoPath === photo.path ? "active" : ""
                                }
                                onClick={toVoidHandler(() => handleSetCover(photo.path))}
                              >
                                {selectedTileRecord?.coverPhotoPath === photo.path ? "Cover" : "Set as cover"}
                              </button>
                              <button type="button" onClick={toVoidHandler(() => handleDeletePhoto(photo.path))}>
                                Delete
                              </button>
                            </div>
                          ) : null}
                        </figure>
                      ))}
                    </div>
                  ) : (
                    <div className="glaze-empty">No photos yet.</div>
                  )}
                  <div className="glaze-note">
                    <strong>Notes</strong>
                    <p>{selectedCombo.tile?.notes || "No notes yet."}</p>
                  </div>
                  <div className="glaze-note">
                    <strong>Cone notes</strong>
                    <p>{selectedCombo.tile?.coneNotes || "No cone notes yet."}</p>
                  </div>
                  <div className="glaze-links">
                    <a
                      href={buildGlazySearchUrl(selectedCombo.base.name)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Search {selectedCombo.base.name} on Glazy
                    </a>
                    {selectedCombo.base.glazy?.url ? (
                      <a href={selectedCombo.base.glazy.url} target="_blank" rel="noreferrer">
                        Open {selectedCombo.base.name} on Glazy
                      </a>
                    ) : null}
                    <a
                      href={buildGlazySearchUrl(selectedCombo.top.name)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Search {selectedCombo.top.name} on Glazy
                    </a>
                    {selectedCombo.top.glazy?.url ? (
                      <a href={selectedCombo.top.glazy.url} target="_blank" rel="noreferrer">
                        Open {selectedCombo.top.name} on Glazy
                      </a>
                    ) : null}
                  </div>

                  {isStaff ? (
                    <div className="glaze-staff-controls">
                      <div className="glaze-staff-row">
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => openSheet("add")}
                        >
                          Add photo + note
                        </button>
                        <button type="button" className="btn btn-ghost" onClick={() => openSheet("edit")}>
                          Edit notes
                        </button>
                      </div>
                      <div className="glaze-staff-row glaze-staff-mapping">
                        <label>
                          Base Glazy URL
                          <input
                            type="url"
                            value={glazyBaseUrl}
                            placeholder="https://glazy.org/..."
                            onChange={(event) => setGlazyBaseUrl(event.target.value)}
                          />
                        </label>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={toVoidHandler(() =>
                            handleSaveGlazyUrl(selectedCombo.base.id, glazyBaseUrl)
                          )}
                        >
                          Save base link
                        </button>
                      </div>
                      <div className="glaze-staff-row glaze-staff-mapping">
                        <label>
                          Top Glazy URL
                          <input
                            type="url"
                            value={glazyTopUrl}
                            placeholder="https://glazy.org/..."
                            onChange={(event) => setGlazyTopUrl(event.target.value)}
                          />
                        </label>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={toVoidHandler(() =>
                            handleSaveGlazyUrl(selectedCombo.top.id, glazyTopUrl)
                          )}
                        >
                          Save top link
                        </button>
                      </div>
                      {glazyStatus ? <div className="glaze-status">{glazyStatus}</div> : null}
                    </div>
                  ) : null}

                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setAttachOpen(true);
                      setAttachStatus("");
                    }}
                  >
                    Attach to a piece
                  </button>
                  {tileStatus ? <div className="glaze-status">{tileStatus}</div> : null}
                </>
              ) : (
                <div className="glaze-empty">Tap a combo to see photos, notes, and cone details.</div>
              )}
            </aside>

            <section className="glaze-list-panel card card-3d glaze-panel-top">
              <div className="card-title">Top glazes</div>
              <div className="glaze-subtitle">
                Base: {selectedCombo?.base.name ?? "Select a base glaze"}
              </div>
              <div className="glaze-list">
                {filteredTopGlazes.map((glaze) => {
                  const hasMatch = topMatches.get(glaze.id) ?? true;
                  return (
                    <button
                      key={glaze.id}
                      type="button"
                      className={`glaze-list-item ${selectedTopId === glaze.id ? "active" : ""} ${
                        filtersActive && !hasMatch ? "muted" : ""
                      }`}
                      onClick={() => setSelectedTopId(glaze.id)}
                    >
                      {glaze.name}
                    </button>
                  );
                })}
                {filteredTopGlazes.length === 0 ? (
                  <div className="glaze-empty">No top glazes match.</div>
                ) : null}
              </div>
            </section>
          </>
        ) : (
          <>
            <section className="glaze-list-panel card card-3d">
              <div className="card-title">All glazes</div>
              <div className="glaze-list">
                {filteredGlazes.map((glaze) => {
                  const hasMatch = singleMatches.map.get(glaze.id) ?? true;
                  return (
                    <button
                      key={glaze.id}
                      type="button"
                      className={`glaze-list-item ${selectedGlazeId === glaze.id ? "active" : ""} ${
                        filtersActive && !hasMatch ? "muted" : ""
                      }`}
                      onClick={() => setSelectedGlazeId(glaze.id)}
                    >
                      {glaze.name}
                    </button>
                  );
                })}
                {filteredGlazes.length === 0 ? (
                  <div className="glaze-empty">No glazes match.</div>
                ) : null}
              </div>
            </section>

            <aside className="glaze-detail card card-3d glaze-panel-detail">
              {selectedSingle ? (
                <>
                  <div className="glaze-detail-header">
                    <div className="card-title">Glaze details</div>
                    <div className="glaze-detail-actions">
                      {!selectedTileMatches ? (
                        <span className="glaze-filter-flag">Doesn&apos;t match filters</span>
                      ) : null}
                    </div>
                  </div>
                  <h2>{selectedTileTitle}</h2>
                  {selectedTileTags.length ? (
                    <div className="glaze-tag-row compact">
                      {selectedTileTags.map((tag) => (
                        <span key={tag} className="glaze-tag active">
                          {tag.replace(/-/g, " ")}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {selectedTilePhotos.length ? (
                    <div className="glaze-photo-strip">
                      {selectedTilePhotos.map((photo, index) => (
                        <figure key={`${photo.path}-${index}`}>
                          {photo.url ? (
                            <img src={photo.url} alt={photo.caption || "Glaze photo"} />
                          ) : (
                            <div className="glaze-photo-placeholder">Loading image...</div>
                          )}
                          <figcaption>{photo.caption || "Studio photo"}</figcaption>
                          {isStaff ? (
                            <div className="glaze-photo-actions">
                              <button
                                type="button"
                                className={
                                  selectedTileRecord?.coverPhotoPath === photo.path ? "active" : ""
                                }
                                onClick={toVoidHandler(() => handleSetCover(photo.path))}
                              >
                                {selectedTileRecord?.coverPhotoPath === photo.path ? "Cover" : "Set as cover"}
                              </button>
                              <button type="button" onClick={toVoidHandler(() => handleDeletePhoto(photo.path))}>
                                Delete
                              </button>
                            </div>
                          ) : null}
                        </figure>
                      ))}
                    </div>
                  ) : (
                    <div className="glaze-empty">No photos yet.</div>
                  )}
                  <div className="glaze-note">
                    <strong>Notes</strong>
                    <p>{selectedSingle?.tile?.notes || "No notes yet."}</p>
                  </div>
                  <div className="glaze-links">
                    <a
                      href={buildGlazySearchUrl(selectedSingle.glaze.name)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Search {selectedSingle.glaze.name} on Glazy
                    </a>
                    {selectedSingle.glaze.glazy?.url ? (
                      <a href={selectedSingle.glaze.glazy.url} target="_blank" rel="noreferrer">
                        Open {selectedSingle.glaze.name} on Glazy
                      </a>
                    ) : null}
                  </div>

                  {isStaff ? (
                    <div className="glaze-staff-controls">
                      <div className="glaze-staff-row">
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => openSheet("add")}
                        >
                          Add photo + note
                        </button>
                        <button type="button" className="btn btn-ghost" onClick={() => openSheet("edit")}>
                          Edit notes
                        </button>
                      </div>
                      <div className="glaze-staff-row glaze-staff-mapping">
                        <label>
                          Glazy URL
                          <input
                            type="url"
                            value={glazyBaseUrl}
                            placeholder="https://glazy.org/..."
                            onChange={(event) => setGlazyBaseUrl(event.target.value)}
                          />
                        </label>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={toVoidHandler(() =>
                            handleSaveGlazyUrl(selectedSingle.glaze.id, glazyBaseUrl)
                          )}
                        >
                          Save glaze link
                        </button>
                      </div>
                      {glazyStatus ? <div className="glaze-status">{glazyStatus}</div> : null}
                    </div>
                  ) : null}
                  {tileStatus ? <div className="glaze-status">{tileStatus}</div> : null}
                </>
              ) : (
                <div className="glaze-empty">Tap a glaze to see its photos and notes.</div>
              )}
            </aside>
          </>
        )}
      </div>

      {attachOpen ? (
        <button
          type="button"
          className="glaze-attach-backdrop"
          onClick={() => setAttachOpen(false)}
          aria-label="Close attach panel"
        />
      ) : null}

      <div className={`glaze-attach-modal ${attachOpen ? "open" : ""}`}>
        <div className="glaze-attach-header">
          <div>
            <div className="card-title">Attach this combo</div>
            <div className="glaze-subtitle">
              Add a glaze combo to one of your pieces for studio reference.
            </div>
            <div className="glaze-subtitle">
              Showing pieces from up to {ATTACH_BATCH_LIMIT} recent check-ins ({ATTACH_PIECES_PER_BATCH_LIMIT} pieces each).
            </div>
          </div>
          <button type="button" className="btn btn-ghost" onClick={() => setAttachOpen(false)}>
            Close
          </button>
        </div>
        <label className="glaze-filter-field">
          Search pieces
          <input
            type="text"
            value={attachQuery}
            onChange={(event) => setAttachQuery(event.target.value)}
            placeholder="Search by piece code or note"
          />
        </label>
        {attachLoading ? <div className="glaze-empty">Loading pieces...</div> : null}
        {!attachLoading && filteredAttachPieces.length === 0 ? (
          <div className="glaze-empty">No pieces available yet.</div>
        ) : null}
        <div className="glaze-attach-list">
          {filteredAttachPieces.map((piece) => (
            <div key={`${piece.batchId}-${piece.pieceId}`} className="glaze-attach-row">
              <div>
                <div className="glaze-attach-title">{piece.pieceCode}</div>
                <div className="glaze-subtitle">
                  {piece.shortDesc || "No description"}
                  {piece.stage ? ` · ${piece.stage}` : ""}
                </div>
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={toVoidHandler(() => handleAttachPiece(piece))}
              >
                Attach
              </button>
            </div>
          ))}
        </div>
        {attachStatus ? <div className="glaze-status">{attachStatus}</div> : null}
      </div>

      <div className={`glaze-sheet ${sheetOpen ? "open" : ""}`}>
        <div className="glaze-sheet-header">
          <div>
            <div className="card-title">
              {sheetMode === "add" ? "Add photo + note" : "Update notes"}
            </div>
            <div className="glaze-subtitle">Fast updates for staff. Add at least a photo or note.</div>
          </div>
          <button type="button" className="btn btn-ghost" onClick={closeSheet}>
            Close
          </button>
        </div>
        <div className="glaze-sheet-body">
          <label className="glaze-file-picker">
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(event) =>
                setSheetPhotoFile(event.target.files?.[0] ? event.target.files[0] : null)
              }
            />
            {sheetPreviewUrl ? (
              <img src={sheetPreviewUrl} alt="Preview" />
            ) : (
              <span>Tap to add a photo</span>
            )}
          </label>

          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              if (selectedTileRecord) {
                setSheetNote(selectedTileRecord.notes ?? "");
                if (isComboMode) {
                  setSheetConeNote(selectedCombo?.tile?.coneNotes ?? "");
                }
              }
            }}
          >
            Copy last note
          </button>

          <label>
            Quick note
            <textarea
              rows={4}
              value={sheetNote}
              onChange={(event) => setSheetNote(event.target.value)}
              placeholder="Short notes from the test tile"
            />
          </label>

          {isComboMode ? (
            <label>
              Cone / firing note
              <textarea
                rows={3}
                value={sheetConeNote}
                onChange={(event) => setSheetConeNote(event.target.value)}
                placeholder="Cone 6 ran more, cone 5 held, etc."
              />
            </label>
          ) : null}

          <div className="glaze-filter-group">
            <div className="glaze-filter-group-title">Quick tags</div>
            <div className="glaze-tag-row">
              {QUICK_TAGS.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className={`glaze-tag ${sheetTags.includes(tag) ? "active" : ""}`}
                  onClick={() => toggleSheetTag(tag)}
                >
                  {tag.replace(/-/g, " ")}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="glaze-clear-tags"
              onClick={() => setSheetTags([])}
            >
              Clear tags
            </button>
          </div>

          {TAG_GROUPS.map((group) => (
            <div key={group.id} className="glaze-filter-group">
              <div className="glaze-filter-group-title">{group.label}</div>
              <div className="glaze-tag-row">
                {group.tags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className={`glaze-tag ${sheetTags.includes(tag) ? "active" : ""}`}
                    onClick={() => toggleSheetTag(tag)}
                  >
                    {tag.replace(/-/g, " ")}
                  </button>
                ))}
              </div>
            </div>
          ))}

          <label className="glaze-filter-toggle">
            <input
              type="checkbox"
              checked={sheetNeedsRetest}
              onChange={(event) => setSheetNeedsRetest(event.target.checked)}
            />
            <span>Mark as needs retest</span>
          </label>

          {sheetStatus ? <div className="glaze-status">{sheetStatus}</div> : null}
        </div>
        <div className="glaze-sheet-footer">
          <button type="button" className="btn btn-ghost" onClick={closeSheet}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={toVoidHandler(handleSaveSheet)}
            disabled={sheetSaving}
          >
            {sheetSaving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

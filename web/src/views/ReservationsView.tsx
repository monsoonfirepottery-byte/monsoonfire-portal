import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import type { User } from "firebase/auth";
import { collection, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { connectStorageEmulator, getDownloadURL, getStorage, ref, uploadBytes } from "firebase/storage";
import { createFunctionsClient, type LastRequest } from "../api/functionsClient";
import { db } from "../firebase";
import {
  FULL_KILN_CUSTOM_PRICE,
  HALF_SHELF_BISQUE_PRICE,
  HALF_SHELF_GLAZE_PRICE,
  DELIVERY_PRICE_PER_TRIP,
  RUSH_REQUEST_PRICE,
  WAX_RESIST_ASSIST_PRICE,
  GLAZE_SANITY_CHECK_PRICE,
  VOLUME_PRICE_PER_IN3,
  applyHalfKilnPriceBreak,
  computeDeliveryCost,
  computeEstimatedCost,
} from "../lib/pricing";
import {
  normalizeReservationRecord,
  type ReservationRecord,
} from "../lib/normalizers/reservations";
import { formatDateTime } from "../utils/format";
import { toVoidHandler } from "../utils/toVoidHandler";
import { shortId, track } from "../lib/analytics";
import RevealCard from "../components/RevealCard";
import { useUiSettings } from "../context/UiSettingsContext";
import "./ReservationsView.css";

type StaffUserOption = {
  id: string;
  displayName: string;
  email?: string | null;
};

const FIRING_OPTIONS = [
  { id: "bisque", label: "Bisque fire" },
  { id: "glaze", label: "Glaze fire" },
  { id: "other", label: "Other / ask us" },
] as const;

const WARE_TYPES = [
  { id: "stoneware", label: "Stoneware" },
  { id: "earthenware", label: "Earthenware" },
  { id: "porcelain", label: "Porcelain" },
  { id: "mixed", label: "Mixed / unsure" },
] as const;

const CHECKIN_NOTE_TAGS = [
  "Fragile handles",
  "Thin rim",
  "Large platter",
  "Tall piece",
  "Stackable plates",
  "Glaze on bottom",
  "Needs stilt",
  "Crystal glaze",
  "Runny glaze",
  "Keep together",
  "Separate pieces",
  "First firing",
] as const;

const KILN_OPTIONS = [
  {
    id: "studio-electric",
    label: "Studio kiln (electric)",
    detail: "Steady, reliable studio firing.",
    matchNames: ["L&L eQ2827-3", "Studio kiln (electric)"],
  },
  {
    id: "reduction-raku",
    label: "Raku",
    detail: "Reduction firings + raku sessions.",
    matchNames: ["Raku", "Reduction Raku Kiln"],
  },
] as const;

const CHECKIN_PREFILL_KEY = "mf_checkin_prefill";

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const DEFAULT_FUNCTIONS_BASE_URL = "https://us-central1-monsoonfire-portal.cloudfunctions.net";
type ImportMetaEnvShape = {
  DEV?: boolean;
  VITE_FUNCTIONS_BASE_URL?: string;
  VITE_USE_EMULATORS?: string;
  VITE_STORAGE_EMULATOR_HOST?: string;
  VITE_STORAGE_EMULATOR_PORT?: string;
};
type StaffClaims = { staff?: boolean; roles?: string[] };
const ENV = (import.meta.env ?? {}) as ImportMetaEnvShape;
const DEV_MODE = typeof import.meta !== "undefined" && Boolean(ENV.DEV);

function resolveFunctionsBaseUrl() {
  const env =
    typeof import.meta !== "undefined" && ENV.VITE_FUNCTIONS_BASE_URL
      ? String(ENV.VITE_FUNCTIONS_BASE_URL)
      : "";
  return env || DEFAULT_FUNCTIONS_BASE_URL;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = error as { code?: unknown; name?: unknown };
  if (typeof value.code === "string") return value.code;
  if (typeof value.name === "string") return value.name;
  return undefined;
}

function formatPreferredWindow(record: ReservationRecord): string {
  const latest = record.preferredWindow?.latestDate?.toDate?.();
  if (!latest) return "Flexible";
  return `Need by: ${formatDateTime(latest)}`;
}

const USD_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

function formatUsd(value: number) {
  return USD_FORMATTER.format(value);
}

function formatHalfShelfCount(value: number | null | undefined) {
  if (!Number.isFinite(value)) return "0 half shelves";
  const rounded = Math.round(value as number);
  return `${rounded} half shelf${rounded === 1 ? "" : "es"}`;
}

function sanitizeDebugPayload(payload: Record<string, unknown> | null | undefined) {
  if (!payload || typeof payload !== "object") return payload;
  const next = { ...payload };
  if (next.photoUrl) next.photoUrl = "<redacted>";
  if (next.photoPath) next.photoPath = "<redacted>";
  if (next.notes) next.notes = "<redacted>";
  if (next.ownerUid) next.ownerUid = "<uid>";
  if (next.linkedBatchId) next.linkedBatchId = "<batch>";
  return next;
}

function sanitizeDateInput(value: string) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function makeClientRequestId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `req_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
  }
}

function getFileExtension(file: File) {
  const name = file.name || "";
  const idx = name.lastIndexOf(".");
  if (idx > -1 && idx < name.length - 1) {
    return name.slice(idx + 1).toLowerCase();
  }
  const type = file.type || "";
  if (type.includes("png")) return "png";
  if (type.includes("webp")) return "webp";
  return "jpg";
}

type Props = {
  user: User;
  isStaff: boolean;
  adminToken?: string;
};

type KilnOption = (typeof KILN_OPTIONS)[number] & {
  status?: string | null;
  isOffline?: boolean;
};

export default function ReservationsView({ user, isStaff, adminToken }: Props) {
  const { themeName, portalMotion } = useUiSettings();
  const motionEnabled = themeName === "memoria" && portalMotion === "enhanced";
  const [reservations, setReservations] = useState<ReservationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [lastReq, setLastReq] = useState<LastRequest | null>(null);
  const [kilnStatusByName, setKilnStatusByName] = useState<Record<string, string>>({});

  const [mode, setMode] = useState<"client" | "staff">("client");
  const [staffUsers, setStaffUsers] = useState<StaffUserOption[]>([]);
  const [staffTargetUid, setStaffTargetUid] = useState("");

  const [wareType, setWareType] = useState("stoneware");
  const [kilnId, setKilnId] = useState("studio-electric");
  const [firingType, setFiringType] = useState<(typeof FIRING_OPTIONS)[number]["id"]>("bisque");
  const [footprintHalfShelves, setFootprintHalfShelves] = useState(1);
  const [showMoreFootprints, setShowMoreFootprints] = useState(false);
  const [hasTallPieces, setHasTallPieces] = useState(false);
  const [tiers, setTiers] = useState<number | null>(1);
  const [estimatedHalfShelves, setEstimatedHalfShelves] = useState<number | null>(1);
  const [useVolumePricing, setUseVolumePricing] = useState(false);
  const [volumeMode, setVolumeMode] = useState<"total" | "dimensions">("total");
  const [volumeIn3, setVolumeIn3] = useState<number | null>(null);
  const [volumeLengthIn, setVolumeLengthIn] = useState<number | null>(null);
  const [volumeWidthIn, setVolumeWidthIn] = useState<number | null>(null);
  const [volumeHeightIn, setVolumeHeightIn] = useState<number | null>(null);
  const [fitsOnOneLayer, setFitsOnOneLayer] = useState<"yes" | "no" | null>(null);

  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [photoStatus, setPhotoStatus] = useState("");
  const [animateEstimate, setAnimateEstimate] = useState(false);

  const [latest, setLatest] = useState("");
  const [linkedBatchId, setLinkedBatchId] = useState("");
  const [notesGeneral, setNotesGeneral] = useState("");
  const [notesTags, setNotesTags] = useState<string[]>([]);
  const [rushRequested, setRushRequested] = useState(false);
  const [waxResistAssistRequested, setWaxResistAssistRequested] = useState(false);
  const [glazeSanityCheckRequested, setGlazeSanityCheckRequested] = useState(false);
  const [wholeKilnRequested, setWholeKilnRequested] = useState(false);
  const [pickupDeliveryRequested, setPickupDeliveryRequested] = useState(false);
  const [returnDeliveryRequested, setReturnDeliveryRequested] = useState(false);
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryInstructions, setDeliveryInstructions] = useState("");
  const [useStudioGlazes, setUseStudioGlazes] = useState(false);
  const [glazeAccessCost, setGlazeAccessCost] = useState<number | null>(null);

  const [formError, setFormError] = useState("");
  const [formStatus, setFormStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [submitRequestId, setSubmitRequestId] = useState<string | null>(null);
  const [prefillNote, setPrefillNote] = useState<string | null>(null);
  const [authDebug, setAuthDebug] = useState<{
    uid: string;
    isAnonymous: boolean;
    roles: string[];
    isStaff: boolean;
  } | null>(null);
  const [hasStaffClaim, setHasStaffClaim] = useState(false);
  const [devError, setDevError] = useState<{
    context: string;
    code?: string;
    message?: string;
    path?: string;
  } | null>(null);
  const [devCopyStatus, setDevCopyStatus] = useState("");

  const targetOwnerUid = mode === "staff" ? staffTargetUid : user.uid;
  const kilnOptions: KilnOption[] = useMemo(() => {
    const statusEntries = Object.entries(kilnStatusByName);
    return KILN_OPTIONS.map((option) => {
      const match = option.matchNames.find((name) => {
        const needle = name.toLowerCase();
        return statusEntries.some(([stored]) => {
          const storedLower = stored.toLowerCase();
          return (
            storedLower === needle ||
            storedLower.includes(needle) ||
            needle.includes(storedLower)
          );
        });
      });
      const statusEntry = match
        ? statusEntries.find(([stored]) => {
            const storedLower = stored.toLowerCase();
            const matchLower = match.toLowerCase();
            return (
              storedLower === matchLower ||
              storedLower.includes(matchLower) ||
              matchLower.includes(storedLower)
            );
          })
        : null;
      const status = statusEntry ? statusEntry[1] : null;
      const normalizedStatus =
        typeof status === "string" ? status.toLowerCase().trim() : "";
      const inferredOffline =
        normalizedStatus.includes("offline") ||
        normalizedStatus.includes("down") ||
        normalizedStatus.includes("unavailable");
      const fallbackOffline = option.id === "reduction-raku" && normalizedStatus.length === 0;
      return {
        ...option,
        status,
        isOffline: inferredOffline || fallbackOffline,
      };
    });
  }, [kilnStatusByName]);
  const selectedKiln = kilnOptions.find((option) => option.id === kilnId);
  const derivedHeightInches = hasTallPieces ? 11 : 10;
  const computedTiers = 1;
  const computedHalfShelves = useMemo(() => {
    const safeFootprint = Math.min(8, Math.max(1, footprintHalfShelves));
    return safeFootprint + (hasTallPieces ? 1 : 0);
  }, [footprintHalfShelves, hasTallPieces]);
  const computedCost = useMemo(() => {
    const base = computeEstimatedCost({
      kilnType: selectedKiln?.id ?? null,
      firingType,
      estimatedHalfShelves: computedHalfShelves,
      useVolumePricing,
      volumeIn3,
    });
    if (useVolumePricing) return base;
    return applyHalfKilnPriceBreak({
      estimatedHalfShelves: computedHalfShelves,
      estimatedCost: base,
    }).estimatedCost;
  }, [selectedKiln?.id, firingType, computedHalfShelves, useVolumePricing, volumeIn3]);
  const shelfEquivalent = useMemo(() => {
    if (!Number.isFinite(estimatedHalfShelves)) return 1;
    return Math.max(0.25, (estimatedHalfShelves ?? 1) / 2);
  }, [estimatedHalfShelves]);
  const estimatedHalfShelvesRounded = useMemo(() => {
    if (!Number.isFinite(estimatedHalfShelves)) return 0;
    return Math.round(estimatedHalfShelves as number);
  }, [estimatedHalfShelves]);
  const spaceProgress = useMemo(() => {
    const safe = Math.min(estimatedHalfShelvesRounded, 8);
    return safe / 8;
  }, [estimatedHalfShelvesRounded]);
  const spaceLabel = estimatedHalfShelvesRounded > 8 ? "8+" : String(estimatedHalfShelvesRounded);
  const showFitPrompt = (tiers ?? 1) > 1;
  const firingLabel =
    firingType === "bisque" ? "Bisque" : firingType === "glaze" ? "Glaze" : "Other";
  const kilnLabel = selectedKiln?.label ?? "Select kiln";
  const comparisonLabel = `${formatUsd(HALF_SHELF_BISQUE_PRICE)} bisque / ${formatUsd(
    HALF_SHELF_GLAZE_PRICE
  )} glaze`;
  const volumeCost = useMemo(() => {
    if (!useVolumePricing || !Number.isFinite(volumeIn3)) return null;
    return (volumeIn3 as number) * VOLUME_PRICE_PER_IN3;
  }, [useVolumePricing, volumeIn3]);
  const volumeNudgeThreshold =
    selectedKiln?.id === "reduction-raku"
      ? HALF_SHELF_GLAZE_PRICE
      : firingType === "bisque"
      ? HALF_SHELF_BISQUE_PRICE
      : HALF_SHELF_GLAZE_PRICE;
  const showVolumeNudge = volumeCost != null && volumeCost >= volumeNudgeThreshold;
  const baseHalfShelfPrice =
    selectedKiln?.id === "reduction-raku" || firingType === "glaze"
      ? HALF_SHELF_GLAZE_PRICE
      : HALF_SHELF_BISQUE_PRICE;
  const showVolumeToggle =
    computedCost != null && computedCost < baseHalfShelfPrice && !useVolumePricing;
  const deliveryTrips = (pickupDeliveryRequested ? 1 : 0) + (returnDeliveryRequested ? 1 : 0);
  const deliveryCost = computeDeliveryCost(deliveryTrips);
  const estimatedCostWithDelivery =
    computedCost != null ? computedCost + deliveryCost : computedCost;
  const rushCost = rushRequested ? RUSH_REQUEST_PRICE : 0;
  const waxResistCost = waxResistAssistRequested ? WAX_RESIST_ASSIST_PRICE : 0;
  const glazeSanityCost = glazeSanityCheckRequested ? GLAZE_SANITY_CHECK_PRICE : 0;
  const totalEstimate =
    estimatedCostWithDelivery != null
      ? estimatedCostWithDelivery + (glazeAccessCost ?? 0) + rushCost + waxResistCost + glazeSanityCost
      : estimatedCostWithDelivery;
  const priceBreakApplied = useMemo(() => {
    if (useVolumePricing) return false;
    const base = computeEstimatedCost({
      kilnType: selectedKiln?.id ?? null,
      firingType,
      estimatedHalfShelves: computedHalfShelves,
      useVolumePricing,
      volumeIn3,
    });
    return applyHalfKilnPriceBreak({
      estimatedHalfShelves: computedHalfShelves,
      estimatedCost: base,
    }).priceBreakApplied;
  }, [selectedKiln?.id, firingType, computedHalfShelves, useVolumePricing, volumeIn3]);

  const client = useMemo(
    () =>
      createFunctionsClient({
        baseUrl: resolveFunctionsBaseUrl(),
        getIdToken: () => user.getIdToken(),
        getAdminToken: () => adminToken,
        onLastRequest: setLastReq,
      }),
    [user, adminToken]
  );

  useEffect(() => {
    let cancelled = false;
    user
      .getIdTokenResult()
      .then((result) => {
        if (cancelled) return;
        const claims = (result?.claims ?? {}) as StaffClaims;
        const roles = Array.isArray(claims.roles)
          ? claims.roles.filter((role: unknown) => typeof role === "string")
          : [];
        const isStaffClaim = Boolean(claims.staff) || roles.includes("staff");
        setHasStaffClaim(isStaffClaim);
        if (!DEV_MODE) return;
        setAuthDebug({
          uid: user.uid,
          isAnonymous: user.isAnonymous,
          roles,
          isStaff: isStaffClaim,
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setHasStaffClaim(false);
        if (!DEV_MODE) return;
        setAuthDebug({
          uid: user.uid,
          isAnonymous: user.isAnonymous,
          roles: [],
          isStaff: false,
        });
        setDevError({
          context: "auth",
          code: getErrorCode(error),
          message: getErrorMessage(error) || "Unable to read auth claims.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const captureDevError = (context: string, error: unknown, path?: string) => {
    if (!DEV_MODE) return;
    const detail = {
      context,
      code: getErrorCode(error),
      message: getErrorMessage(error),
      path,
    };
    setDevError(detail);
    console.error("Check-in debug error:", detail);
  };

  useEffect(() => {
    if (!photoFile) {
      setPhotoPreviewUrl(null);
      return undefined;
    }
    const url = URL.createObjectURL(photoFile);
    setPhotoPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photoFile]);

  useEffect(() => {
    setTiers(computedTiers);
  }, [computedTiers]);

  useEffect(() => {
    setEstimatedHalfShelves(computedHalfShelves);
  }, [computedHalfShelves]);

  useEffect(() => {
    if (!useVolumePricing) {
      setVolumeMode("total");
      setVolumeIn3(null);
      setVolumeLengthIn(null);
      setVolumeWidthIn(null);
      setVolumeHeightIn(null);
    }
  }, [useVolumePricing]);

  useEffect(() => {
    if (!useStudioGlazes) {
      setGlazeAccessCost(null);
      return;
    }
    if (!Number.isFinite(estimatedHalfShelvesRounded)) {
      setGlazeAccessCost(null);
      return;
    }
    setGlazeAccessCost(estimatedHalfShelvesRounded * 3);
  }, [useStudioGlazes, estimatedHalfShelvesRounded]);

  useEffect(() => {
    if (!useVolumePricing || volumeMode !== "dimensions") return;
    const length = Number(volumeLengthIn);
    const width = Number(volumeWidthIn);
    const height = Number(volumeHeightIn);
    if (!Number.isFinite(length) || !Number.isFinite(width) || !Number.isFinite(height)) {
      setVolumeIn3(null);
      return;
    }
    if (length <= 0 || width <= 0 || height <= 0) {
      setVolumeIn3(null);
      return;
    }
    const nextVolume = length * width * height;
    if (nextVolume !== volumeIn3) {
      setVolumeIn3(nextVolume);
    }
  }, [useVolumePricing, volumeMode, volumeLengthIn, volumeWidthIn, volumeHeightIn, volumeIn3]);

  useEffect(() => {
    if (totalEstimate == null) return;
    setAnimateEstimate(true);
    const timer = window.setTimeout(() => setAnimateEstimate(false), 320);
    return () => window.clearTimeout(timer);
  }, [totalEstimate]);

  useEffect(() => {
    if (!showFitPrompt) {
      setFitsOnOneLayer(null);
    }
  }, [showFitPrompt]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = sessionStorage.getItem(CHECKIN_PREFILL_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as {
        linkedBatchId?: string;
        firingType?: string;
        pieceCode?: string;
      };
      if (parsed.linkedBatchId) {
        setLinkedBatchId(parsed.linkedBatchId);
      }
      if (parsed.firingType === "bisque" || parsed.firingType === "glaze" || parsed.firingType === "other") {
        setFiringType(parsed.firingType);
      }
      if (parsed.pieceCode) {
        setPrefillNote(`Prefilled from ${parsed.pieceCode}.`);
      }
    } catch {
      setPrefillNote(null);
    } finally {
      sessionStorage.removeItem(CHECKIN_PREFILL_KEY);
    }
  }, []);

  useEffect(() => {
    if (footprintHalfShelves > 4 && !wholeKilnRequested) {
      setWholeKilnRequested(true);
      return;
    }
    if (footprintHalfShelves <= 4 && wholeKilnRequested) {
      setWholeKilnRequested(false);
    }
  }, [footprintHalfShelves, wholeKilnRequested]);

  useEffect(() => {
    if (footprintHalfShelves > 3) {
      setShowMoreFootprints(true);
    }
  }, [footprintHalfShelves]);

  useEffect(() => {
    if (!hasStaffClaim) return;
    const usersQuery = query(collection(db, "users"), orderBy("displayName", "asc"), limit(120));
    getDocs(usersQuery)
      .then((snap) => {
        const rows: StaffUserOption[] = snap.docs.map((docSnap) => {
          const data = docSnap.data() as Partial<StaffUserOption>;
          return {
            id: docSnap.id,
            displayName: data?.displayName || "Member",
            email: data?.email || null,
          };
        });
        setStaffUsers(rows);
      })
      .catch((err) => {
        setStaffUsers([]);
        captureDevError("staff-users", err, "users");
      });
  }, [hasStaffClaim]);

  useEffect(() => {
    const kilnsQuery = query(collection(db, "kilns"), orderBy("name", "asc"), limit(25));
    getDocs(kilnsQuery)
      .then((snap) => {
        const next: Record<string, string> = {};
        snap.docs.forEach((docSnap) => {
          const data = docSnap.data() as { name?: unknown; status?: unknown };
          if (data?.name) {
            next[String(data.name)] = String(data.status || "idle");
          }
        });
        setKilnStatusByName(next);
      })
      .catch((err) => {
        setKilnStatusByName({});
        captureDevError("kilns", err, "kilns");
      });
  }, []);

  useEffect(() => {
    if (!selectedKiln?.isOffline) return;
    setKilnId("");
  }, [selectedKiln]);

  useEffect(() => {
    if (selectedKiln?.id !== "reduction-raku") return;
    if (firingType === "bisque") {
      setFiringType("glaze");
    }
  }, [selectedKiln?.id, firingType]);

  useEffect(() => {
    const ownerUid = targetOwnerUid;
    if (!ownerUid) {
      setReservations([]);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    setListError("");

    const reservationsQuery = query(
      collection(db, "reservations"),
      where("ownerUid", "==", ownerUid),
      orderBy("createdAt", "desc")
    );

    getDocs(reservationsQuery)
      .then((snap) => {
        const rows: ReservationRecord[] = snap.docs.map((docSnap) =>
          normalizeReservationRecord(docSnap.id, docSnap.data() as Partial<ReservationRecord>)
        );
        setReservations(rows);
      })
      .catch((err) => {
        const errObj = err as { message?: unknown; code?: unknown } | null | undefined;
        const message =
          typeof errObj?.message === "string" ? errObj.message : "Unable to load check-ins.";
        const code = typeof errObj?.code === "string" ? errObj.code : "";
        const isPermission =
          code.includes("permission-denied") ||
          String(message).toLowerCase().includes("missing or insufficient permissions");
        if (!isPermission) {
          setListError(`Check-ins failed: ${message}`);
        } else {
          setListError("");
        }
        captureDevError("reservations", err, "reservations");
      })
      .finally(() => setLoading(false));

    return undefined;
  }, [targetOwnerUid]);

  const sortedReservations = useMemo(() => {
    return [...reservations].sort((a, b) => {
      const aTime = a.createdAt?.toDate?.()?.getTime() ?? 0;
      const bTime = b.createdAt?.toDate?.()?.getTime() ?? 0;
      return bTime - aTime;
    });
  }, [reservations]);
  const recentBisqueReservation = useMemo(() => {
    return sortedReservations.find(
      (reservation) => reservation.firingType === "bisque" && reservation.linkedBatchId
    );
  }, [sortedReservations]);

  const debugPacket = useMemo(() => {
    if (!DEV_MODE) return null;
    return {
      auth: authDebug,
      error: devError,
      lastRequest: lastReq
        ? {
          fn: lastReq.fn,
          url: lastReq.url,
          status: lastReq.status,
          ok: lastReq.ok,
          error: lastReq.error,
          payload: sanitizeDebugPayload(lastReq.payload as Record<string, unknown>),
        }
        : null,
      firestorePaths: {
        createReservation: `${resolveFunctionsBaseUrl()}/createReservation (server-side write)`,
        reservationsRead: "reservations where ownerUid == <uid>",
        staffUsersRead: "users (staff only)",
      },
      rulesMapping:
        "Firestore rules: reservations allow read for ownerUid; writes are expected via createReservation.",
    };
  }, [authDebug, devError, lastReq]);

  const handleCopyDebug = async () => {
    if (!debugPacket) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(debugPacket, null, 2));
      setDevCopyStatus("Debug snapshot copied.");
    } catch (error: unknown) {
      setDevCopyStatus(getErrorMessage(error) || "Copy failed.");
    }
  };

  const handleFormHandlerError = (error: unknown) => {
    setFormError(getErrorMessage(error) || "Submission failed.");
    setIsSaving(false);
  };

  const handleCopyDebugError = (error: unknown) => {
    setDevCopyStatus(getErrorMessage(error) || "Copy failed.");
  };

  const toggleNotesTag = (tag: string) => {
    setNotesTags((prev) => (prev.includes(tag) ? prev.filter((item) => item !== tag) : [...prev, tag]));
  };

  const anyAddOnsSelected =
    useStudioGlazes ||
    rushRequested ||
    waxResistAssistRequested ||
    glazeSanityCheckRequested ||
    wholeKilnRequested ||
    pickupDeliveryRequested ||
    returnDeliveryRequested;

  const handlePhotoChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    if (!file) {
      setPhotoFile(null);
      setPhotoStatus("");
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setPhotoStatus("Photo is too large. Please keep it under 8MB.");
      setPhotoFile(null);
      return;
    }
    setPhotoStatus("");
    setPhotoFile(file);
  };

  const uploadPhoto = async (ownerUid: string, requestId: string) => {
    const file = photoFile;
    if (!file) return { url: null, path: null };
    const storage = getStorage();
    if (typeof import.meta !== "undefined" && ENV.VITE_USE_EMULATORS === "true") {
      const host = String(ENV.VITE_STORAGE_EMULATOR_HOST || "127.0.0.1");
      const port = Number(ENV.VITE_STORAGE_EMULATOR_PORT || 9199);
      connectStorageEmulator(storage, host, port);
    }

    const ext = getFileExtension(file);
    const safeFileName = `work-${Date.now()}.${ext}`;
    const path = `checkins/${ownerUid}/${requestId}/${safeFileName}`;
    const photoRef = ref(storage, path);

    setPhotoStatus("Uploading photo…");
    await uploadBytes(photoRef, file, { contentType: file.type || "image/jpeg" });
    const url = await getDownloadURL(photoRef);
    setPhotoStatus("Photo uploaded.");

    return { url, path };
  };

  const resetForm = () => {
    setWareType("stoneware");
    setKilnId("studio-electric");
    setFiringType("bisque");
    setFootprintHalfShelves(1);
    setHasTallPieces(false);
    setTiers(1);
    setEstimatedHalfShelves(1);
    setUseVolumePricing(false);
    setVolumeMode("total");
    setVolumeIn3(null);
    setVolumeLengthIn(null);
    setVolumeWidthIn(null);
    setVolumeHeightIn(null);
    setFitsOnOneLayer(null);
    setPhotoFile(null);
    setPhotoPreviewUrl(null);
    setPhotoStatus("");
    setLatest("");
    setLinkedBatchId("");
    setNotesTags([]);
    setNotesGeneral("");
    setRushRequested(false);
    setWaxResistAssistRequested(false);
    setGlazeSanityCheckRequested(false);
    setWholeKilnRequested(false);
    setPickupDeliveryRequested(false);
    setReturnDeliveryRequested(false);
    setDeliveryAddress("");
    setDeliveryInstructions("");
    setUseStudioGlazes(false);
    setGlazeAccessCost(null);
    setSubmitRequestId(null);
    setPrefillNote(null);
    setDevError(null);
    setDevCopyStatus("");
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSaving) return;
    setFormError("");
    setFormStatus("");
    if (DEV_MODE) {
      setDevError(null);
      setDevCopyStatus("");
    }

    if (mode === "staff" && !staffTargetUid) {
      setFormError("Select a client for this staff check-in.");
      return;
    }

    if (!wareType) {
      setFormError("Choose a clay body for this work.");
      return;
    }

    if (!kilnId) {
      setFormError("Pick which kiln the work should go in.");
      return;
    }

    if (selectedKiln?.isOffline) {
      setFormError("That kiln is temporarily unavailable right now.");
      return;
    }

    if (!Number.isFinite(footprintHalfShelves) || footprintHalfShelves < 1) {
      setFormError("Tell us roughly how much table space you need.");
      return;
    }

    if (useVolumePricing && (!volumeIn3 || volumeIn3 <= 0)) {
      setFormError("Add a volume estimate so we can guide tiny-run pricing.");
      return;
    }

    if (pickupDeliveryRequested || returnDeliveryRequested) {
      if (!deliveryAddress.trim()) {
        setFormError("Add the delivery address so we can schedule pickup/return.");
        return;
      }
      if (!deliveryInstructions.trim()) {
        setFormError("Add gate codes or delivery instructions so we can find you.");
        return;
      }
    }

    const latestDate = sanitizeDateInput(latest);

    const requestId = submitRequestId ?? makeClientRequestId();
    if (!submitRequestId) {
      setSubmitRequestId(requestId);
    }
    track("batch_create_test_clicked", {
      uid: shortId(user.uid),
      batchId: shortId(linkedBatchId || requestId),
      mode,
      firingType,
      kilnId,
    });

    setIsSaving(true);
    try {
      const ownerUid = targetOwnerUid;
      const photoResult = ownerUid ? await uploadPhoto(ownerUid, requestId) : { url: null, path: null };

      const safeEstimatedHalfShelves = Number.isFinite(estimatedHalfShelves)
        ? Math.round(estimatedHalfShelves as number)
        : null;
      const safeEstimatedCost = Number.isFinite(totalEstimate)
        ? (totalEstimate as number)
        : null;
      const payload = {
        firingType,
        shelfEquivalent,
        footprintHalfShelves: Number.isFinite(footprintHalfShelves) ? footprintHalfShelves : null,
        heightInches: hasTallPieces ? derivedHeightInches : null,
        tiers: Number.isFinite(tiers) ? tiers : null,
        estimatedHalfShelves: safeEstimatedHalfShelves,
        useVolumePricing,
        volumeIn3: Number.isFinite(volumeIn3) ? volumeIn3 : null,
        estimatedCost: safeEstimatedCost,
        preferredWindow: {
          latestDate: latestDate ? latestDate.toISOString() : null,
        },
        linkedBatchId: linkedBatchId.trim() || null,
        clientRequestId: requestId,
        ownerUid: mode === "staff" ? staffTargetUid || null : null,
        wareType,
        kilnId,
        kilnLabel: selectedKiln?.label || null,
        photoUrl: photoResult.url,
        photoPath: photoResult.path,
        notes: {
          general: [notesGeneral.trim(), notesTags.join(", ")].filter(Boolean).join(" · ") || null,
          clayBody: null,
          glazeNotes: null,
        },
        addOns: {
          rushRequested,
          waxResistAssistRequested,
          glazeSanityCheckRequested,
          wholeKilnRequested,
          pickupDeliveryRequested,
          returnDeliveryRequested,
          useStudioGlazes,
          glazeAccessCost: useStudioGlazes ? glazeAccessCost : null,
          deliveryAddress: deliveryAddress.trim() || null,
          deliveryInstructions: deliveryInstructions.trim() || null,
        },
      };

      await client.postJson("createReservation", payload);
      track("batch_create_test_success", {
        uid: shortId(user.uid),
        batchId: shortId(linkedBatchId || requestId),
        mode,
        firingType,
        kilnId,
      });
      setFormStatus(mode === "staff" ? "Staff check-in saved." : "Check-in sent.");
      resetForm();
    } catch (error: unknown) {
      const recentReq = client.getLastRequest();
      captureDevError("submit", error, recentReq?.url || "functions/createReservation");
      track("batch_create_test_error", {
        uid: shortId(user.uid),
        batchId: shortId(linkedBatchId || requestId),
        mode,
        firingType,
        kilnId,
        message: getErrorMessage(error).slice(0, 160),
      });
      setFormError(getErrorMessage(error) || "Submission failed.");
    } finally {
      setIsSaving(false);
    }
  };

  const showStaffTools = isStaff;

  return (
    <div className="page reservations-page">
      <div className="page-header">
        <div>
          <h1>Ware Check-in</h1>
          <p className="page-subtitle">
            Think of it like an airport: pre-check here to breeze through the gate-check, or let
            an agent help you check in. Both are equally good ways to use the studio kiln rentals.
          </p>
        </div>
      </div>

      {showStaffTools ? (
        <RevealCard
          as="section"
          className="card card-3d staff-checkin-card"
          index={0}
          enabled={motionEnabled}
        >
          <div className="card-title">Staff check-in tool</div>
          <p className="form-helper">
            Use this when a client is not on the portal. Select a client, then complete the same
            check-in flow on their behalf.
          </p>
          <div className="segmented staff-mode-toggle">
            <button
              type="button"
              className={mode === "client" ? "active" : ""}
              onClick={() => setMode("client")}
            >
              Client self-check-in
            </button>
            <button
              type="button"
              className={mode === "staff" ? "active" : ""}
              onClick={() => setMode("staff")}
            >
              Staff check-in
            </button>
          </div>
          {mode === "staff" ? (
            <div className="staff-client-grid">
              <label>
                Client
                <select value={staffTargetUid} onChange={(event) => setStaffTargetUid(event.target.value)}>
                  <option value="">Select a client</option>
                  {staffUsers.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.displayName}
                      {member.email ? ` · ${member.email}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <p className="form-helper staff-client-note">
                Staff submissions do not charge automatically. Pricing is handled offline.
              </p>
            </div>
          ) : null}
          {mode === "staff" && !hasStaffClaim ? (
            <div className="notice inline-alert">
              Staff client lists require a staff auth claim. Dev admin tokens only apply to
              Cloud Functions.
            </div>
          ) : null}
        </RevealCard>
      ) : null}

      {recentBisqueReservation ? (
        <RevealCard
          as="section"
          className="card card-3d recent-checkin-card"
          index={1}
          enabled={motionEnabled}
        >
          <div className="card-title">Recently bisqued? Send it to glaze</div>
          <p className="form-helper">
            We found a recent bisque check-in. Reuse it as a glaze submission with one tap.
          </p>
          <div className="recent-checkin-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setLinkedBatchId(recentBisqueReservation.linkedBatchId ?? "");
                setFiringType("glaze");
                if (recentBisqueReservation.kilnId) {
                  setKilnId(recentBisqueReservation.kilnId);
                }
                setPrefillNote(`Loaded from ${recentBisqueReservation.linkedBatchId}.`);
              }}
            >
              Re-submit this bisque to glaze
            </button>
          </div>
        </RevealCard>
      ) : null}

      <RevealCard as="section" className="card card-3d reservation-form" index={2} enabled={motionEnabled}>
        <div className="card-title">
          {mode === "staff" ? "Staff check-in workflow" : "Self check-in workflow"}
        </div>
        <p className="form-helper">
          {mode === "staff"
            ? "Capture the essentials so the studio can load the next firing smoothly."
            : "Tell us what you’re dropping off, snap a quick photo, and pick your kiln path."}
        </p>

        {mode === "staff" && !staffTargetUid ? (
          <div className="notice inline-alert">Select a client above to unlock the form.</div>
        ) : (
          <form
            onSubmit={toVoidHandler(handleSubmit, handleFormHandlerError, "reservations.submit")}
            className="checkin-form"
          >
            <div className="checkin-step">
              <div className="checkin-step-title">1. Choose the clay body</div>
              <div className="option-grid">
                {WARE_TYPES.map((option) => (
                  <button
                    type="button"
                    key={option.id}
                    className={`option-card ${wareType === option.id ? "selected" : ""}`}
                    onClick={() => setWareType(option.id)}
                    aria-pressed={wareType === option.id}
                  >
                    <span className={`option-icon option-icon-${option.id}`} aria-hidden="true" />
                    <span className="option-title">{option.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="checkin-step">
              <div className="checkin-step-title">2. Snap a photo of the work (optional)</div>
              <div className="photo-upload">
                <label className="photo-frame">
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handlePhotoChange}
                  />
                  {photoPreviewUrl ? (
                    <img src={photoPreviewUrl} alt="Work preview" />
                  ) : (
                    <div className="photo-placeholder">
                      Tap to open your camera.
                      <span>Optional — photos stay with the piece for reference.</span>
                    </div>
                  )}
                </label>
                {photoStatus ? <div className="photo-status">{photoStatus}</div> : null}
              </div>
            </div>

            <div className="checkin-step">
              <div className="checkin-step-title">3. Pick the kiln + firing</div>
              <div className="option-grid">
                {kilnOptions.map((option) => (
                  <button
                    type="button"
                    key={option.id}
                    className={`option-card ${option.isOffline ? "offline" : ""} ${
                      kilnId === option.id ? "selected" : ""
                    }`}
                    onClick={() => setKilnId(option.id)}
                    disabled={option.isOffline}
                    aria-pressed={kilnId === option.id}
                  >
                    {option.isOffline ? (
                      <span className="option-sticker">Temporarily unavailable</span>
                    ) : null}
                    <span className="option-icon option-icon-kiln" aria-hidden="true" />
                    <span className="option-title">{option.label}</span>
                    <span className="option-meta">{option.detail}</span>
                  </button>
                ))}
              </div>
              <div className="option-grid firing-grid">
                {FIRING_OPTIONS.filter((option) => {
                  if (selectedKiln?.id === "reduction-raku") {
                    return option.id !== "bisque";
                  }
                  return true;
                }).map((option) => (
                  <button
                    type="button"
                    key={option.id}
                    className={`option-card compact ${firingType === option.id ? "selected" : ""}`}
                    onClick={() => setFiringType(option.id)}
                    aria-pressed={firingType === option.id}
                  >
                    <span className="option-title">{option.label}</span>
                  </button>
                ))}
              </div>
              {selectedKiln?.id === "reduction-raku" ? (
                <div className="notice inline-alert">
                  Raku is always glaze pricing. We&apos;ll confirm space together.
                </div>
              ) : null}
            </div>

            <div className="checkin-step estimator-step">
              <div className="checkin-step-title">4. Space + cost estimate</div>
              <div className="estimator-grid">
                <div className="estimator-controls">
                <div className="estimator-block">
                  <div className="estimator-label">How much table space?</div>
                  <div
                    className={`segmented-grid footprint-grid ${
                      fitsOnOneLayer === "no" ? "needs-attention" : ""
                    }`}
                  >
                    {[1, 2, 3].map((count) => (
                      <button
                        type="button"
                        key={`footprint-${count}`}
                        className={`segmented-button ${
                          footprintHalfShelves === count ? "selected" : ""
                        }`}
                        onClick={() => setFootprintHalfShelves(count)}
                        aria-pressed={footprintHalfShelves === count}
                      >
                        <span className="segmented-main">{count}</span>
                      </button>
                    ))}
                    <button
                      type="button"
                      className={`segmented-button ${showMoreFootprints ? "selected" : ""}`}
                      onClick={() => setShowMoreFootprints((prev) => !prev)}
                      aria-label="Show more shelf options"
                      aria-pressed={showMoreFootprints}
                    >
                      <span className="segmented-main">More</span>
                    </button>
                    {showMoreFootprints
                      ? Array.from({ length: 5 }, (_, index) => index + 4).map((count) => (
                          <button
                            type="button"
                            key={`footprint-${count}`}
                            className={`segmented-button ${
                              footprintHalfShelves === count ? "selected" : ""
                            }`}
                            onClick={() => {
                              setFootprintHalfShelves(count);
                              setShowMoreFootprints(true);
                            }}
                            aria-pressed={footprintHalfShelves === count}
                          >
                            <span className="segmented-main">{count}</span>
                            {count === 4 ? (
                              <span className="segmented-sub">Whole kiln option</span>
                            ) : null}
                          </button>
                        ))
                      : null}
                  </div>
                  <p className="form-helper">
                    About one carry-on suitcase laid flat.
                  </p>
                </div>

                  {showFitPrompt ? (
                    <div className="estimator-block">
                      <div className="estimator-label">
                        Do these pieces still fit side-by-side on one layer?
                      </div>
                      <div className="segmented-grid yesno-grid">
                        <button
                          type="button"
                          className={`segmented-button ${fitsOnOneLayer === "yes" ? "selected" : ""}`}
                          onClick={() => setFitsOnOneLayer("yes")}
                          aria-pressed={fitsOnOneLayer === "yes"}
                        >
                          Yes
                        </button>
                        <button
                          type="button"
                          className={`segmented-button ${fitsOnOneLayer === "no" ? "selected" : ""}`}
                          onClick={() => setFitsOnOneLayer("no")}
                          aria-pressed={fitsOnOneLayer === "no"}
                        >
                          No
                        </button>
                      </div>
                      {fitsOnOneLayer === "no" ? (
                        <div className="notice inline-alert">
                          If things feel tight, bump up the footprint. We&apos;ll adjust together.
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {showVolumeToggle || useVolumePricing ? (
                    <div className="estimator-block">
                      <button
                        type="button"
                        className={`tiny-toggle ${useVolumePricing ? "active" : ""}`}
                        onClick={() => setUseVolumePricing((prev) => !prev)}
                        aria-expanded={useVolumePricing}
                        aria-pressed={useVolumePricing}
                      >
                        Tiny run? Price by volume instead
                      </button>
                      {useVolumePricing ? (
                      <div className="tiny-run-panel">
                        <div className="segmented volume-mode-toggle">
                          <button
                            type="button"
                            className={volumeMode === "total" ? "active" : ""}
                            onClick={() => setVolumeMode("total")}
                          >
                            Total volume
                          </button>
                          <button
                            type="button"
                            className={volumeMode === "dimensions" ? "active" : ""}
                            onClick={() => setVolumeMode("dimensions")}
                          >
                            L × W × H
                          </button>
                        </div>
                        {volumeMode === "total" ? (
                          <label>
                            Total volume (in^3)
                            <input
                              type="number"
                              min="1"
                              step="1"
                              value={volumeIn3 ?? ""}
                              onChange={(event) =>
                                setVolumeIn3(event.target.value ? Number(event.target.value) : null)
                              }
                            />
                          </label>
                        ) : (
                          <div className="volume-dimensions">
                            <label>
                              Length (in)
                              <input
                                type="number"
                                min="1"
                                step="0.5"
                                value={volumeLengthIn ?? ""}
                                onChange={(event) =>
                                  setVolumeLengthIn(
                                    event.target.value ? Number(event.target.value) : null
                                  )
                                }
                              />
                            </label>
                            <label>
                              Width (in)
                              <input
                                type="number"
                                min="1"
                                step="0.5"
                                value={volumeWidthIn ?? ""}
                                onChange={(event) =>
                                  setVolumeWidthIn(
                                    event.target.value ? Number(event.target.value) : null
                                  )
                                }
                              />
                            </label>
                            <label>
                              Height (in)
                              <input
                                type="number"
                                min="1"
                                step="0.5"
                                value={volumeHeightIn ?? ""}
                                onChange={(event) =>
                                  setVolumeHeightIn(
                                    event.target.value ? Number(event.target.value) : null
                                  )
                                }
                              />
                            </label>
                          </div>
                        )}
                        <p className="form-helper">
                          Best for 1–3 small pieces. We&apos;ll help you decide in person.
                        </p>
                        <div className="tiny-run-compare">
                          Half-shelf would be {comparisonLabel}.
                        </div>
                        {volumeCost != null ? (
                          <div className="tiny-run-cost">
                            Volume estimate: {formatUsd(volumeCost)}
                          </div>
                        ) : null}
                        {showVolumeNudge ? (
                          <div className="notice inline-alert">
                            At this size, a half-shelf is usually simpler.
                          </div>
                        ) : null}
                      </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                <div className="estimator-side">
                  <div className="estimator-block estimate-height">
                    <div className="estimator-label">Anything taller than 10 inches?</div>
                    <div className="segmented-grid yesno-grid">
                      <button
                        type="button"
                        className={`segmented-button ${hasTallPieces ? "selected" : ""}`}
                        onClick={() => setHasTallPieces(true)}
                        aria-pressed={hasTallPieces}
                      >
                        Yes, it&apos;s tall
                      </button>
                      <button
                        type="button"
                        className={`segmented-button ${!hasTallPieces ? "selected" : ""}`}
                        onClick={() => setHasTallPieces(false)}
                        aria-pressed={!hasTallPieces}
                      >
                        No, standard height
                      </button>
                    </div>
                    {hasTallPieces ? (
                      <div className="form-helper">Tall pieces usually count as 2–3 half-shelves.</div>
                    ) : null}
                    <div className="form-helper">
                      Not sure? Choose standard height. We&apos;ll measure it with you.
                    </div>
                  </div>

                  <aside className={`estimate-summary ${animateEstimate ? "animate" : ""}`}>
                  <details className="shelf-guide">
                    <summary>How to count half shelves</summary>
                    <div className="shelf-guide-grid" aria-hidden="true">
                      {Array.from({ length: 8 }, (_, index) => {
                        const active = index < Math.min(estimatedHalfShelvesRounded, 8);
                        return (
                          <span
                            key={`guide-${index}`}
                            className={`shelf-guide-cell ${active ? "active" : ""}`}
                          />
                        );
                      })}
                    </div>
                    <div className="shelf-guide-caption">
                      Each box is a half-shelf. 1–2 for small drops, 4 for a half kiln (price break),
                      8 for a full load. Tall pieces add one extra half shelf.
                    </div>
                  </details>
                  <div className="estimate-summary-header">
                    <div className="estimate-label">Estimate summary</div>
                    <span className="estimate-chip soft">Reviewed with you in person</span>
                    {wholeKilnRequested ? (
                      <span className="estimate-chip">
                        Whole kiln: {formatUsd(FULL_KILN_CUSTOM_PRICE)}
                      </span>
                    ) : null}
                    {priceBreakApplied ? (
                      <span className="estimate-chip">Whole kiln option</span>
                    ) : null}
                    {selectedKiln?.id === "reduction-raku" ? (
                      <span className="estimate-chip">Raku is always glaze pricing</span>
                    ) : null}
                  </div>
                  <div className="estimate-primary">
                    <span>
                      {useStudioGlazes ||
                      rushRequested ||
                      waxResistAssistRequested ||
                      glazeSanityCheckRequested
                        ? "Total estimate"
                        : "Estimated cost"}
                    </span>
                    <strong className={animateEstimate ? "estimate-amount animate" : "estimate-amount"}>
                      {totalEstimate != null ? formatUsd(totalEstimate) : "We’ll confirm pricing"}
                    </strong>
                    {animateEstimate ? <span className="estimate-updated">updated</span> : null}
                  </div>
                  <div className="estimate-reassure">
                    You only pay for what survives the firing. We confirm everything in person. You won’t be overcharged.
                  </div>
                  {estimatedCostWithDelivery != null &&
                  (useStudioGlazes ||
                    rushRequested ||
                    waxResistAssistRequested ||
                    glazeSanityCheckRequested) ? (
                    <div className="estimate-breakdown">
                      <div className="estimate-line">
                        <span>Firing estimate</span>
                        <span>{formatUsd(estimatedCostWithDelivery)}</span>
                      </div>
                      {useStudioGlazes && glazeAccessCost != null ? (
                        <div className="estimate-line">
                          <span>Studio glaze access</span>
                          <span>{formatUsd(glazeAccessCost)}</span>
                        </div>
                      ) : null}
                      {rushRequested ? (
                        <div className="estimate-line">
                          <span>Priority queue</span>
                          <span>{formatUsd(RUSH_REQUEST_PRICE)}</span>
                        </div>
                      ) : null}
                      {waxResistAssistRequested ? (
                        <div className="estimate-line">
                          <span>Wax resist assist</span>
                          <span>{formatUsd(WAX_RESIST_ASSIST_PRICE)}</span>
                        </div>
                      ) : null}
                      {glazeSanityCheckRequested ? (
                        <div className="estimate-line">
                          <span>Glaze sanity check</span>
                          <span>{formatUsd(GLAZE_SANITY_CHECK_PRICE)}</span>
                        </div>
                      ) : null}
                      <div className="estimate-line total">
                        <span>Total estimate</span>
                        <span>{formatUsd(totalEstimate ?? 0)}</span>
                      </div>
                    </div>
                  ) : null}
                  <div className="estimate-meta">
                    Based on: {kilnLabel} · {firingLabel} ·{" "}
                    {formatHalfShelfCount(estimatedHalfShelvesRounded)}
                  </div>
                  <div className="estimate-hint">Most people start here.</div>
                  {selectedKiln?.id === "reduction-raku" ? (
                    <div className="estimate-meta">
                      Raku is always glaze pricing. We&apos;ll confirm space together.
                    </div>
                  ) : null}
                  {deliveryTrips > 0 ? (
                    <div className="estimate-meta">
                      Delivery: {deliveryTrips} trip{deliveryTrips === 1 ? "" : "s"} ·{" "}
                      {formatUsd(deliveryCost)}
                    </div>
                  ) : null}
                  <div className="space-meter">
                    <div
                      className="space-meter-track"
                      role="progressbar"
                      aria-valuenow={Math.min(estimatedHalfShelvesRounded, 8)}
                      aria-valuemin={0}
                      aria-valuemax={8}
                      aria-label="Estimated kiln space used"
                    >
                      <div
                        className="space-meter-fill"
                        style={{ width: `${spaceProgress * 100}%` }}
                      />
                    </div>
                    <div className="space-meter-label">
                      Space used: {spaceLabel} / 8 half shelves
                    </div>
                  </div>
                  {priceBreakApplied ? (
                    <div className="estimate-note">Price break starts at 4 half shelves.</div>
                  ) : null}
                  <div className="estimate-disclaimer">
                    Estimate only. Final charge after check-in review + measurement.
                  </div>
                  </aside>
                </div>
              </div>
            </div>

            <div className="checkin-step">
              <div className="checkin-step-title">5. Helpful extras (optional)</div>
              <div className="addon-section">
                <div className="addon-subtitle">Studio glaze access</div>
                <div className="addon-grid">
                  <label className="addon-toggle">
                    <input
                      type="checkbox"
                      checked={useStudioGlazes}
                      onChange={(event) => setUseStudioGlazes(event.target.checked)}
                    />
                    <span className="addon-text">
                      <span className="addon-title">Use Studio Glazes + Kitchen Access</span>
                    </span>
                    <span className="addon-tag">$3 per half-shelf</span>
                  </label>
                </div>
                <div className="addon-helper">
                  Includes house glazes, tools, wax, sinks, and a quick walkthrough with staff.
                </div>
                <div className="addon-helper">Finish your pieces here and we&apos;ll help you get set up.</div>
                <a className="addon-link" href="/glazes">
                  See available glazes
                </a>
                {useStudioGlazes && totalEstimate != null ? (
                  <div className="addon-total">New estimate: {formatUsd(totalEstimate)}</div>
                ) : null}
              </div>
              <div className="addon-section">
                <div className="addon-subtitle">Firing boosts</div>
                <div className="addon-grid">
                  <label className="addon-toggle">
                    <input
                      type="checkbox"
                      checked={rushRequested}
                      onChange={(event) => setRushRequested(event.target.checked)}
                    />
                    <span className="addon-text">
                      <span className="addon-title">Priority queue (next available firing)</span>
                      <span className="addon-copy">Jump to the next opening without a custom schedule.</span>
                    </span>
                    <span className="addon-tag">{formatUsd(RUSH_REQUEST_PRICE)}</span>
                  </label>
                  <label className="addon-toggle">
                    <input
                      type="checkbox"
                      checked={waxResistAssistRequested}
                      onChange={(event) => setWaxResistAssistRequested(event.target.checked)}
                    />
                    <span className="addon-text">
                      <span className="addon-title">Wax resist assist</span>
                      <span className="addon-copy">We&apos;ll help you prep clean bottoms.</span>
                    </span>
                    <span className="addon-tag">{formatUsd(WAX_RESIST_ASSIST_PRICE)}</span>
                  </label>
                  <label className="addon-toggle">
                    <input
                      type="checkbox"
                      checked={glazeSanityCheckRequested}
                      onChange={(event) => setGlazeSanityCheckRequested(event.target.checked)}
                    />
                    <span className="addon-text">
                      <span className="addon-title">Glaze sanity check</span>
                      <span className="addon-copy">Reduce surprises before the kiln goes hot.</span>
                    </span>
                    <span className="addon-tag">{formatUsd(GLAZE_SANITY_CHECK_PRICE)}</span>
                  </label>
                  {estimatedHalfShelvesRounded < 4 ? (
                    <label className="addon-toggle">
                      <input
                        type="checkbox"
                        checked={wholeKilnRequested}
                        onChange={(event) => setWholeKilnRequested(event.target.checked)}
                      />
                      <span className="addon-text">
                        <span className="addon-title">Whole kiln request</span>
                      </span>
                      <span className="addon-tag">{formatUsd(FULL_KILN_CUSTOM_PRICE)}</span>
                    </label>
                  ) : null}
                  <label className="addon-toggle">
                    <input
                      type="checkbox"
                      checked={pickupDeliveryRequested}
                      onChange={(event) => setPickupDeliveryRequested(event.target.checked)}
                    />
                    <span className="addon-text">
                      <span className="addon-title">Pickup run: we collect your drop-off for firing</span>
                    </span>
                    <span className="addon-tag">{formatUsd(DELIVERY_PRICE_PER_TRIP)}</span>
                  </label>
                  <label className="addon-toggle">
                    <input
                      type="checkbox"
                      checked={returnDeliveryRequested}
                      onChange={(event) => setReturnDeliveryRequested(event.target.checked)}
                    />
                    <span className="addon-text">
                      <span className="addon-title">Return run: we bring finished work back to you</span>
                    </span>
                    <span className="addon-tag">{formatUsd(DELIVERY_PRICE_PER_TRIP)}</span>
                  </label>
                </div>
                {pickupDeliveryRequested || returnDeliveryRequested ? (
                  <div className="addon-fields">
                    <label>
                      Delivery address
                      <textarea
                        value={deliveryAddress}
                        onChange={(event) => setDeliveryAddress(event.target.value)}
                        placeholder="Street, city, and any delivery notes"
                      />
                    </label>
                    <label>
                      Gate code / instructions
                      <input
                        type="text"
                        value={deliveryInstructions}
                        onChange={(event) => setDeliveryInstructions(event.target.value)}
                        placeholder="Gate code, parking, call box, etc."
                      />
                    </label>
                  </div>
                ) : null}
                {(rushRequested ||
                  waxResistAssistRequested ||
                  glazeSanityCheckRequested ||
                  wholeKilnRequested ||
                  pickupDeliveryRequested ||
                  returnDeliveryRequested) &&
                totalEstimate != null ? (
                  <div className="addon-total">New estimate: {formatUsd(totalEstimate)}</div>
                ) : null}
              </div>
              <div className="addon-helper">Add only what you need. We&apos;ll confirm together.</div>
              {anyAddOnsSelected && totalEstimate != null ? (
                <div className="addon-total">New estimate: {formatUsd(totalEstimate)}</div>
              ) : null}
            </div>

            <div className="checkin-step">
              <div className="checkin-step-title">6. Notes (optional)</div>
              <div className="notes-grid">
                <label>
                  General notes
                  <textarea
                    value={notesGeneral}
                    onChange={(event) => setNotesGeneral(event.target.value)}
                    placeholder="Anything we should watch for?"
                  />
                </label>
                <label>
                  Preferred date
                  <input
                    type="datetime-local"
                    value={latest}
                    onChange={(event) => setLatest(event.target.value)}
                  />
                </label>
              </div>
              <details className="notes-details">
                <summary>More details (optional)</summary>
                <div className="notes-tags">
                  {CHECKIN_NOTE_TAGS.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      className={`note-tag ${notesTags.includes(tag) ? "selected" : ""}`}
                      onClick={() => toggleNotesTag(tag)}
                      aria-pressed={notesTags.includes(tag)}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
                <div className="form-helper">Pick any tags that apply. We&apos;ll confirm at drop-off.</div>
                <div className="notes-grid">
                  <label>
                    Link a piece or collection (optional)
                    <input
                      type="text"
                      placeholder="Paste piece code or collection ID"
                      value={linkedBatchId}
                      onChange={(event) => setLinkedBatchId(event.target.value)}
                    />
                  </label>
                </div>
              </details>
              {prefillNote ? <div className="notice inline-alert">{prefillNote}</div> : null}
              <p className="form-helper">
                Add anything that helps the studio load and fire safely.
              </p>
            </div>

            {formError ? <div className="alert card card-3d form-error">{formError}</div> : null}
            {formStatus ? <div className="notice card card-3d form-status">{formStatus}</div> : null}

            <div className="submit-note">We&apos;ll confirm space + pricing together at drop-off.</div>
            <button type="submit" className="btn btn-primary checkin-submit-btn" disabled={isSaving}>
              {isSaving ? (
                "Submitting..."
              ) : (
                <>
                  <span className="checkin-submit-title">Submit check-in</span>
                  <span className="checkin-submit-sub">Billing starts after your firing is complete</span>
                </>
              )}
            </button>
          </form>
        )}
      </RevealCard>

      <RevealCard as="section" className="card card-3d reservation-list" index={3} enabled={motionEnabled}>
        <div className="card-title">Your check-ins</div>
        {listError ? <div className="alert">{listError}</div> : null}
        {loading ? (
          <div className="empty-state">Loading check-ins...</div>
        ) : sortedReservations.length === 0 ? (
          <div className="empty-state">No check-ins yet.</div>
        ) : (
          <div className="reservation-grid">
            {sortedReservations.map((reservation) => (
              <article className="reservation-card" key={reservation.id}>
                <header className="reservation-card-header">
                  <h3>{reservation.firingType}</h3>
                  <span className={`status-pill status-${reservation.status.toLowerCase()}`}>
                    {reservation.status}
                  </span>
                </header>
                <div className="reservation-row">
                  <span>Clay: {reservation.wareType || "—"}</span>
                  <span>Kiln: {reservation.kilnLabel || "—"}</span>
                </div>
                <div className="reservation-row">
                  <span>
                    Space:{" "}
                    {reservation.estimatedHalfShelves != null
                      ? formatHalfShelfCount(reservation.estimatedHalfShelves)
                      : `${reservation.shelfEquivalent} shelf`}
                  </span>
                  <span>Created: {formatDateTime(reservation.createdAt)}</span>
                </div>
                <div className="reservation-row">
                  <span>
                    {reservation.useVolumePricing && reservation.volumeIn3
                      ? `Volume: ${reservation.volumeIn3} in^3`
                      : `Footprint: ${reservation.footprintHalfShelves ?? "—"} half shelf`}
                  </span>
                  <span>
                    {reservation.estimatedCost != null ? `Est. ${formatUsd(reservation.estimatedCost)}` : " "}
                  </span>
                </div>
                <div className="reservation-row">
                  <span>Window: {formatPreferredWindow(reservation)}</span>
                  <span>
                    Updated: {formatDateTime(reservation.updatedAt)}
                    {reservation.linkedBatchId ? ` · Ref ${reservation.linkedBatchId}` : ""}
                  </span>
                </div>
                {reservation.photoUrl ? (
                  <div className="reservation-photo">
                    <img src={reservation.photoUrl} alt="Checked-in work" />
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </RevealCard>

      {DEV_MODE ? (
        <details className="card card-3d debug-panel">
          <summary className="debug-summary">Check-in debug (dev only)</summary>
          <div className="debug-grid">
            <div className="debug-label">Auth uid</div>
            <div>{authDebug?.uid || user.uid}</div>

            <div className="debug-label">Role</div>
            <div>{authDebug?.isStaff ? "staff" : "client"}</div>

            <div className="debug-label">Target path</div>
            <div>{debugPacket?.firestorePaths?.createReservation}</div>

            <div className="debug-label">Rules map</div>
            <div>{debugPacket?.rulesMapping}</div>

            <div className="debug-label">Payload</div>
            <pre className="debug-pre">
              {JSON.stringify(debugPacket?.lastRequest?.payload ?? {}, null, 2)}
            </pre>

            <div className="debug-label">Error</div>
            <div>
              {devError
                ? `${devError.context} · ${devError.code || "unknown"} · ${devError.message || ""}`
                : "—"}
            </div>
          </div>

          <div className="debug-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={toVoidHandler(handleCopyDebug, handleCopyDebugError, "reservations.copyDebug")}
            >
              Copy debug snapshot
            </button>
            {devCopyStatus ? <span className="form-helper">{devCopyStatus}</span> : null}
          </div>
        </details>
      ) : null}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { createPortalApi } from "../api/portalApi";
import { unwrapPortalData } from "../api/unwrapPortalData";
import {
  normalizeStudioCalendarEntry,
  normalizeStudioReservation,
  normalizeStudioSpace,
  type StudioCalendarEntryRecord,
  type StudioReservationRecord,
  type StudioSpaceRecord,
} from "../lib/studioReservations";

const SPACE_ID_KEY_SEPARATOR = "\u001f";

type Args = {
  user: User;
  adminToken?: string;
  rangeStartIso: string;
  rangeEndIso: string;
  spaceIds?: string[];
};

type StudioReservationsDataState = {
  spaces: StudioSpaceRecord[];
  entries: StudioCalendarEntryRecord[];
  reservations: StudioReservationRecord[];
  myReservations: StudioReservationRecord[];
  timezone: string;
  generatedDefaults: boolean;
  loading: boolean;
  error: string;
  reload: () => Promise<void>;
};

export function useStudioReservationsData({
  user,
  adminToken,
  rangeStartIso,
  rangeEndIso,
  spaceIds = [],
}: Args): StudioReservationsDataState {
  const [spaces, setSpaces] = useState<StudioSpaceRecord[]>([]);
  const [entries, setEntries] = useState<StudioCalendarEntryRecord[]>([]);
  const [reservations, setReservations] = useState<StudioReservationRecord[]>([]);
  const [myReservations, setMyReservations] = useState<StudioReservationRecord[]>([]);
  const [timezone, setTimezone] = useState("America/Phoenix");
  const [generatedDefaults, setGeneratedDefaults] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const api = useMemo(() => createPortalApi(), []);
  const normalizedSpaceIdsKey = spaceIds.map((value) => value.trim()).filter(Boolean).join(SPACE_ID_KEY_SEPARATOR);
  const normalizedSpaceIds = useMemo(
    () => (normalizedSpaceIdsKey ? normalizedSpaceIdsKey.split(SPACE_ID_KEY_SEPARATOR) : []),
    [normalizedSpaceIdsKey]
  );

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const idToken = await user.getIdToken();
      const [calendarResp, mineResp] = await Promise.all([
        api.listStudioReservationCalendar({
          idToken,
          adminToken,
          payload: {
            startAt: rangeStartIso,
            endAt: rangeEndIso,
            spaceIds: normalizedSpaceIds,
            includeMine: true,
          },
        }),
        api.listMyStudioReservations({
          idToken,
          adminToken,
          payload: {
            includeCancelled: false,
            limit: 200,
          },
        }),
      ]);
      const calendarData = unwrapPortalData(calendarResp.data);
      const myData = unwrapPortalData(mineResp.data);
      setSpaces(
        Array.isArray(calendarData?.spaces)
          ? calendarData.spaces.map((space) => normalizeStudioSpace(space))
          : []
      );
      setEntries(
        Array.isArray(calendarData?.entries)
          ? calendarData.entries.map((entry) => normalizeStudioCalendarEntry(entry))
          : []
      );
      setReservations(
        Array.isArray(calendarData?.reservations)
          ? calendarData.reservations.map((row) => normalizeStudioReservation(row))
          : []
      );
      setMyReservations(
        Array.isArray(myData?.reservations)
          ? myData.reservations.map((row) => normalizeStudioReservation(row))
          : []
      );
      setTimezone(typeof calendarData?.timezone === "string" ? calendarData.timezone : "America/Phoenix");
      setGeneratedDefaults(calendarData?.generatedDefaults === true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setSpaces([]);
      setEntries([]);
      setReservations([]);
      setMyReservations([]);
      setGeneratedDefaults(false);
    } finally {
      setLoading(false);
    }
  }, [adminToken, api, normalizedSpaceIds, rangeEndIso, rangeStartIso, user]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    spaces,
    entries,
    reservations,
    myReservations,
    timezone,
    generatedDefaults,
    loading,
    error,
    reload,
  };
}

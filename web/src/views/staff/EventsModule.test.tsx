/** @vitest-environment jsdom */

import type { ComponentProps, Dispatch, SetStateAction } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import EventsModule from "./EventsModule";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function makeSetter<T>() {
  return vi.fn() as unknown as Dispatch<SetStateAction<T>>;
}

function buildProps(
  overrides: Partial<ComponentProps<typeof EventsModule>> = {}
): ComponentProps<typeof EventsModule> {
  return {
    run: vi.fn(async (_key: string, fn: () => Promise<void>) => {
      await fn();
    }),
    busy: "",
    hasFunctionsAuthMismatch: false,
    fBaseUrl: "http://127.0.0.1:5001",
    loadEvents: vi.fn(async () => {}),
    setStatus: vi.fn(),
    handleExportWorkshopProgrammingBrief: vi.fn(),
    handleLoadWorkshopProgrammingCluster: vi.fn(),
    activeWorkshopProgrammingClusterLabel: "",
    workshopProgrammingKpis: {
      totalClusters: 1,
      highPressure: 1,
      totalWaitlist: 6,
      totalDemandScore: 18,
      noUpcomingCoverage: 0,
    },
    workshopProgrammingClusters: [
      {
        key: "wheel-throwing",
        label: "Wheel throwing",
        eventCount: 2,
        upcomingCount: 1,
        waitlistCount: 6,
        openSeats: 1,
        reviewRequiredCount: 0,
        demandScore: 18,
        gapScore: 15,
        recommendedAction: "Add second session",
        topEventTitle: "Wheel Lab",
      },
    ],
    eventKpis: {
      total: 2,
      upcoming: 1,
      published: 1,
      reviewRequired: 0,
      openSeats: 1,
      waitlisted: 6,
    },
    filteredEvents: [],
    filteredSignups: [],
    selectedEventId: "",
    selectedSignupId: "",
    selectedEvent: null,
    selectedSignup: null,
    setSelectedEventId: makeSetter<string>(),
    setSelectedSignupId: makeSetter<string>(),
    eventSearch: "",
    setEventSearch: makeSetter<string>(),
    eventStatusFilter: "all",
    setEventStatusFilter: makeSetter<string>(),
    eventStatusOptions: ["draft", "published"],
    signupSearch: "",
    setSignupSearch: makeSetter<string>(),
    signupStatusFilter: "all",
    setSignupStatusFilter: makeSetter<string>(),
    signupStatusOptions: ["ticketed"],
    eventCreateDraft: {
      title: "",
      location: "Monsoon Fire Studio",
      startAt: "",
      durationMinutes: "120",
      capacity: "12",
      priceCents: "0",
    },
    setEventCreateDraft: makeSetter<{
      title: string;
      location: string;
      startAt: string;
      durationMinutes: string;
      capacity: string;
      priceCents: string;
    }>(),
    publishOverrideReason: "",
    setPublishOverrideReason: makeSetter<string>(),
    eventStatusReason: "",
    setEventStatusReason: makeSetter<string>(),
    createQuickEvent: vi.fn(async () => {}),
    publishSelectedEvent: vi.fn(async () => {}),
    setSelectedEventStatus: vi.fn(async () => {}),
    checkInSignupFallback: vi.fn(async () => {}),
    onCheckinSignup: vi.fn(async () => {}),
    loadSignups: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("EventsModule", () => {
  it("routes workshop programming clusters into planning from the staff console", () => {
    const handleLoadWorkshopProgrammingCluster = vi.fn();
    render(
      <EventsModule
        {...buildProps({
          handleLoadWorkshopProgrammingCluster,
        })}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /load into planning/i }));

    expect(handleLoadWorkshopProgrammingCluster).toHaveBeenCalledTimes(1);
    expect(handleLoadWorkshopProgrammingCluster).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "wheel-throwing",
        label: "Wheel throwing",
      })
    );
  });

  it("shows an active planning note when a programming cluster has been loaded", () => {
    render(
      <EventsModule
        {...buildProps({
          activeWorkshopProgrammingClusterLabel: "Wheel throwing",
        })}
      />
    );

    expect(
      screen.getByText(/quick planning is loaded from the wheel throwing cluster/i)
    ).toBeTruthy();
  });
});

/** @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import CockpitModule from "./CockpitModule";

const emptyAnnouncementDraft = {
  title: "",
  summary: "",
  body: "",
  ctaLabel: "",
  ctaUrl: "",
  publishAt: "",
  expiresAt: "",
  pinned: false,
};

function renderCockpitModule(overrides: Partial<Parameters<typeof CockpitModule>[0]> = {}) {
  const publishAnnouncement = vi.fn(async () => undefined);

  render(
    <CockpitModule
      busy=""
      cockpitOpsContent={<div>ops</div>}
      shortText={(value) => value}
      toShortTimeLabel={() => "9:00 AM"}
      openReservationsToday={() => undefined}
      openMessagesInbox={() => undefined}
      startFiringFlow={() => undefined}
      onOpenMessage={() => undefined}
      refreshTodayReservations={async () => undefined}
      refreshTodayFirings={async () => undefined}
      retryTodayReservations={async () => undefined}
      retryTodayFirings={async () => undefined}
      refreshTodayPayments={async () => undefined}
      openReservationDetail={() => undefined}
      handleFiringPhotoFile={async () => undefined}
      todayReservations={[]}
      todayReservationsLoading={false}
      todayReservationsError=""
      unreadMessageCount={0}
      announcementsCount={0}
      unreadAnnouncements={0}
      messageThreadsLoading={false}
      announcementsLoading={false}
      messagesDegraded={false}
      messageThreadsError=""
      announcementsError=""
      todayMessageRows={[]}
      announcementComposerOpen={false}
      announcementDraft={emptyAnnouncementDraft}
      announcementPublishBusy={false}
      announcementPublishStatus=""
      announcementPublishError=""
      toggleAnnouncementComposer={() => undefined}
      updateAnnouncementDraft={() => undefined}
      publishAnnouncement={publishAnnouncement}
      firingsLoading={false}
      firingsError=""
      activeFiring={null}
      firingPhotoBusy={false}
      firingPhotoStatus=""
      firingPhotoError=""
      commerceLoading={false}
      paymentDegraded={false}
      commerceError=""
      paymentAlerts={[]}
      systemSummaryToneLabel="Stable"
      systemSummaryMessage="All clear."
      {...overrides}
    />
  );

  return { publishAnnouncement };
}

describe("CockpitModule announcement composer", () => {
  it("shows a visible create announcement action in the messages card", () => {
    renderCockpitModule();

    expect(screen.getByRole("button", { name: "Create studio announcement" })).toBeTruthy();
  });

  it("renders composer fields and submits once title and body are present", () => {
    const publishAnnouncement = vi.fn(async () => undefined);

    renderCockpitModule({
      announcementComposerOpen: true,
      announcementDraft: {
        ...emptyAnnouncementDraft,
        title: "Kiln unload moved",
        body: "Glaze unload has moved to 4 PM today.",
      },
      publishAnnouncement,
    });

    expect(screen.getByTestId("staff-announcement-composer")).toBeTruthy();
    expect(screen.getByLabelText("Title")).toBeTruthy();
    expect(
      screen.getByPlaceholderText("Share the studio update, schedule note, or member-facing alert.")
    ).toBeTruthy();

    const publishButton = screen.getByRole("button", { name: "Publish announcement" });
    expect((publishButton as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(publishButton);
    expect(publishAnnouncement).toHaveBeenCalledTimes(1);
  });
});

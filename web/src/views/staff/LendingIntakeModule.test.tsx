/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps, Dispatch, SetStateAction } from "react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import LendingIntakeModule from "./LendingIntakeModule";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
  Reflect.deleteProperty(window, "Audio");
  Reflect.deleteProperty(window, "AudioContext");
});

function makeSetter<T>() {
  return vi.fn() as unknown as Dispatch<SetStateAction<T>>;
}

function makeDraft() {
  return {
    title: "",
    subtitle: "",
    authorsCsv: "",
    summary: "",
    description: "",
    publisher: "",
    publishedDate: "",
    isbn: "",
    mediaType: "book",
    format: "",
    coverUrl: "",
    totalCopies: "1",
    availableCopies: "1",
    status: "available",
    source: "manual",
    staffPick: false,
    staffRationale: "",
    subjectsCsv: "",
    techniquesCsv: "",
  };
}

function makePlaceholderItem() {
  return {
    id: "isbn-9780596007126",
    title: "ISBN 9780596007126",
    authorLine: "",
    isbn: "9780596007126",
    isbn10: "",
    isbn13: "9780596007126",
    mediaType: "book",
    status: "available",
    source: "manual",
    totalCopies: 1,
    availableCopies: 1,
    updatedAtMs: Date.now(),
    rawDoc: {},
  };
}

function buildProps(
  overrides: Partial<ComponentProps<typeof LendingIntakeModule>> = {}
): ComponentProps<typeof LendingIntakeModule> {
  return {
    run: vi.fn(async (_key: string, fn: () => Promise<void>) => {
      await fn();
    }),
    busy: "",
    hasFunctionsAuthMismatch: false,
    fBaseUrl: "http://127.0.0.1:5001",
    loadLendingIntake: vi.fn(async () => {}),
    isbnInput: "",
    setIsbnInput: makeSetter<string>(),
    isbnImportBusy: false,
    isbnImportStatus: "",
    isbnImportError: "",
    handleLendingIsbnFile: vi.fn(),
    handleLendingIsbnImport: vi.fn(async () => null),
    isbnScanInput: "9780596007126",
    setIsbnScanInput: makeSetter<string>(),
    isbnScanBusy: false,
    isbnScanStatus: "",
    handleLendingIsbnScanSubmit: vi.fn(async () => null),
    libraryAdminItems: [],
    manualPassEditorOpen: false,
    manualPassEditorItem: null,
    openManualPassEditor: vi.fn(),
    closeManualPassEditor: vi.fn(),
    lendingAdminItemBusy: false,
    lendingAdminItemDraft: makeDraft(),
    setLendingAdminItemDraft: makeSetter<ReturnType<typeof makeDraft>>(),
    handleLendingAdminResolveIsbn: vi.fn(async () => {}),
    lendingAdminIsbnResolveBusy: false,
    lendingAdminIsbnResolveStatus: "",
    lendingAdminItemError: "",
    lendingAdminItemStatus: "",
    handleLendingAdminSave: vi.fn(async () => true),
    openLendingTools: vi.fn(),
    ...overrides,
  };
}

function installAudioMock() {
  const instances: Array<{
    play: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
    currentTime: number;
    preload: string;
    volume: number;
    src: string;
  }> = [];

  const AudioMock = vi.fn(() => {
    const instance = {
      play: vi.fn(() => Promise.resolve()),
      pause: vi.fn(),
      currentTime: 0,
      preload: "",
      volume: 0,
      src: "",
    };
    instances.push(instance);
    return instance;
  });

  Object.defineProperty(window, "Audio", {
    configurable: true,
    value: AudioMock,
  });

  return { AudioMock, instances };
}

describe("LendingIntakeModule", () => {
  it("starts in a ready state and focuses the scan input", async () => {
    render(<LendingIntakeModule {...buildProps()} />);

    const input = screen.getByTestId("lending-scan-input");
    expect(screen.getByTestId("lending-scan-status-phase").textContent).toBe("Ready");

    await waitFor(() => {
      expect(document.activeElement).toBe(input);
    });
  });

  it("walks through importing, matching, pass, and back to ready", async () => {
    vi.useFakeTimers();

    let resolveSubmit: ((value: Awaited<ReturnType<ComponentProps<typeof LendingIntakeModule>["handleLendingIsbnScanSubmit"]>>) => void) | null =
      null;
    const handleLendingIsbnScanSubmit = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveSubmit = resolve;
        })
    );

    render(
      <LendingIntakeModule
        {...buildProps({
          handleLendingIsbnScanSubmit,
        })}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /scan book/i }));
    expect(screen.getByTestId("lending-scan-status-phase").textContent).toBe("Importing");

    await act(async () => {
      resolveSubmit?.({
        scannedIsbn: "9780596007126",
        response: {
          ok: true,
          requested: 1,
          created: 1,
          updated: 0,
          errors: [],
        },
        errorMessage: null,
        requestId: "req_created",
        supportCode: "req_created",
        timedOut: false,
      });
    });
    expect(screen.getByTestId("lending-scan-status-phase").textContent).toBe("Matching");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1800);
    });
    expect(screen.getByTestId("lending-scan-status-phase").textContent).toBe("Pass");
    expect(screen.getByTestId("lending-scan-session-list").textContent).toContain("Recorded");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    expect(screen.getByTestId("lending-scan-status-phase").textContent).toBe("Ready");
  });

  it("plays an audio cue when a scan completes successfully", async () => {
    vi.useFakeTimers();
    const { AudioMock, instances } = installAudioMock();

    render(
      <LendingIntakeModule
        {...buildProps({
          handleLendingIsbnScanSubmit: vi.fn(async () => ({
            scannedIsbn: "9780596007126",
            response: {
              ok: true,
              requested: 1,
              created: 1,
              updated: 0,
              errors: [],
            },
            errorMessage: null,
            requestId: "req_audio",
            supportCode: "req_audio",
            timedOut: false,
          })),
        })}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /scan book/i }));
    });
    expect(screen.getByTestId("lending-scan-status-phase").textContent).toBe("Matching");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1800);
    });

    expect(AudioMock).toHaveBeenCalled();
    expect(instances.length).toBeGreaterThan(0);
    expect(instances.some((instance) => instance.play.mock.calls.length > 0)).toBe(true);
    expect(screen.getByTestId("lending-scan-audio-toggle")).toBeTruthy();
  });

  it("flags manual-pass scans with a dedicated action and alert", async () => {
    const placeholderItem = makePlaceholderItem();
    const openManualPassEditor = vi.fn();
    const { instances } = installAudioMock();

    render(
      <LendingIntakeModule
        {...buildProps({
          libraryAdminItems: [placeholderItem],
          openManualPassEditor,
          handleLendingIsbnScanSubmit: vi.fn(async () => ({
            scannedIsbn: "9780596007126",
            response: {
              ok: true,
              requested: 1,
              created: 1,
              updated: 0,
              errors: [],
            },
            errorMessage: null,
            requestId: "req_manual",
            supportCode: "req_manual",
            timedOut: false,
          })),
        })}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /scan book/i }));

    await waitFor(() => {
      expect(screen.getByTestId("lending-scan-status-phase").textContent).toBe("Pass");
    });

    expect(screen.getByTestId("lending-scan-status-message").textContent).toContain("Manual pass required");
    expect(screen.getByTestId("lending-scan-session-list").textContent).toContain("Manual pass");
    const sessionAction = within(screen.getByTestId("lending-scan-session-list")).getByRole("button", {
      name: /start manual pass/i,
    });
    expect(sessionAction).toBeTruthy();
    expect(instances[1]?.play).toHaveBeenCalled();

    fireEvent.click(sessionAction);
    expect(openManualPassEditor).toHaveBeenCalledWith(placeholderItem);
  });

  it("keeps the manual-pass editor inside intake and returns focus after save", async () => {
    const placeholderItem = makePlaceholderItem();
    const handleLendingAdminSave = vi.fn(async () => true);

    function Wrapper() {
      const [manualPassEditorOpen, setManualPassEditorOpen] = useState(false);
      const [manualPassEditorItem, setManualPassEditorItem] = useState<ComponentProps<typeof LendingIntakeModule>["manualPassEditorItem"]>(null);
      const [draft, setDraft] = useState(makeDraft());

      return (
        <LendingIntakeModule
          {...buildProps({
            libraryAdminItems: [placeholderItem],
            manualPassEditorOpen,
            manualPassEditorItem,
            openManualPassEditor: (item) => {
              setManualPassEditorItem(item);
              setManualPassEditorOpen(true);
            },
            closeManualPassEditor: () => setManualPassEditorOpen(false),
            lendingAdminItemDraft: draft,
            setLendingAdminItemDraft: setDraft,
            handleLendingAdminSave,
          })}
        />
      );
    }

    render(<Wrapper />);

    fireEvent.click(screen.getByRole("button", { name: /open next manual pass/i }));
    expect(screen.getByTestId("lending-manual-pass-editor")).toBeTruthy();
    expect(screen.getByRole("button", { name: /scan book/i }).hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /save and return to scan/i }));

    await waitFor(() => {
      expect(screen.queryByTestId("lending-manual-pass-editor")).toBeNull();
    });
    expect(handleLendingAdminSave).toHaveBeenCalledTimes(1);

    const input = screen.getByTestId("lending-scan-input");
    await waitFor(() => {
      expect(document.activeElement).toBe(input);
    });
  });

  it("keeps refresh failures local and clears the scan action", async () => {
    const loadLendingIntake = vi.fn(async () => {
      throw new Error("refresh exploded");
    });

    render(
      <LendingIntakeModule
        {...buildProps({
          loadLendingIntake,
          handleLendingIsbnScanSubmit: vi.fn(async () => ({
            scannedIsbn: "9780596007126",
            response: {
              ok: true,
              requested: 1,
              created: 1,
              updated: 0,
              errors: [],
            },
            errorMessage: null,
            requestId: "req_refresh",
            supportCode: "req_refresh",
            timedOut: false,
          })),
        })}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /scan book/i }));

    await waitFor(() => {
      expect(screen.getByTestId("lending-scan-status-phase").textContent).toBe("Fail");
    });
    expect(screen.getByTestId("lending-scan-status-message").textContent).toContain("intake refresh failed");
    expect(screen.getAllByText(/req_refresh/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /scan book/i }).hasAttribute("disabled")).toBe(false);
  });

  it("shows timeout feedback and returns to ready", async () => {
    vi.useFakeTimers();

    render(
      <LendingIntakeModule
        {...buildProps({
          handleLendingIsbnScanSubmit: vi.fn(async () => ({
            scannedIsbn: "9780596007126",
            response: null,
            errorMessage: "Request timed out. Try again.",
            requestId: "req_timeout",
            supportCode: "req_timeout",
            timedOut: true,
          })),
        })}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /scan book/i }));
    });
    expect(screen.getByTestId("lending-scan-status-phase").textContent).toBe("Timeout");
    expect(screen.getByTestId("lending-scan-session-list").textContent).toContain("Timeout");
    expect(screen.getAllByText(/req_timeout/i).length).toBeGreaterThan(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    expect(screen.getByTestId("lending-scan-status-phase").textContent).toBe("Ready");
  });
});

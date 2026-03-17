import { useEffect, useEffectEvent, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { ImportLibraryIsbnsResponse } from "../../api/portalContracts";
import LendingCatalogEditor, {
  type LendingAdminItemDraft,
  type LendingAdminItemRecord,
} from "./LendingCatalogEditor";
import {
  createLendingScanAudioController,
  type LendingScanAudioCue,
} from "./lendingScanAudio";

type RunAction = (key: string, fn: () => Promise<void>) => Promise<void>;
type ScanPhase = "ready" | "importing" | "matching" | "pass" | "fail" | "timeout";
type ScanOutcome = "created" | "updated" | "manual-pass" | "recorded" | "rejected" | "error" | "timeout";

export type LendingScanSubmitResult = {
  scannedIsbn: string;
  response: ImportLibraryIsbnsResponse | null;
  errorMessage: string | null;
  requestId: string | null;
  supportCode: string | null;
  timedOut: boolean;
};

type ScanSessionEntry = {
  id: number;
  isbn: string;
  title: string;
  detail: string;
  outcome: ScanOutcome;
  itemId: string | null;
  scannedAtMs: number;
  supportCode: string | null;
};

type PendingScan = {
  token: number;
  result: LendingScanSubmitResult;
};

type Props = {
  run: RunAction;
  busy: string;
  hasFunctionsAuthMismatch: boolean;
  fBaseUrl: string;
  loadLendingIntake: () => Promise<void>;
  isbnInput: string;
  setIsbnInput: Dispatch<SetStateAction<string>>;
  isbnImportBusy: boolean;
  isbnImportStatus: string;
  isbnImportError: string;
  handleLendingIsbnFile: (file: File | null) => void;
  handleLendingIsbnImport: () => Promise<ImportLibraryIsbnsResponse | null>;
  isbnScanInput: string;
  setIsbnScanInput: Dispatch<SetStateAction<string>>;
  isbnScanBusy: boolean;
  isbnScanStatus: string;
  handleLendingIsbnScanSubmit: () => Promise<LendingScanSubmitResult | null>;
  libraryAdminItems: LendingAdminItemRecord[];
  manualPassEditorOpen: boolean;
  manualPassEditorItem: LendingAdminItemRecord | null;
  openManualPassEditor: (item: LendingAdminItemRecord) => void;
  closeManualPassEditor: () => void;
  lendingAdminItemBusy: boolean;
  lendingAdminItemDraft: LendingAdminItemDraft;
  setLendingAdminItemDraft: Dispatch<SetStateAction<LendingAdminItemDraft>>;
  handleLendingAdminResolveIsbn: () => Promise<void>;
  lendingAdminIsbnResolveBusy: boolean;
  lendingAdminIsbnResolveStatus: string;
  lendingAdminItemError: string;
  lendingAdminItemStatus: string;
  handleLendingAdminSave: () => Promise<boolean>;
  openLendingTools: () => void;
};

function when(ms: number): string {
  if (!ms) return "-";
  return new Date(ms).toLocaleString();
}

function cleanIsbnToken(raw: string): string {
  return raw.replace(/[^0-9xX]/g, "").toUpperCase();
}

function libraryItemMatchesIsbn(item: LendingAdminItemRecord, isbn: string): boolean {
  const cleaned = cleanIsbnToken(isbn);
  if (!cleaned) return false;
  return [item.isbn, item.isbn10, item.isbn13].some((value) => cleanIsbnToken(value) === cleaned);
}

function isManualScanPlaceholder(item: LendingAdminItemRecord): boolean {
  if (item.source.trim().toLowerCase() !== "manual") return false;
  const title = item.title.trim().toLowerCase();
  if (title.startsWith("isbn ")) return true;
  const hasCatalogIsbn = Boolean(cleanIsbnToken(item.isbn || item.isbn13 || item.isbn10));
  return hasCatalogIsbn && item.authorLine.trim().length === 0;
}

function buildScanEntryDetail(entry: {
  outcome: ScanOutcome;
  title: string;
  errorMessage?: string | null;
}): string {
  if (entry.errorMessage) return entry.errorMessage;
  if (entry.outcome === "manual-pass") {
    return "Manual pass required. Pull this book aside and finish the record from the intake queue.";
  }
  if (entry.outcome === "created") return `Added ${entry.title} to the lending catalog.`;
  if (entry.outcome === "updated") return `Refreshed ${entry.title} from ISBN metadata.`;
  if (entry.outcome === "rejected") return "Rejected. No public item was created for this scan.";
  if (entry.outcome === "timeout") return "The intake request timed out before metadata finished loading.";
  if (entry.outcome === "error") return "The intake request failed.";
  return "Import completed and is waiting on catalog sync.";
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return String(error || "Unknown intake error");
}

function phaseLabel(phase: ScanPhase): string {
  if (phase === "ready") return "Ready";
  if (phase === "importing") return "Importing";
  if (phase === "matching") return "Matching";
  if (phase === "pass") return "Pass";
  if (phase === "timeout") return "Timeout";
  return "Fail";
}

function outcomeLabel(outcome: ScanOutcome): string {
  if (outcome === "created") return "Created";
  if (outcome === "updated") return "Updated";
  if (outcome === "manual-pass") return "Manual pass";
  if (outcome === "rejected") return "Rejected";
  if (outcome === "timeout") return "Timeout";
  if (outcome === "error") return "Error";
  return "Recorded";
}

export default function LendingIntakeModule({
  run,
  busy,
  hasFunctionsAuthMismatch,
  fBaseUrl,
  loadLendingIntake,
  isbnInput,
  setIsbnInput,
  isbnImportBusy,
  isbnImportStatus,
  isbnImportError,
  handleLendingIsbnFile,
  handleLendingIsbnImport,
  isbnScanInput,
  setIsbnScanInput,
  isbnScanBusy,
  isbnScanStatus,
  handleLendingIsbnScanSubmit,
  libraryAdminItems,
  manualPassEditorOpen,
  manualPassEditorItem,
  openManualPassEditor,
  closeManualPassEditor,
  lendingAdminItemBusy,
  lendingAdminItemDraft,
  setLendingAdminItemDraft,
  handleLendingAdminResolveIsbn,
  lendingAdminIsbnResolveBusy,
  lendingAdminIsbnResolveStatus,
  lendingAdminItemError,
  lendingAdminItemStatus,
  handleLendingAdminSave,
  openLendingTools,
}: Props) {
  const scanInputRef = useRef<HTMLInputElement | null>(null);
  const scanTokenRef = useRef(0);
  const audioController = useMemo(() => createLendingScanAudioController(), []);
  const [scanPhase, setScanPhase] = useState<ScanPhase>("ready");
  const [scanMessage, setScanMessage] = useState("Scanner ready for the next ISBN.");
  const [scanSupportCode, setScanSupportCode] = useState<string | null>(null);
  const [sessionEntries, setSessionEntries] = useState<ScanSessionEntry[]>([]);
  const [pendingScan, setPendingScan] = useState<PendingScan | null>(null);
  const [bulkRefreshNote, setBulkRefreshNote] = useState("");
  const [audioFeedbackEnabled, setAudioFeedbackEnabled] = useState(true);

  const manualPassItems = useMemo(
    () =>
      libraryAdminItems
        .filter((item) => isManualScanPlaceholder(item))
        .sort((left, right) => right.updatedAtMs - left.updatedAtMs),
    [libraryAdminItems]
  );

  const latestManualPassEntry = useMemo(
    () => sessionEntries.find((entry) => entry.outcome === "manual-pass") ?? null,
    [sessionEntries]
  );

  function appendSessionEntry(entry: ScanSessionEntry): void {
    setSessionEntries((prev) => [entry, ...prev].slice(0, 12));
  }

  function playAudioCue(cue: LendingScanAudioCue): void {
    audioController.play(cue, audioFeedbackEnabled);
  }

  useEffect(() => {
    if (scanPhase !== "ready" || isbnScanBusy || manualPassEditorOpen) return;
    const frame = window.requestAnimationFrame(() => {
      scanInputRef.current?.focus();
      scanInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [manualPassEditorOpen, scanPhase, isbnScanBusy]);

  useEffect(() => {
    if (scanPhase !== "pass" && scanPhase !== "fail" && scanPhase !== "timeout") return;
    const token = scanTokenRef.current;
    const timeout = window.setTimeout(() => {
      if (scanTokenRef.current !== token) return;
      setScanPhase("ready");
      setScanMessage("Scanner ready for the next ISBN.");
      setScanSupportCode(null);
    }, 1600);
    return () => window.clearTimeout(timeout);
  }, [scanPhase]);

  useEffect(() => {
    return () => audioController.dispose();
  }, [audioController]);

  const processPendingScan = useEffectEvent((currentPendingScan: PendingScan) => {
    const { token, result } = currentPendingScan;
    const manualPassResponse = result.response?.manualPassRequired?.[0] ?? null;
    const rejectedResponse = result.response?.rejected?.[0] ?? null;
    const matchedItem = libraryAdminItems
      .filter((item) =>
        item.id === manualPassResponse?.itemId ||
        libraryItemMatchesIsbn(item, result.scannedIsbn)
      )
      .sort((left, right) => right.updatedAtMs - left.updatedAtMs)[0];

    if (rejectedResponse) {
      appendSessionEntry({
        id: token,
        isbn: result.scannedIsbn,
        title: `ISBN ${result.scannedIsbn}`,
        detail: rejectedResponse.message || buildScanEntryDetail({ outcome: "rejected", title: `ISBN ${result.scannedIsbn}` }),
        outcome: "rejected",
        itemId: null,
        scannedAtMs: Date.now(),
        supportCode: result.supportCode,
      });
      setScanPhase("fail");
      setScanMessage(rejectedResponse.message || "Rejected. No public item was created.");
      audioController.play("error", audioFeedbackEnabled);
      setPendingScan(null);
      return undefined;
    }

    if (matchedItem) {
      const outcome: ScanOutcome = manualPassResponse || isManualScanPlaceholder(matchedItem)
        ? "manual-pass"
        : (result.response?.created ?? 0) > 0
          ? "created"
          : (result.response?.updated ?? 0) > 0
            ? "updated"
            : "recorded";
      const detail = buildScanEntryDetail({
        outcome,
        title: matchedItem.title || `ISBN ${result.scannedIsbn}`,
      });
      appendSessionEntry({
        id: token,
        isbn: result.scannedIsbn,
        title: matchedItem.title || `ISBN ${result.scannedIsbn}`,
        detail,
        outcome,
        itemId: matchedItem.id,
        scannedAtMs: Date.now(),
        supportCode: result.supportCode,
      });
      setScanPhase("pass");
      setScanMessage(
        outcome === "manual-pass"
          ? `Manual pass required. Pull ${matchedItem.title || `ISBN ${result.scannedIsbn}`} and finish it from the queue.`
          : `${matchedItem.title || `ISBN ${result.scannedIsbn}`} matched in the catalog.`
      );
      audioController.play(outcome === "manual-pass" ? "manual-pass" : "success", audioFeedbackEnabled);
      setPendingScan(null);
      return undefined;
    }

    if (manualPassResponse) {
      appendSessionEntry({
        id: token,
        isbn: result.scannedIsbn,
        title: `ISBN ${result.scannedIsbn}`,
        detail: manualPassResponse.message || buildScanEntryDetail({ outcome: "manual-pass", title: `ISBN ${result.scannedIsbn}` }),
        outcome: "manual-pass",
        itemId: manualPassResponse.itemId ?? null,
        scannedAtMs: Date.now(),
        supportCode: result.supportCode,
      });
      setScanPhase("pass");
      setScanMessage("Manual pass required. Pull this title aside and finish it from the queue.");
      audioController.play("manual-pass", audioFeedbackEnabled);
      setPendingScan(null);
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      if (scanTokenRef.current !== token) return;
      const createdCount = result.response?.created ?? 0;
      const updatedCount = result.response?.updated ?? 0;
      appendSessionEntry({
        id: token,
        isbn: result.scannedIsbn,
        title: `ISBN ${result.scannedIsbn}`,
        detail: buildScanEntryDetail({
          outcome: "recorded",
          title: `ISBN ${result.scannedIsbn}`,
        }),
        outcome: "recorded",
        itemId: null,
        scannedAtMs: Date.now(),
        supportCode: result.supportCode,
      });
      setScanPhase("pass");
      setScanMessage(
        createdCount > 0 || updatedCount > 0
          ? "Import completed. Catalog sync is still catching up, but the request finished."
          : "Intake finished without a catalog match."
      );
      audioController.play("success", audioFeedbackEnabled);
      setPendingScan(null);
    }, 1800);

    return () => window.clearTimeout(timeout);
  });

  useEffect(() => {
    if (!pendingScan) return;
    return processPendingScan(pendingScan);
  }, [libraryAdminItems, pendingScan]);

  async function submitScan(): Promise<void> {
    const raw = isbnScanInput.trim();
    if (!raw) {
      setScanPhase("fail");
      setScanMessage("Scan an ISBN first.");
      setScanSupportCode(null);
      return;
    }

    const token = scanTokenRef.current + 1;
    scanTokenRef.current = token;
    setPendingScan(null);
    audioController.prime();
    setScanPhase("importing");
    setScanMessage("Sending ISBN intake request…");
    setScanSupportCode(null);

    const result = await handleLendingIsbnScanSubmit();
    if (scanTokenRef.current !== token || !result) {
      if (!result) {
        setScanPhase("ready");
        setScanMessage(isbnScanStatus || "Scanner ready for the next ISBN.");
      }
      return;
    }

    if (result.errorMessage) {
      const outcome: ScanOutcome = result.timedOut ? "timeout" : "error";
      appendSessionEntry({
        id: token,
        isbn: result.scannedIsbn,
        title: `ISBN ${result.scannedIsbn}`,
        detail: buildScanEntryDetail({
          outcome,
          title: `ISBN ${result.scannedIsbn}`,
          errorMessage: result.errorMessage,
        }),
        outcome,
        itemId: null,
        scannedAtMs: Date.now(),
        supportCode: result.supportCode,
      });
      setScanPhase(result.timedOut ? "timeout" : "fail");
      setScanMessage(result.errorMessage);
      setScanSupportCode(result.supportCode ?? result.requestId);
      playAudioCue(result.timedOut ? "timeout" : "error");
      return;
    }

    const rejectedResponse = result.response?.rejected?.[0] ?? null;
    if (rejectedResponse) {
      appendSessionEntry({
        id: token,
        isbn: result.scannedIsbn,
        title: `ISBN ${result.scannedIsbn}`,
        detail: rejectedResponse.message || buildScanEntryDetail({ outcome: "rejected", title: `ISBN ${result.scannedIsbn}` }),
        outcome: "rejected",
        itemId: null,
        scannedAtMs: Date.now(),
        supportCode: result.supportCode ?? result.requestId,
      });
      setScanPhase("fail");
      setScanMessage(rejectedResponse.message || "Rejected. No public item was created.");
      setScanSupportCode(result.supportCode ?? result.requestId);
      playAudioCue("error");
      return;
    }

    setScanPhase("matching");
    setScanMessage("Import finished. Matching against the lending catalog…");
    setScanSupportCode(result.supportCode ?? result.requestId);

    try {
      await loadLendingIntake();
    } catch (error: unknown) {
      const message = `Import completed, but intake refresh failed: ${readErrorMessage(error)}`;
      appendSessionEntry({
        id: token,
        isbn: result.scannedIsbn,
        title: `ISBN ${result.scannedIsbn}`,
        detail: message,
        outcome: "error",
        itemId: null,
        scannedAtMs: Date.now(),
        supportCode: result.supportCode ?? result.requestId,
      });
      setScanPhase("fail");
      setScanMessage(message);
      playAudioCue("error");
      return;
    }

    if (scanTokenRef.current !== token) return;
    setPendingScan({ token, result });
  }

  async function saveManualPassAndReturn(): Promise<boolean> {
    const saved = await handleLendingAdminSave();
    if (!saved) return false;
    closeManualPassEditor();
    setScanPhase("ready");
    setScanMessage("Manual pass saved. Scanner ready for the next ISBN.");
    setScanSupportCode(null);
    return true;
  }

  async function submitBulkImport(): Promise<void> {
    setBulkRefreshNote("");
    const response = await handleLendingIsbnImport();
    if (!response) return;
    try {
      await loadLendingIntake();
      setBulkRefreshNote("Catalog refreshed after bulk import.");
    } catch (error: unknown) {
      setBulkRefreshNote(`Import completed, but intake refresh failed: ${readErrorMessage(error)}`);
    }
  }

  return (
    <section className="staff-column" data-testid="lending-intake-page">
      <section className="card staff-console-card">
        <div className="card-title-row">
          <div className="staff-column">
            <div className="card-title">Lending intake</div>
            <p className="card-subtitle">
              Dedicated ISBN intake for scanner loops, batch import, and cleanup follow-through.
            </p>
          </div>
          <div className="staff-actions-row">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => void run("refreshLendingIntake", loadLendingIntake)}
              disabled={Boolean(busy)}
            >
              Refresh intake
            </button>
            <button type="button" className="btn btn-secondary" onClick={openLendingTools}>
              Open lending tools
            </button>
          </div>
        </div>
        {hasFunctionsAuthMismatch ? (
          <div className="staff-note">
            Local functions detected at <code>{fBaseUrl}</code> while Auth emulator is off. Intake requests are paused to prevent false auth failures.
          </div>
        ) : null}
        <div className="staff-note">
          Scanner status stays visible here so the operator always knows whether the system is ready, importing, matching, or waiting on cleanup.
        </div>
      </section>

      <section className="card staff-console-card">
        <div className="card-title-row">
          <div className="staff-column">
            <div className="staff-subtitle">Manual pass queue</div>
            <div className="card-title">{manualPassItems.length === 0 ? "Queue clear" : "Pull-and-finish queue"}</div>
          </div>
          <div className="staff-actions-row">
            <button
              type="button"
              className="btn btn-primary"
              data-testid="lending-open-next-manual-pass"
              onClick={() => {
                if (manualPassItems[0]) {
                  openManualPassEditor(manualPassItems[0]);
                }
              }}
              disabled={Boolean(busy) || lendingAdminItemBusy || manualPassItems.length === 0}
            >
              {manualPassEditorOpen ? "Resume manual pass" : "Open next manual pass"}
            </button>
            {manualPassEditorOpen ? (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={closeManualPassEditor}
                disabled={Boolean(busy) || lendingAdminItemBusy}
              >
                Return to scanning
              </button>
            ) : null}
          </div>
        </div>
        <div className="staff-note" data-testid="lending-manual-pass-summary">
          {manualPassItems.length === 0
            ? "No titles are waiting on a manual pass. The rack scan loop is clear."
            : "Manual-pass alert means pull that book aside, keep scanning the rack, and finish it from this queue when you are ready."}
        </div>
        {latestManualPassEntry ? (
          <div className="staff-note">
            Latest manual pass queued: <strong>{latestManualPassEntry.title}</strong>
          </div>
        ) : null}
      </section>

      {manualPassEditorOpen && manualPassEditorItem ? (
        <section className="card staff-console-card">
          <div className="card-title-row">
            <div className="staff-column">
              <div className="staff-subtitle">Manual pass editor</div>
              <div className="card-title">{manualPassEditorItem.title || manualPassEditorItem.id}</div>
            </div>
            <span className="pill">Editing</span>
          </div>
          <LendingCatalogEditor
            busy={busy}
            lendingAdminItemBusy={lendingAdminItemBusy}
            selectedAdminItem={manualPassEditorItem}
            lendingAdminItemDraft={lendingAdminItemDraft}
            setLendingAdminItemDraft={setLendingAdminItemDraft}
            handleLendingAdminResolveIsbn={handleLendingAdminResolveIsbn}
            lendingAdminIsbnResolveBusy={lendingAdminIsbnResolveBusy}
            lendingAdminIsbnResolveStatus={lendingAdminIsbnResolveStatus}
            lendingAdminItemError={lendingAdminItemError}
            lendingAdminItemStatus={lendingAdminItemStatus}
            handleLendingAdminSave={saveManualPassAndReturn}
            title={`Manual pass: ${manualPassEditorItem.title || manualPassEditorItem.id}`}
            note="Finish the record here, then return to the rack scan loop. Delete and archive controls stay in the full lending tools page."
            primaryActionLabel="Save and return to scan"
            onCancel={closeManualPassEditor}
            cancelLabel="Return to scan"
            testId="lending-manual-pass-editor"
          />
        </section>
      ) : null}

      <div className="staff-module-grid">
        <section className="card staff-console-card staff-column">
          <div className="card-title-row">
            <div className="staff-column">
              <div className="staff-subtitle">Single-book scan</div>
              <div className="card-title">{phaseLabel(scanPhase)}</div>
            </div>
            <span className="pill" data-testid="lending-scan-status-phase">
              {phaseLabel(scanPhase)}
            </span>
          </div>
          <div className="staff-note" data-testid="lending-scan-status-message">{scanMessage}</div>
          {scanSupportCode ? (
            <div className="staff-note">
              Support code: <code>{scanSupportCode}</code>
            </div>
          ) : null}
          {isbnScanStatus && isbnScanStatus !== scanMessage ? <div className="staff-note">{isbnScanStatus}</div> : null}
          {manualPassEditorOpen ? (
            <div className="staff-note">Scanner is paused while the manual-pass editor is open.</div>
          ) : null}
          <div className="staff-field">
            <span>Operator feedback</span>
            <label>
              <input
                data-testid="lending-scan-audio-toggle"
                type="checkbox"
                checked={audioFeedbackEnabled}
                onChange={(event) => setAudioFeedbackEnabled(event.target.checked)}
              />
              {" "}
              Audio feedback enabled
            </label>
            <span className="helper">Plays a short success cue plus stronger manual-pass, error, and timeout alerts.</span>
          </div>
          <label className="staff-field">
            Scan ISBN
            <input
              ref={scanInputRef}
              data-testid="lending-scan-input"
              type="text"
              value={isbnScanInput}
              placeholder="Scan ISBN here"
              onChange={(event) => setIsbnScanInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void submitScan();
                }
              }}
              disabled={
                Boolean(busy) ||
                isbnScanBusy ||
                manualPassEditorOpen ||
                scanPhase === "importing" ||
                scanPhase === "matching" ||
                hasFunctionsAuthMismatch
              }
            />
            <span className="helper">ISBN-10 and ISBN-13 both work. Manual-pass results queue the book for later cleanup, then return to ready.</span>
          </label>
          <div className="staff-actions-row">
            <button
              type="button"
              className="btn btn-primary"
              data-testid="lending-scan-submit"
              onClick={() => void submitScan()}
              disabled={
                Boolean(busy) ||
                isbnScanBusy ||
                manualPassEditorOpen ||
                scanPhase === "importing" ||
                scanPhase === "matching" ||
                hasFunctionsAuthMismatch
              }
            >
              {scanPhase === "importing" || scanPhase === "matching" || isbnScanBusy ? "Scanning..." : "Scan book"}
            </button>
          </div>
          <div className="staff-subtitle">This scan session</div>
          <div className="staff-table-wrap">
            <table className="staff-table" data-testid="lending-scan-session-list">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Title</th>
                  <th>ISBN</th>
                  <th>Scanned</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {sessionEntries.length === 0 ? (
                  <tr>
                    <td colSpan={5}>No scans yet this session.</td>
                  </tr>
                ) : (
                  sessionEntries.map((entry) => {
                    const actionItem = entry.itemId
                      ? libraryAdminItems.find((item) => item.id === entry.itemId) ?? null
                      : null;

                    return (
                    <tr key={entry.id}>
                      <td>
                        <span className="pill">{outcomeLabel(entry.outcome)}</span>
                        {entry.supportCode ? (
                          <div className="staff-mini">
                            <code>{entry.supportCode}</code>
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <div>{entry.title}</div>
                        <div className="staff-mini">{entry.detail}</div>
                        {entry.itemId ? (
                          <div className="staff-mini">
                            <code>{entry.itemId}</code>
                          </div>
                        ) : null}
                      </td>
                      <td><code>{entry.isbn}</code></td>
                      <td>{when(entry.scannedAtMs)}</td>
                      <td>
                        {entry.outcome === "manual-pass" && actionItem ? (
                          <button
                            type="button"
                            className="btn btn-secondary btn-small"
                            onClick={() => openManualPassEditor(actionItem)}
                          >
                            Start manual pass
                          </button>
                        ) : (
                          "-"
                        )}
                      </td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card staff-console-card staff-column">
          <div className="staff-subtitle">Bulk import</div>
          <label className="staff-field">
            Paste ISBNs
            <textarea
              value={isbnInput}
              onChange={(event) => setIsbnInput(event.target.value)}
              placeholder="9780596007126, 9780132350884"
            />
            <span className="helper">Comma or newline separated. CSV upload lands in the same queue.</span>
          </label>
          <label className="staff-field">
            Upload CSV
            <input
              type="file"
              accept=".csv,text/csv,text/plain"
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                handleLendingIsbnFile(file);
              }}
            />
          </label>
          {isbnImportError ? <div className="staff-note staff-note-error">{isbnImportError}</div> : null}
          {isbnImportStatus ? <div className="staff-note staff-note-ok">{isbnImportStatus}</div> : null}
          {bulkRefreshNote ? <div className="staff-note">{bulkRefreshNote}</div> : null}
          <div className="staff-actions-row">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void submitBulkImport()}
              disabled={Boolean(busy) || isbnImportBusy || hasFunctionsAuthMismatch}
            >
              {isbnImportBusy ? "Importing..." : "Import ISBNs"}
            </button>
          </div>
        </section>
      </div>

      <section className="card staff-console-card">
        <div className="card-title-row">
          <div className="staff-column">
            <div className="staff-subtitle">Manual pass queue</div>
            <div className="card-title">Pull-and-finish items</div>
          </div>
          <span className="pill">{manualPassItems.length}</span>
        </div>
        <div className="staff-note">
          Placeholder records and thin metadata imports land here so staff can pull the book, open the editor, and finish the record without leaving intake.
        </div>
        <div className="staff-table-wrap">
          <table className="staff-table" data-testid="lending-manual-pass-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>ISBN</th>
                <th>Updated</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {manualPassItems.length === 0 ? (
                <tr>
                  <td colSpan={4}>No titles currently waiting on a manual pass.</td>
                </tr>
              ) : (
                manualPassItems.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div>{item.title}</div>
                      <div className="staff-mini">{item.authorLine || "Author details missing"}</div>
                      <div className="staff-mini">
                        <code>{item.id}</code>
                      </div>
                    </td>
                    <td><code>{item.isbn || item.isbn13 || item.isbn10 || "-"}</code></td>
                    <td>{when(item.updatedAtMs)}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-secondary btn-small"
                        onClick={() => openManualPassEditor(item)}
                      >
                        Start manual pass
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}

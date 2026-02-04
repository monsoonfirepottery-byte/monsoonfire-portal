import { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import {
  addDoc,
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";
import type { ImportLibraryIsbnsResponse } from "../api/portalContracts";
import { createFunctionsClient, type LastRequest } from "../api/functionsClient";
import TroubleshootingPanel from "../components/TroubleshootingPanel";
import { db } from "../firebase";
import type { LibraryItem, LibraryLoan, LibraryRequest } from "../types/library";
import { formatMaybeTimestamp } from "../utils/format";
import "./LendingLibraryView.css";

const DEFAULT_FUNCTIONS_BASE_URL = "https://us-central1-monsoonfire-portal.cloudfunctions.net";
const MAX_LOANS = 2;
const LOAN_LENGTH_LABEL = "1 month";

type FilterKey = "all" | "available" | "checked_out";

type Props = {
  user: User;
  adminToken?: string;
  isStaff: boolean;
};

function resolveFunctionsBaseUrl() {
  const env =
    typeof import.meta !== "undefined" &&
    (import.meta as any).env &&
    (import.meta as any).env.VITE_FUNCTIONS_BASE_URL
      ? String((import.meta as any).env.VITE_FUNCTIONS_BASE_URL)
      : "";
  return env || DEFAULT_FUNCTIONS_BASE_URL;
}

function normalizeIsbnList(raw: string) {
  return raw
    .split(/[\n,\r]+/g)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
}

function formatAvailability(item: LibraryItem) {
  const total = typeof item.totalCopies === "number" ? item.totalCopies : 1;
  const available = typeof item.availableCopies === "number" ? item.availableCopies : 0;
  return `${available} available · ${total} total`;
}

function requestIsActive(status: string) {
  return status === "pending_approval" || status === "approved";
}

function loanIsActive(status: string) {
  return status !== "returned";
}

export default function LendingLibraryView({ user, adminToken, isStaff }: Props) {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(true);
  const [itemsError, setItemsError] = useState("");

  const [requests, setRequests] = useState<LibraryRequest[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(true);
  const [requestsError, setRequestsError] = useState("");

  const [loans, setLoans] = useState<LibraryLoan[]>([]);
  const [loansLoading, setLoansLoading] = useState(true);
  const [loansError, setLoansError] = useState("");

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [actionBusy, setActionBusy] = useState(false);
  const [actionStatus, setActionStatus] = useState("");

  const [donationIsbn, setDonationIsbn] = useState("");
  const [donationTitle, setDonationTitle] = useState("");
  const [donationAuthor, setDonationAuthor] = useState("");
  const [donationFormat, setDonationFormat] = useState("");
  const [donationNotes, setDonationNotes] = useState("");
  const [donationBusy, setDonationBusy] = useState(false);
  const [donationStatus, setDonationStatus] = useState("");

  const [scanIsbn, setScanIsbn] = useState("");
  const [scanBusy, setScanBusy] = useState(false);
  const [scanStatus, setScanStatus] = useState("");

  const [csvText, setCsvText] = useState("");
  const [csvImportBusy, setCsvImportBusy] = useState(false);
  const [csvImportStatus, setCsvImportStatus] = useState("");
  const [csvImportError, setCsvImportError] = useState("");
  const [lastReq, setLastReq] = useState<LastRequest | null>(null);

  const baseUrl = useMemo(() => resolveFunctionsBaseUrl(), []);
  const hasAdmin = isStaff || !!adminToken?.trim();

  const client = useMemo(() => {
    return createFunctionsClient({
      baseUrl,
      getIdToken: async () => await user.getIdToken(),
      getAdminToken: () => adminToken,
      onLastRequest: setLastReq,
    });
  }, [adminToken, baseUrl, user]);

  const reloadItems = async () => {
    setItemsLoading(true);
    setItemsError("");
    try {
      const itemsQuery = query(collection(db, "libraryItems"), orderBy("title", "asc"), limit(500));
      const snap = await getDocs(itemsQuery);
      const rows: LibraryItem[] = snap.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as any),
      }));
      setItems(rows);
    } catch (err: any) {
      setItemsError(`Library items failed: ${err?.message || String(err)}`);
    } finally {
      setItemsLoading(false);
    }
  };

  useEffect(() => {
    void reloadItems();
  }, []);

  useEffect(() => {
    const loadRequests = async () => {
      setRequestsLoading(true);
      setRequestsError("");
      try {
        const requestsQuery = query(
          collection(db, "libraryRequests"),
          where("requesterUid", "==", user.uid),
          limit(200)
        );
        const snap = await getDocs(requestsQuery);
        const rows: LibraryRequest[] = snap.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as any),
        }));
        rows.sort((a, b) => {
          const aTime = a.requestedAt?.toDate?.()?.getTime() ?? 0;
          const bTime = b.requestedAt?.toDate?.()?.getTime() ?? 0;
          return bTime - aTime;
        });
        setRequests(rows);
      } catch (err: any) {
        setRequestsError(`Requests failed: ${err?.message || String(err)}`);
      } finally {
        setRequestsLoading(false);
      }
    };

    void loadRequests();
  }, [user.uid]);

  useEffect(() => {
    const loadLoans = async () => {
      setLoansLoading(true);
      setLoansError("");
      try {
        const loansQuery = query(
          collection(db, "libraryLoans"),
          where("borrowerUid", "==", user.uid),
          limit(50)
        );
        const snap = await getDocs(loansQuery);
        const rows: LibraryLoan[] = snap.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as any),
        }));
        rows.sort((a, b) => {
          const aTime = a.loanedAt?.toDate?.()?.getTime() ?? 0;
          const bTime = b.loanedAt?.toDate?.()?.getTime() ?? 0;
          return bTime - aTime;
        });
        setLoans(rows);
      } catch (err: any) {
        setLoansError(`Loans failed: ${err?.message || String(err)}`);
      } finally {
        setLoansLoading(false);
      }
    };

    void loadLoans();
  }, [user.uid]);

  const activeLoans = useMemo(() => loans.filter((loan) => loanIsActive(loan.status)), [loans]);
  const activeLoanCount = activeLoans.length;

  const requestMap = useMemo(() => {
    const map = new Map<string, LibraryRequest>();
    requests.forEach((request) => {
      if (requestIsActive(request.status)) {
        map.set(request.itemId, request);
      }
    });
    return map;
  }, [requests]);

  const loanMap = useMemo(() => {
    const map = new Map<string, LibraryLoan>();
    activeLoans.forEach((loan) => {
      map.set(loan.itemId, loan);
    });
    return map;
  }, [activeLoans]);

  const filteredItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    return items.filter((item) => {
      const available = typeof item.availableCopies === "number" ? item.availableCopies : 0;
      if (filter === "available" && available === 0) return false;
      if (filter === "checked_out" && available > 0) return false;

      if (!term) return true;
      const haystack = [
        item.title,
        item.subtitle,
        ...(item.authors ?? []),
        ...(item.subjects ?? []),
        item.identifiers?.isbn10,
        item.identifiers?.isbn13,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [items, search, filter]);

  const canRequest = activeLoanCount < MAX_LOANS;

  const handleRequest = async (item: LibraryItem, type: "reserve" | "waitlist" | "return") => {
    if (actionBusy) return;
    if (type !== "return" && !canRequest) {
      setActionStatus(`Loan limit reached (${MAX_LOANS} active loans).`);
      return;
    }

    setActionBusy(true);
    setActionStatus("");
    try {
      await addDoc(collection(db, "libraryRequests"), {
        itemId: item.id,
        itemTitle: item.title,
        type,
        status: "pending_approval",
        requesterUid: user.uid,
        requesterName: user.displayName || null,
        requesterEmail: user.email || null,
        requestedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        notes: null,
      });
      setActionStatus("Request sent. Staff will confirm shortly.");

      const refreshed = await getDocs(
        query(collection(db, "libraryRequests"), where("requesterUid", "==", user.uid), limit(200))
      );
      const rows: LibraryRequest[] = refreshed.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as any),
      }));
      setRequests(rows);
    } catch (err: any) {
      setActionStatus(`Request failed: ${err?.message || String(err)}`);
    } finally {
      setActionBusy(false);
    }
  };

  const handleDonation = async () => {
    if (donationBusy) return;
    setDonationStatus("");
    setDonationBusy(true);

    const isbn = donationIsbn.trim();
    const title = donationTitle.trim();
    const author = donationAuthor.trim();
    const format = donationFormat.trim();
    const notes = donationNotes.trim();

    if (!isbn && !title) {
      setDonationStatus("Add at least an ISBN or title.");
      setDonationBusy(false);
      return;
    }

    try {
      await addDoc(collection(db, "libraryDonationRequests"), {
        isbn: isbn || null,
        title: title || null,
        author: author || null,
        format: format || null,
        notes: notes || null,
        status: "pending",
        donorUid: user.uid,
        donorName: user.displayName || null,
        donorEmail: user.email || null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setDonationStatus("Thanks! We received your donation request.");
      setDonationIsbn("");
      setDonationTitle("");
      setDonationAuthor("");
      setDonationFormat("");
      setDonationNotes("");
    } catch (err: any) {
      setDonationStatus(`Donation request failed: ${err?.message || String(err)}`);
    } finally {
      setDonationBusy(false);
    }
  };

  const handleCsvImport = async () => {
    if (csvImportBusy) return;
    setCsvImportStatus("");
    setCsvImportError("");

    const isbns = normalizeIsbnList(csvText);
    if (isbns.length === 0) {
      setCsvImportError("Paste at least one ISBN (one per line).");
      return;
    }

    setCsvImportBusy(true);
    try {
      const resp = await client.postJson<ImportLibraryIsbnsResponse>("importLibraryIsbns", {
        isbns,
        source: "csv",
      });
      const errorCount = resp.errors?.length ?? 0;
      setCsvImportStatus(
        `Imported ${resp.created} new, updated ${resp.updated}. ${errorCount} errors.`
      );
    } catch (err: any) {
      setCsvImportError(err?.message || String(err));
    } finally {
      await reloadItems();
      setCsvImportBusy(false);
    }
  };

  const handleScanSubmit = async () => {
    if (scanBusy) return;
    setScanStatus("");
    if (!hasAdmin) {
      setScanStatus("Paste the admin token to enable staff scans.");
      return;
    }

    const raw = scanIsbn.trim();
    if (!raw) {
      setScanStatus("Scan an ISBN first.");
      return;
    }

    setScanBusy(true);
    try {
      await client.postJson<ImportLibraryIsbnsResponse>("importLibraryIsbns", {
        isbns: [raw],
        source: "scanner",
      });
      setScanStatus("Scan saved.");
      setScanIsbn("");
    } catch (err: any) {
      setScanStatus(err?.message || String(err));
    } finally {
      await reloadItems();
      setScanBusy(false);
    }
  };

  const handleCsvFile = async (file: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      setCsvText(text);
    } catch (err: any) {
      setCsvImportError(`Failed to read file: ${err?.message || String(err)}`);
    }
  };

  return (
    <div className="page lending-library-page">
      <div className="page-header">
        <div>
          <h1>Lending Library</h1>
          <p className="page-subtitle">
            Borrow studio books and media for short-term inspiration. Staff approvals keep the
            queue moving smoothly.
          </p>
        </div>
      </div>

      <section className="card card-3d lending-hero">
        <div>
          <div className="card-title">Library policies</div>
          <p className="lending-copy">
            Loan length: {LOAN_LENGTH_LABEL}. Active loans: {activeLoanCount} / {MAX_LOANS}. Staff
            approval required for all reservations and waitlists.
          </p>
        </div>
        <div className="lending-hero-meta">
          <div>
            <span className="summary-label">Loan length</span>
            <span className="summary-value">{LOAN_LENGTH_LABEL}</span>
          </div>
          <div>
            <span className="summary-label">Max loans</span>
            <span className="summary-value">{MAX_LOANS}</span>
          </div>
          <div>
            <span className="summary-label">Role</span>
            <span className="summary-value">{isStaff ? "Staff" : "Client"}</span>
          </div>
        </div>
      </section>

      <section className="card card-3d lending-search">
        <div className="lending-search-header">
          <div>
            <div className="card-title">Browse the library</div>
            <p className="lending-copy">Search by title, author, subject, or ISBN.</p>
          </div>
          <div className="filter-chips">
            {(["all", "available", "checked_out"] as FilterKey[]).map((item) => (
              <button
                key={item}
                className={`chip ${filter === item ? "active" : ""}`}
                onClick={() => setFilter(item)}
              >
                {item === "all" ? "All" : item === "available" ? "Available" : "Checked out"}
              </button>
            ))}
          </div>
        </div>
        <input
          type="search"
          placeholder="Search books, authors, ISBNs"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {itemsError ? <div className="alert inline-alert">{itemsError}</div> : null}
        {itemsLoading ? <div className="notice inline-alert">Loading library items...</div> : null}

        <div className="library-grid">
          {filteredItems.map((item) => {
            const available = typeof item.availableCopies === "number" ? item.availableCopies : 0;
            const activeRequest = requestMap.get(item.id);
            const activeLoan = loanMap.get(item.id);
            const actionLabel = available > 0 ? "Reserve" : "Join waitlist";
            const actionType = available > 0 ? "reserve" : "waitlist";

            return (
              <article className="library-card" key={item.id}>
                <div className="library-card-header">
                  {item.coverUrl ? (
                    <img className="library-cover" src={item.coverUrl} alt={item.title} />
                  ) : (
                    <div className="library-cover placeholder">Cover</div>
                  )}
                  <div>
                    <div className="library-title">{item.title}</div>
                    {item.subtitle ? <div className="library-subtitle">{item.subtitle}</div> : null}
                    <div className="library-meta">
                      {(item.authors ?? []).join(", ") || "Unknown author"}
                    </div>
                    <div className="library-meta">{formatAvailability(item)}</div>
                  </div>
                </div>

                <div className="library-actions">
                  {activeLoan ? (
                    <button
                      className="btn btn-primary"
                      onClick={() => handleRequest(item, "return")}
                      disabled={actionBusy}
                    >
                      {actionBusy ? "Requesting..." : "Request return"}
                    </button>
                  ) : activeRequest ? (
                    <div className="pill">
                      {activeRequest.type === "waitlist"
                        ? "Waitlist pending"
                        : activeRequest.type === "return"
                          ? "Return pending"
                          : "Reservation pending"}
                    </div>
                  ) : (
                    <button
                      className="btn btn-primary"
                      onClick={() => handleRequest(item, actionType)}
                      disabled={actionBusy || !canRequest}
                    >
                      {actionBusy ? "Requesting..." : actionLabel}
                    </button>
                  )}
                  <button className="btn btn-ghost" onClick={() => setSearch(item.title)}>
                    View details
                  </button>
                </div>

                {item.description ? <p className="library-description">{item.description}</p> : null}
              </article>
            );
          })}
        </div>
      </section>

      {actionStatus ? <div className="notice inline-alert">{actionStatus}</div> : null}
      {requestsError ? <div className="alert inline-alert">{requestsError}</div> : null}
      {requestsLoading ? <div className="notice inline-alert">Loading your requests...</div> : null}

      <section className="lending-row">
        <div className="card card-3d lending-panel">
          <div className="card-title">Your requests</div>
          {requests.length === 0 ? (
            <div className="empty-state">No requests yet.</div>
          ) : (
            <div className="list">
              {requests.map((request) => (
                <div className="list-row" key={request.id}>
                  <div>
                    <div className="list-title">{request.itemTitle}</div>
                    <div className="list-meta">{request.type} · {request.status}</div>
                  </div>
                  <div className="list-right">
                    <div className="list-meta">
                      {formatMaybeTimestamp(request.requestedAt)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card card-3d lending-panel">
          <div className="card-title">Your loans</div>
          {loansError ? <div className="alert inline-alert">{loansError}</div> : null}
          {loansLoading ? <div className="notice inline-alert">Loading your loans...</div> : null}
          {!loansLoading && loans.length === 0 ? (
            <div className="empty-state">No active loans.</div>
          ) : (
            <div className="list">
              {loans.map((loan) => (
                <div className="list-row" key={loan.id}>
                  <div>
                    <div className="list-title">{loan.itemTitle}</div>
                    <div className="list-meta">{loan.status}</div>
                  </div>
                  <div className="list-right">
                    <div className="list-meta">
                      Due {formatMaybeTimestamp(loan.dueAt)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="card card-3d lending-donate">
        <div className="card-title">Donate a title</div>
        <p className="lending-copy">
          Submit an ISBN or share title details. Staff will confirm and add it to the library.
        </p>
        <div className="donation-grid">
          <label>
            ISBN
            <input
              type="text"
              value={donationIsbn}
              onChange={(event) => setDonationIsbn(event.target.value)}
              placeholder="ISBN-10 or ISBN-13"
            />
          </label>
          <label>
            Title
            <input
              type="text"
              value={donationTitle}
              onChange={(event) => setDonationTitle(event.target.value)}
              placeholder="Book or media title"
            />
          </label>
          <label>
            Author
            <input
              type="text"
              value={donationAuthor}
              onChange={(event) => setDonationAuthor(event.target.value)}
              placeholder="Author or creator"
            />
          </label>
          <label>
            Format
            <input
              type="text"
              value={donationFormat}
              onChange={(event) => setDonationFormat(event.target.value)}
              placeholder="Hardcover, DVD, zine"
            />
          </label>
          <label className="span-2">
            Notes
            <input
              type="text"
              value={donationNotes}
              onChange={(event) => setDonationNotes(event.target.value)}
              placeholder="Any condition notes or context"
            />
          </label>
        </div>
        {donationStatus ? <div className="notice inline-alert">{donationStatus}</div> : null}
        <button className="btn btn-primary" onClick={handleDonation} disabled={donationBusy}>
          {donationBusy ? "Submitting..." : "Submit donation"}
        </button>
      </section>

      {hasAdmin ? (
        <section className="card card-3d lending-admin">
          <div className="card-title">Staff import (ISBN CSV)</div>
          <p className="lending-copy">
            Paste one ISBN per line. This uses free metadata sources (Open Library and Google Books).
          </p>
          <label className="csv-upload">
            Upload CSV
            <input
              type="file"
              accept=".csv,text/csv,text/plain"
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                void handleCsvFile(file);
              }}
            />
          </label>
          <textarea
            className="csv-input"
            value={csvText}
            onChange={(event) => setCsvText(event.target.value)}
            placeholder="9781234567890"
          />
          {csvImportError ? <div className="alert inline-alert">{csvImportError}</div> : null}
          {csvImportStatus ? <div className="notice inline-alert">{csvImportStatus}</div> : null}
          <button className="btn btn-primary" onClick={handleCsvImport} disabled={csvImportBusy}>
            {csvImportBusy ? "Importing..." : "Import ISBNs"}
          </button>
        </section>
      ) : null}

      {isStaff ? (
        <section className="card card-3d lending-admin">
          <div className="card-title">Staff quick scan (ISBN)</div>
          <p className="lending-copy">
            Use a Bluetooth scanner and press Enter to add a single item. Requires the admin token.
          </p>
          <input
            type="text"
            value={scanIsbn}
            placeholder="Scan ISBN here"
            onChange={(event) => setScanIsbn(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void handleScanSubmit();
              }
            }}
          />
          {scanStatus ? <div className="notice inline-alert">{scanStatus}</div> : null}
          <button className="btn btn-primary" onClick={handleScanSubmit} disabled={scanBusy}>
            {scanBusy ? "Adding..." : "Add scanned ISBN"}
          </button>
        </section>
      ) : null}

      <TroubleshootingPanel
        lastReq={lastReq}
        curl={client.getLastCurl()}
        onStatus={(msg) => setCsvImportStatus(msg)}
      />
    </div>
  );
}

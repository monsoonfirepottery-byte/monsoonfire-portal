import type { Dispatch, SetStateAction } from "react";
import { buildLendingResearchSections, isDisallowedRetailCoverUrl } from "./lendingResearch";

export type LendingAdminItemRecord = {
  id: string;
  title: string;
  authorLine: string;
  isbn: string;
  isbn10: string;
  isbn13: string;
  mediaType: string;
  status: string;
  source: string;
  totalCopies: number;
  availableCopies: number;
  updatedAtMs: number;
  rawDoc: Record<string, unknown>;
};

export type LendingAdminItemDraft = {
  title: string;
  subtitle: string;
  authorsCsv: string;
  summary: string;
  description: string;
  publisher: string;
  publishedDate: string;
  isbn: string;
  mediaType: string;
  format: string;
  coverUrl: string;
  totalCopies: string;
  availableCopies: string;
  status: string;
  source: string;
  staffPick: boolean;
  staffRationale: string;
  subjectsCsv: string;
  techniquesCsv: string;
};

type Props = {
  busy: string;
  lendingAdminItemBusy: boolean;
  selectedAdminItem: LendingAdminItemRecord | null;
  lendingAdminItemDraft: LendingAdminItemDraft;
  setLendingAdminItemDraft: Dispatch<SetStateAction<LendingAdminItemDraft>>;
  handleLendingAdminResolveIsbn: () => Promise<void>;
  lendingAdminIsbnResolveBusy: boolean;
  lendingAdminIsbnResolveStatus: string;
  lendingAdminItemError: string;
  lendingAdminItemStatus: string;
  handleLendingAdminSave: () => Promise<boolean>;
  title?: string;
  note?: string;
  primaryActionLabel?: string;
  onCancel?: () => void;
  cancelLabel?: string;
  allowResetDraft?: boolean;
  onResetDraft?: () => void;
  showDeleteControls?: boolean;
  lendingAdminItemDeleteConfirmInput?: string;
  setLendingAdminItemDeleteConfirmInput?: Dispatch<SetStateAction<string>>;
  lendingAdminDeleteConfirmationPhrase?: string;
  handleLendingAdminDelete?: () => Promise<void>;
  testId?: string;
};

export default function LendingCatalogEditor({
  busy,
  lendingAdminItemBusy,
  selectedAdminItem,
  lendingAdminItemDraft,
  setLendingAdminItemDraft,
  handleLendingAdminResolveIsbn,
  lendingAdminIsbnResolveBusy,
  lendingAdminIsbnResolveStatus,
  lendingAdminItemError,
  lendingAdminItemStatus,
  handleLendingAdminSave,
  title,
  note,
  primaryActionLabel,
  onCancel,
  cancelLabel = "Cancel",
  allowResetDraft = false,
  onResetDraft,
  showDeleteControls = false,
  lendingAdminItemDeleteConfirmInput = "",
  setLendingAdminItemDeleteConfirmInput,
  lendingAdminDeleteConfirmationPhrase = "",
  handleLendingAdminDelete,
  testId,
}: Props) {
  const heading = title || (selectedAdminItem ? `Editing ${selectedAdminItem.title}` : "New library item");
  const saveLabel = primaryActionLabel || (selectedAdminItem ? "Save item" : "Create item");
  const deleteEnabled = Boolean(
    showDeleteControls &&
      selectedAdminItem &&
      setLendingAdminItemDeleteConfirmInput &&
      handleLendingAdminDelete
  );
  const researchSections = buildLendingResearchSections({
    title: lendingAdminItemDraft.title,
    authorsCsv: lendingAdminItemDraft.authorsCsv,
    isbn: lendingAdminItemDraft.isbn,
    mediaType: lendingAdminItemDraft.mediaType,
  });
  const hasRetailCoverWarning = isDisallowedRetailCoverUrl(lendingAdminItemDraft.coverUrl);

  return (
    <section className="staff-column" data-testid={testId}>
      <div className="staff-subtitle">{heading}</div>
      {note ? <div className="staff-note">{note}</div> : null}
      <label className="staff-field">
        Title
        <input
          type="text"
          value={lendingAdminItemDraft.title}
          onChange={(event) =>
            setLendingAdminItemDraft((prev) => ({ ...prev, title: event.target.value }))
          }
          disabled={Boolean(busy) || lendingAdminItemBusy}
        />
      </label>
      <label className="staff-field">
        Authors (comma/newline)
        <textarea
          value={lendingAdminItemDraft.authorsCsv}
          onChange={(event) =>
            setLendingAdminItemDraft((prev) => ({ ...prev, authorsCsv: event.target.value }))
          }
          disabled={Boolean(busy) || lendingAdminItemBusy}
        />
      </label>
      <div className="staff-actions-row">
        <label className="staff-field">
          ISBN
          <input
            type="text"
            value={lendingAdminItemDraft.isbn}
            onChange={(event) =>
              setLendingAdminItemDraft((prev) => ({ ...prev, isbn: event.target.value }))
            }
            disabled={Boolean(busy) || lendingAdminItemBusy || lendingAdminIsbnResolveBusy}
          />
        </label>
        <button
          type="button"
          className="btn btn-secondary btn-small"
          onClick={() => void handleLendingAdminResolveIsbn()}
          disabled={Boolean(busy) || lendingAdminItemBusy || lendingAdminIsbnResolveBusy}
        >
          {lendingAdminIsbnResolveBusy ? "Resolving..." : "Resolve ISBN"}
        </button>
      </div>
      <label className="staff-field">
        Subtitle
        <input
          type="text"
          value={lendingAdminItemDraft.subtitle}
          onChange={(event) =>
            setLendingAdminItemDraft((prev) => ({ ...prev, subtitle: event.target.value }))
          }
          disabled={Boolean(busy) || lendingAdminItemBusy}
        />
      </label>
      <label className="staff-field">
        Summary
        <textarea
          value={lendingAdminItemDraft.summary}
          onChange={(event) =>
            setLendingAdminItemDraft((prev) => ({ ...prev, summary: event.target.value }))
          }
          disabled={Boolean(busy) || lendingAdminItemBusy}
        />
        <span className="helper">Short member-facing synopsis shown first in the lending detail view.</span>
      </label>
      <label className="staff-field">
        Description
        <textarea
          value={lendingAdminItemDraft.description}
          onChange={(event) =>
            setLendingAdminItemDraft((prev) => ({ ...prev, description: event.target.value }))
          }
          disabled={Boolean(busy) || lendingAdminItemBusy}
        />
      </label>
      <label className="staff-field">
        <span>Why this title matters</span>
        <textarea
          value={lendingAdminItemDraft.staffRationale}
          onChange={(event) =>
            setLendingAdminItemDraft((prev) => ({ ...prev, staffRationale: event.target.value }))
          }
          disabled={Boolean(busy) || lendingAdminItemBusy}
        />
        <span className="helper">Optional staff rationale shown on shelf cards and in title detail.</span>
      </label>
      <label className="staff-field">
        <span>Staff pick</span>
        <button
          type="button"
          className={`btn btn-small ${lendingAdminItemDraft.staffPick ? "btn-secondary" : "btn-ghost"}`}
          onClick={() =>
            setLendingAdminItemDraft((prev) => ({ ...prev, staffPick: !prev.staffPick }))
          }
          disabled={Boolean(busy) || lendingAdminItemBusy}
        >
          {lendingAdminItemDraft.staffPick ? "Marked as staff pick" : "Mark as staff pick"}
        </button>
      </label>
      <div className="staff-actions-row">
        <label className="staff-field">
          Publisher
          <input
            type="text"
            value={lendingAdminItemDraft.publisher}
            onChange={(event) =>
              setLendingAdminItemDraft((prev) => ({ ...prev, publisher: event.target.value }))
            }
            disabled={Boolean(busy) || lendingAdminItemBusy}
          />
        </label>
        <label className="staff-field">
          Published date
          <input
            type="text"
            value={lendingAdminItemDraft.publishedDate}
            placeholder="YYYY-MM-DD"
            onChange={(event) =>
              setLendingAdminItemDraft((prev) => ({ ...prev, publishedDate: event.target.value }))
            }
            disabled={Boolean(busy) || lendingAdminItemBusy}
          />
        </label>
      </div>
      <div className="staff-actions-row">
        <label className="staff-field">
          Media type
          <input
            type="text"
            value={lendingAdminItemDraft.mediaType}
            onChange={(event) =>
              setLendingAdminItemDraft((prev) => ({ ...prev, mediaType: event.target.value }))
            }
            disabled={Boolean(busy) || lendingAdminItemBusy}
          />
        </label>
        <label className="staff-field">
          Status
          <select
            value={lendingAdminItemDraft.status}
            onChange={(event) =>
              setLendingAdminItemDraft((prev) => ({ ...prev, status: event.target.value }))
            }
            disabled={Boolean(busy) || lendingAdminItemBusy}
          >
            <option value="available">available</option>
            <option value="checked_out">checked_out</option>
            <option value="overdue">overdue</option>
            <option value="lost">lost</option>
            <option value="unavailable">unavailable</option>
            <option value="archived">archived</option>
          </select>
        </label>
        <label className="staff-field">
          Source
          <input
            type="text"
            value={lendingAdminItemDraft.source}
            onChange={(event) =>
              setLendingAdminItemDraft((prev) => ({ ...prev, source: event.target.value }))
            }
            disabled={Boolean(busy) || lendingAdminItemBusy}
          />
        </label>
      </div>
      <div className="staff-actions-row">
        <label className="staff-field">
          Total copies
          <input
            type="number"
            min={1}
            value={lendingAdminItemDraft.totalCopies}
            onChange={(event) =>
              setLendingAdminItemDraft((prev) => ({ ...prev, totalCopies: event.target.value }))
            }
            disabled={Boolean(busy) || lendingAdminItemBusy}
          />
        </label>
        <label className="staff-field">
          Available copies
          <input
            type="number"
            min={0}
            value={lendingAdminItemDraft.availableCopies}
            onChange={(event) =>
              setLendingAdminItemDraft((prev) => ({ ...prev, availableCopies: event.target.value }))
            }
            disabled={Boolean(busy) || lendingAdminItemBusy}
          />
        </label>
        <label className="staff-field">
          Format
          <input
            type="text"
            value={lendingAdminItemDraft.format}
            onChange={(event) =>
              setLendingAdminItemDraft((prev) => ({ ...prev, format: event.target.value }))
            }
            disabled={Boolean(busy) || lendingAdminItemBusy}
          />
        </label>
      </div>
      <label className="staff-field">
        Cover URL
        <input
          type="url"
          value={lendingAdminItemDraft.coverUrl}
          onChange={(event) =>
            setLendingAdminItemDraft((prev) => ({ ...prev, coverUrl: event.target.value }))
          }
          disabled={Boolean(busy) || lendingAdminItemBusy}
        />
        {hasRetailCoverWarning ? (
          <span className="helper">
            Retail-hosted cover URLs are blocked. Use approved catalog/community cover sources and keep retail pages as reference only.
          </span>
        ) : (
          <span className="helper">
            Safe covers come from approved catalog/community sources. Do not save retailer-hosted image URLs here.
          </span>
        )}
      </label>
      {researchSections.length > 0 ? (
        <div className="staff-field">
          <span>Research assist</span>
          <div className="staff-mini">
            Catalog/API links are safe lookup sources. Retail links are manual-reference only: capture factual metadata, not retailer copy, ratings, prices, or hosted images.
          </div>
          {researchSections.map((section) => (
            <div key={section.id}>
              <div className="staff-mini"><strong>{section.title}</strong></div>
              <div className="staff-mini">{section.policyNote}</div>
              <div className="staff-actions-row">
                {section.links.map((link) => (
                  <a
                    key={link.id}
                    className="btn btn-ghost btn-small"
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {link.label}
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <div className="staff-actions-row">
        <label className="staff-field">
          Subjects
          <input
            type="text"
            value={lendingAdminItemDraft.subjectsCsv}
            placeholder="glaze chemistry, kiln control"
            onChange={(event) =>
              setLendingAdminItemDraft((prev) => ({ ...prev, subjectsCsv: event.target.value }))
            }
            disabled={Boolean(busy) || lendingAdminItemBusy}
          />
        </label>
        <label className="staff-field">
          Techniques
          <input
            type="text"
            value={lendingAdminItemDraft.techniquesCsv}
            placeholder="wheel, handbuilding"
            onChange={(event) =>
              setLendingAdminItemDraft((prev) => ({ ...prev, techniquesCsv: event.target.value }))
            }
            disabled={Boolean(busy) || lendingAdminItemBusy}
          />
        </label>
      </div>
      <div className="staff-actions-row">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void handleLendingAdminSave()}
          disabled={Boolean(busy) || lendingAdminItemBusy}
        >
          {lendingAdminItemBusy ? "Saving..." : saveLabel}
        </button>
        {allowResetDraft && onResetDraft ? (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onResetDraft}
            disabled={Boolean(busy) || lendingAdminItemBusy}
          >
            Reset draft
          </button>
        ) : null}
        {onCancel ? (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onCancel}
            disabled={Boolean(busy) || lendingAdminItemBusy}
          >
            {cancelLabel}
          </button>
        ) : null}
      </div>
      {deleteEnabled ? (
        <>
          <label className="staff-field">
            Type <code>{lendingAdminDeleteConfirmationPhrase || "delete <itemId>"}</code> to enable delete
            <input
              type="text"
              value={lendingAdminItemDeleteConfirmInput}
              onChange={(event) => setLendingAdminItemDeleteConfirmInput?.(event.target.value)}
              disabled={Boolean(busy) || lendingAdminItemBusy}
            />
          </label>
          <div className="staff-actions-row">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void handleLendingAdminDelete?.()}
              disabled={Boolean(busy) || lendingAdminItemBusy}
            >
              {lendingAdminItemBusy ? "Deleting..." : "Delete item"}
            </button>
          </div>
        </>
      ) : null}
      {lendingAdminIsbnResolveStatus ? <div className="staff-note">{lendingAdminIsbnResolveStatus}</div> : null}
      {lendingAdminItemError ? <div className="staff-note staff-note-error">{lendingAdminItemError}</div> : null}
      {lendingAdminItemStatus ? <div className="staff-note staff-note-ok">{lendingAdminItemStatus}</div> : null}
    </section>
  );
}

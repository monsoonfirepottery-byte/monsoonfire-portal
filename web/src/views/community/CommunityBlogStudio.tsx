import { useEffect, useRef, useState, type ReactNode } from "react";
import type { User } from "firebase/auth";
import { connectStorageEmulator, getDownloadURL, getStorage, ref, uploadBytes } from "firebase/storage";

import type { FunctionsClient } from "../../api/functionsClient";
import {
  COMMUNITY_BLOGS_STAFF_AI_ASSIST_FN,
  COMMUNITY_BLOGS_STAFF_DELETE_FN,
  COMMUNITY_BLOGS_STAFF_LIST_SOURCES_FN,
  COMMUNITY_BLOGS_STAFF_LIST_FN,
  COMMUNITY_BLOGS_STAFF_PUBLISH_DISTRIBUTION_FN,
  COMMUNITY_BLOGS_STAFF_PREPARE_IMAGE_FN,
  COMMUNITY_BLOGS_STAFF_REFRESH_SOURCES_FN,
  COMMUNITY_BLOGS_STAFF_SET_EXTERNAL_FN,
  COMMUNITY_BLOGS_STAFF_SET_STATUS_FN,
  COMMUNITY_BLOGS_STAFF_UPSERT_SOURCE_FN,
  COMMUNITY_BLOGS_STAFF_UPSERT_FN,
  COMMUNITY_BLOG_AI_MODES,
  COMMUNITY_BLOG_MARKETING_OPTIONS,
  COMMUNITY_BLOG_TONE_OPTIONS,
  communityBlogMarketingFocusLabel,
  formatCommunityBlogDate,
  normalizeCommunityBlogChannelAvailability,
  normalizeCommunityBlogExternalHighlight,
  normalizeCommunityBlogSource,
  normalizeCommunityBlogStaffPost,
  parseCommunityBlogTagsInput,
  renderCommunityBlogPreview,
  sortCommunityBlogStaffPosts,
  type CommunityBlogAiMode,
  type CommunityBlogChannelAvailability,
  type CommunityBlogDistributionChannel,
  type CommunityBlogExternalHighlight,
  type CommunityBlogImage,
  type CommunityBlogMarketingFocus,
  type CommunityBlogSafety,
  type CommunityBlogSource,
  type CommunityBlogStaffPost,
  type CommunityBlogStatus,
  type CommunityBlogTonePreset,
} from "./communityBlogTypes";
import "./CommunityBlogs.css";

type Props = {
  client: FunctionsClient;
  user: User;
  active?: boolean;
  variant?: "community" | "staff";
  onPostsChanged?: () => void;
  onRequestClose?: () => void;
};

type StaffListResponse = {
  ok: boolean;
  message?: string;
  posts?: Array<Record<string, unknown>>;
  counts?: Partial<Record<CommunityBlogStatus, number>>;
  distributionAvailability?: Array<Record<string, unknown>>;
};

type StaffUpsertResponse = {
  ok: boolean;
  message?: string;
  post?: Record<string, unknown>;
};

type StaffStatusResponse = {
  ok: boolean;
  message?: string;
  post?: Record<string, unknown>;
  safety?: Record<string, unknown>;
};

type StaffDeleteResponse = {
  ok: boolean;
  message?: string;
  post?: Record<string, unknown>;
};

type PrepareImageResponse = {
  ok: boolean;
  message?: string;
  imageId?: string;
  storagePath?: string;
  maxBytes?: number;
  allowedContentTypes?: string[];
};

type AiSuggestion = {
  id: string;
  title: string;
  excerpt: string | null;
  bodyMarkdown: string | null;
  note: string | null;
};

type AiAssistResponse = {
  ok: boolean;
  available?: boolean;
  message?: string;
  mode?: CommunityBlogAiMode;
  suggestions?: Array<Record<string, unknown>>;
  model?: { provider?: string; version?: string } | null;
};

type SourceListResponse = {
  ok: boolean;
  message?: string;
  sources?: Array<Record<string, unknown>>;
  items?: Array<Record<string, unknown>>;
  distributionAvailability?: Array<Record<string, unknown>>;
};

type SourceUpsertResponse = {
  ok: boolean;
  message?: string;
  source?: Record<string, unknown>;
};

type SourceRefreshResponse = {
  ok: boolean;
  message?: string;
  sources?: Array<Record<string, unknown>>;
  items?: Array<Record<string, unknown>>;
};

type ExternalHighlightResponse = {
  ok: boolean;
  message?: string;
  item?: Record<string, unknown>;
};

type DistributionResponse = {
  ok: boolean;
  message?: string;
  post?: Record<string, unknown>;
  distributionAvailability?: Array<Record<string, unknown>>;
};

type EditorDraft = {
  postId: string | null;
  status: CommunityBlogStatus;
  title: string;
  slug: string;
  excerpt: string;
  bodyMarkdown: string;
  tagsInput: string;
  tonePreset: CommunityBlogTonePreset;
  marketingFocus: CommunityBlogMarketingFocus;
  featuredImage: CommunityBlogImage | null;
  inlineImages: CommunityBlogImage[];
  safety: CommunityBlogSafety | null;
  publishedAtMs: number;
  updatedAtMs: number;
  archivedAtMs: number | null;
  deletedAtMs: number | null;
  lastPublishOverrideReason: string;
  deletedReason: string;
};

const EMPTY_COUNTS: Record<CommunityBlogStatus, number> = {
  draft: 0,
  staged: 0,
  published: 0,
  archived: 0,
  deleted: 0,
};

const EMPTY_DRAFT: EditorDraft = {
  postId: null,
  status: "draft",
  title: "",
  slug: "",
  excerpt: "",
  bodyMarkdown: "",
  tagsInput: "",
  tonePreset: "studio_notes",
  marketingFocus: "studio-services",
  featuredImage: null,
  inlineImages: [],
  safety: null,
  publishedAtMs: 0,
  updatedAtMs: 0,
  archivedAtMs: null,
  deletedAtMs: null,
  lastPublishOverrideReason: "",
  deletedReason: "",
};

type SelectionSnapshot = {
  start: number;
  end: number;
  text: string;
};

type SourceDraft = {
  sourceId: string | null;
  title: string;
  feedUrl: string;
  siteUrl: string;
  summary: string;
  status: "enabled" | "disabled";
};

const EMPTY_SOURCE_DRAFT: SourceDraft = {
  sourceId: null,
  title: "",
  feedUrl: "",
  siteUrl: "",
  summary: "",
  status: "enabled",
};

type ImportMetaEnvShape = {
  VITE_USE_EMULATORS?: string;
  VITE_STORAGE_EMULATOR_HOST?: string;
  VITE_STORAGE_EMULATOR_PORT?: string;
};

const ENV = (import.meta.env ?? {}) as ImportMetaEnvShape;
let storageEmulatorConnected = false;

function sortLocalPosts(rows: CommunityBlogStaffPost[]): CommunityBlogStaffPost[] {
  return sortCommunityBlogStaffPosts(rows);
}

function draftFromPost(post: CommunityBlogStaffPost | null): EditorDraft {
  if (!post) return { ...EMPTY_DRAFT };
  return {
    postId: post.id,
    status: post.status,
    title: post.title,
    slug: post.slug,
    excerpt: post.excerpt,
    bodyMarkdown: post.bodyMarkdown,
    tagsInput: post.tags.join(", "),
    tonePreset: post.tonePreset,
    marketingFocus: post.marketingFocus,
    featuredImage: post.featuredImage,
    inlineImages: post.inlineImages,
    safety: post.safety,
    publishedAtMs: post.publishedAtMs,
    updatedAtMs: post.updatedAtMs,
    archivedAtMs: post.archivedAtMs,
    deletedAtMs: post.deletedAtMs,
    lastPublishOverrideReason: post.lastPublishOverrideReason ?? "",
    deletedReason: post.deletedReason ?? "",
  };
}

function draftFingerprint(draft: EditorDraft): string {
  return JSON.stringify({
    postId: draft.postId,
    title: draft.title,
    slug: draft.slug,
    excerpt: draft.excerpt,
    bodyMarkdown: draft.bodyMarkdown,
    tagsInput: draft.tagsInput,
    tonePreset: draft.tonePreset,
    marketingFocus: draft.marketingFocus,
    featuredImage: draft.featuredImage,
    inlineImages: draft.inlineImages,
    lastPublishOverrideReason: draft.lastPublishOverrideReason,
    deletedReason: draft.deletedReason,
  });
}

function mergePost(rows: CommunityBlogStaffPost[], next: CommunityBlogStaffPost): CommunityBlogStaffPost[] {
  const filtered = rows.filter((row) => row.id !== next.id);
  return sortLocalPosts([next, ...filtered]);
}

function mergeSource(rows: CommunityBlogSource[], next: CommunityBlogSource): CommunityBlogSource[] {
  const filtered = rows.filter((row) => row.id !== next.id);
  return [...filtered, next].sort((a, b) => b.updatedAtMs - a.updatedAtMs);
}

function mergeExternalItem(rows: CommunityBlogExternalHighlight[], next: CommunityBlogExternalHighlight): CommunityBlogExternalHighlight[] {
  const filtered = rows.filter((row) => row.id !== next.id);
  return [...filtered, next].sort((a, b) => {
    const aKey = a.publishedAtMs || a.updatedAtMs || a.importedAtMs;
    const bKey = b.publishedAtMs || b.updatedAtMs || b.importedAtMs;
    return bKey - aKey;
  });
}

function makeImageAltFromFile(fileName: string, title: string): string {
  const base = fileName.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
  return base || title.trim() || "Blog image";
}

function replaceImageAltInMarkdown(markdown: string, url: string, nextAlt: string): string {
  const escapedUrl = url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`!\\[[^\\]]*\\]\\(${escapedUrl}\\)`);
  return markdown.replace(regex, `![${nextAlt}](${url})`);
}

function removeImageFromMarkdown(markdown: string, url: string): string {
  const escapedUrl = url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return markdown.replace(new RegExp(`\\n*!\\[[^\\]]*\\]\\(${escapedUrl}\\)\\n*`, "g"), "\n\n");
}

function normalizeAiSuggestions(rows: Array<Record<string, unknown>> | undefined): AiSuggestion[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((entry, index) => ({
    id: typeof entry.id === "string" ? entry.id : `ai-${index + 1}`,
    title: typeof entry.title === "string" ? entry.title : `Suggestion ${index + 1}`,
    excerpt: typeof entry.excerpt === "string" && entry.excerpt.trim() ? entry.excerpt.trim() : null,
    bodyMarkdown: typeof entry.bodyMarkdown === "string" && entry.bodyMarkdown.trim() ? entry.bodyMarkdown : null,
    note: typeof entry.note === "string" && entry.note.trim() ? entry.note.trim() : null,
  }));
}

function connectBlogStorageEmulatorIfNeeded() {
  const storage = getStorage();
  if (typeof import.meta !== "undefined" && ENV.VITE_USE_EMULATORS === "true" && !storageEmulatorConnected) {
    const host = String(ENV.VITE_STORAGE_EMULATOR_HOST || "127.0.0.1");
    const port = Number(ENV.VITE_STORAGE_EMULATOR_PORT || 9199);
    connectStorageEmulator(storage, host, port);
    storageEmulatorConnected = true;
  }
  return storage;
}

async function readImageDimensions(file: File): Promise<{ width: number; height: number } | null> {
  if (typeof Image === "undefined" || typeof URL === "undefined") return null;
  return await new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Unable to read image dimensions."));
    };
    image.src = objectUrl;
  });
}

function setTextAtSelection(current: string, start: number, end: number, next: string) {
  return `${current.slice(0, start)}${next}${current.slice(end)}`;
}

function statusLabel(value: CommunityBlogStatus): string {
  return value.replace("_", " ");
}

function confirmDiscard(isDirty: boolean): boolean {
  if (!isDirty || typeof window === "undefined") return true;
  return window.confirm("Discard unsaved blog edits?");
}

export default function CommunityBlogStudio({
  client,
  user,
  active = true,
  variant = "staff",
  onPostsChanged,
  onRequestClose,
}: Props) {
  const isCommunityVariant = variant === "community";
  const [posts, setPosts] = useState<CommunityBlogStaffPost[]>([]);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditorDraft>({ ...EMPTY_DRAFT });
  const [busyKey, setBusyKey] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | CommunityBlogStatus>("all");
  const [previewOpen, setPreviewOpen] = useState(!isCommunityVariant);
  const [libraryOpen, setLibraryOpen] = useState(!isCommunityVariant);
  const [detailsOpen, setDetailsOpen] = useState(!isCommunityVariant);
  const [mediaOpen, setMediaOpen] = useState(!isCommunityVariant);
  const [distributionOpen, setDistributionOpen] = useState(!isCommunityVariant);
  const [sourcesOpen, setSourcesOpen] = useState(!isCommunityVariant);
  const [aiOpen, setAiOpen] = useState(!isCommunityVariant);
  const [aiMode, setAiMode] = useState<CommunityBlogAiMode>("topic_ideas");
  const [aiMessage, setAiMessage] = useState("");
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<AiSuggestion[]>([]);
  const [aiModelLabel, setAiModelLabel] = useState("");
  const [distributionCaption, setDistributionCaption] = useState("");
  const [distributionAvailability, setDistributionAvailability] = useState<CommunityBlogChannelAvailability[]>([]);
  const [sources, setSources] = useState<CommunityBlogSource[]>([]);
  const [externalItems, setExternalItems] = useState<CommunityBlogExternalHighlight[]>([]);
  const [sourceDraft, setSourceDraft] = useState<SourceDraft>({ ...EMPTY_SOURCE_DRAFT });
  const [selectionSnapshot, setSelectionSnapshot] = useState<SelectionSnapshot | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const selectedPostIdRef = useRef<string | null>(null);
  const bodyInputRef = useRef<HTMLTextAreaElement | null>(null);
  const featuredInputRef = useRef<HTMLInputElement | null>(null);
  const inlineInputRef = useRef<HTMLInputElement | null>(null);

  const selectedSavedPost = posts.find((post) => post.id === selectedPostId) ?? null;
  const counts = posts.reduce<Record<CommunityBlogStatus, number>>(
    (acc, post) => {
      acc[post.status] += 1;
      return acc;
    },
    { ...EMPTY_COUNTS }
  );
  const isDirty = draftFingerprint(draft) !== draftFingerprint(draftFromPost(selectedSavedPost));
  const filteredPosts =
    filterStatus === "all" ? posts.filter((post) => post.status !== "deleted") : posts.filter((post) => post.status === filterStatus);
  const previewHtml = renderCommunityBlogPreview(draft.bodyMarkdown);
  const canStageOrPublish = draft.title.trim().length > 0 && draft.bodyMarkdown.trim().length > 0;
  const distributionAvailabilityByChannel = distributionAvailability.reduce<
    Partial<Record<CommunityBlogDistributionChannel, CommunityBlogChannelAvailability>>
  >((acc, entry) => {
    acc[entry.channel] = entry;
    return acc;
  }, {});

  useEffect(() => {
    selectedPostIdRef.current = selectedPostId;
  }, [selectedPostId]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    async function load() {
      setBusyKey("refresh");
      setError("");
      try {
        const [response, sourceResponse] = await Promise.all([
          client.postJson<StaffListResponse>(COMMUNITY_BLOGS_STAFF_LIST_FN, {
            includeDeleted: true,
            limit: 120,
          }),
          client.postJson<SourceListResponse>(COMMUNITY_BLOGS_STAFF_LIST_SOURCES_FN, {
            includeDisabled: true,
            limit: 30,
          }),
        ]);
        if (!response.ok) {
          if (!cancelled) setError(response.message ?? "Could not load blogs.");
          return;
        }
        const nextPosts = sortLocalPosts(
          Array.isArray(response.posts)
            ? response.posts.map((row) => normalizeCommunityBlogStaffPost(row))
            : []
        );
        if (cancelled) return;
        setPosts(nextPosts);
        setDistributionAvailability(
          Array.isArray(response.distributionAvailability)
            ? response.distributionAvailability.map((row) => normalizeCommunityBlogChannelAvailability(row))
            : Array.isArray(sourceResponse.distributionAvailability)
              ? sourceResponse.distributionAvailability.map((row) => normalizeCommunityBlogChannelAvailability(row))
              : []
        );
        setSources(
          Array.isArray(sourceResponse.sources)
            ? sourceResponse.sources.map((row) => normalizeCommunityBlogSource(row)).filter((row) => row.id)
            : []
        );
        setExternalItems(
          Array.isArray(sourceResponse.items)
            ? sourceResponse.items.map((row) => normalizeCommunityBlogExternalHighlight(row)).filter((row) => row.id)
            : []
        );
        const nextSelected =
          nextPosts.find((post) => post.id === selectedPostIdRef.current) ??
          nextPosts.find((post) => post.status !== "deleted") ??
          nextPosts[0] ??
          null;
        setSelectedPostId(nextSelected?.id ?? null);
        setDraft(draftFromPost(nextSelected));
      } catch (nextError: unknown) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : String(nextError));
        }
      } finally {
        if (!cancelled) setBusyKey("");
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [active, client, reloadKey]);

  function updateDraft(next: Partial<EditorDraft>) {
    setDraft((prev) => ({ ...prev, ...next }));
  }

  function updateSourceDraft(next: Partial<SourceDraft>) {
    setSourceDraft((prev) => ({ ...prev, ...next }));
  }

  function openNewDraft() {
    if (!confirmDiscard(isDirty)) return;
    setSelectedPostId(null);
    setDraft({ ...EMPTY_DRAFT });
    setDistributionCaption("");
    setStatus("New draft ready.");
    setError("");
    setAiSuggestions([]);
    setAiMessage("");
  }

  function openExistingPost(post: CommunityBlogStaffPost) {
    if (!confirmDiscard(isDirty)) return;
    setSelectedPostId(post.id);
    setDraft(draftFromPost(post));
    setDistributionCaption("");
    setStatus("");
    setError("");
    setAiSuggestions([]);
    setAiMessage("");
  }

  function openSource(source: CommunityBlogSource) {
    setSourceDraft({
      sourceId: source.id,
      title: source.title,
      feedUrl: source.feedUrl,
      siteUrl: source.siteUrl ?? "",
      summary: source.summary ?? "",
      status: source.status,
    });
    setStatus(`Loaded source "${source.title}".`);
    setError("");
  }

  async function saveSource() {
    if (!sourceDraft.title.trim() || !sourceDraft.feedUrl.trim()) {
      setError("Add a source title and feed URL first.");
      return;
    }
    setBusyKey("save-source");
    setError("");
    setStatus("");
    try {
      const response = await client.postJson<SourceUpsertResponse>(COMMUNITY_BLOGS_STAFF_UPSERT_SOURCE_FN, {
        sourceId: sourceDraft.sourceId ?? undefined,
        title: sourceDraft.title.trim(),
        feedUrl: sourceDraft.feedUrl.trim(),
        siteUrl: sourceDraft.siteUrl.trim() || null,
        summary: sourceDraft.summary.trim() || null,
        status: sourceDraft.status,
      });
      if (!response.ok || !response.source) {
        setError(response.message ?? "Could not save the source.");
        return;
      }
      const saved = normalizeCommunityBlogSource(response.source);
      setSources((prev) => mergeSource(prev, saved));
      setSourceDraft({
        sourceId: saved.id,
        title: saved.title,
        feedUrl: saved.feedUrl,
        siteUrl: saved.siteUrl ?? "",
        summary: saved.summary ?? "",
        status: saved.status,
      });
      setStatus(response.message ?? "Source saved.");
    } catch (nextError: unknown) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusyKey("");
    }
  }

  async function refreshSources(sourceId?: string) {
    setBusyKey(sourceId ? `refresh-source:${sourceId}` : "refresh-sources");
    setError("");
    setStatus("");
    try {
      const response = await client.postJson<SourceRefreshResponse>(COMMUNITY_BLOGS_STAFF_REFRESH_SOURCES_FN, {
        sourceId: sourceId ?? null,
      });
      if (!response.ok) {
        setError(response.message ?? "Could not refresh sources.");
        return;
      }
      if (Array.isArray(response.sources)) {
        const normalized = response.sources.map((row) => normalizeCommunityBlogSource(row)).filter((row) => row.id);
        setSources((prev) => normalized.reduce((acc, entry) => mergeSource(acc, entry), prev));
      }
      if (Array.isArray(response.items)) {
        const normalizedItems = response.items.map((row) => normalizeCommunityBlogExternalHighlight(row)).filter((row) => row.id);
        setExternalItems((prev) => normalizedItems.reduce((acc, entry) => mergeExternalItem(acc, entry), prev));
      }
      setStatus(response.message ?? "Sources refreshed.");
    } catch (nextError: unknown) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusyKey("");
    }
  }

  async function setExternalItemStatus(item: CommunityBlogExternalHighlight, statusValue: CommunityBlogExternalHighlight["status"]) {
    setBusyKey(`external:${item.id}`);
    setError("");
    setStatus("");
    try {
      const response = await client.postJson<ExternalHighlightResponse>(COMMUNITY_BLOGS_STAFF_SET_EXTERNAL_FN, {
        itemId: item.id,
        status: statusValue,
        studioNote: item.studioNote ?? null,
      });
      if (!response.ok || !response.item) {
        setError(response.message ?? "Could not update the external highlight.");
        return;
      }
      const saved = normalizeCommunityBlogExternalHighlight(response.item);
      setExternalItems((prev) => mergeExternalItem(prev, saved));
      setStatus(response.message ?? "External highlight updated.");
    } catch (nextError: unknown) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusyKey("");
    }
  }

  async function publishDistribution(channels: CommunityBlogDistributionChannel[]) {
    const saved = await saveDraft(true);
    if (!saved) return;
    if (saved.status !== "published") {
      setError("Publish the post before sending it to connected channels.");
      return;
    }
    setBusyKey(`distribution:${channels.join(",")}`);
    setError("");
    setStatus("");
    try {
      const response = await client.postJson<DistributionResponse>(COMMUNITY_BLOGS_STAFF_PUBLISH_DISTRIBUTION_FN, {
        postId: saved.id,
        channels,
        captionOverride: distributionCaption.trim() || null,
      });
      if (!response.ok || !response.post) {
        setError(response.message ?? "Could not publish distribution.");
        return;
      }
      const nextPost = normalizeCommunityBlogStaffPost(response.post);
      setPosts((prev) => mergePost(prev, nextPost));
      setSelectedPostId(nextPost.id);
      setDraft(draftFromPost(nextPost));
      setDistributionAvailability(
        Array.isArray(response.distributionAvailability)
          ? response.distributionAvailability.map((row) => normalizeCommunityBlogChannelAvailability(row))
          : distributionAvailability
      );
      setStatus(response.message ?? "Distribution update complete.");
      onPostsChanged?.();
    } catch (nextError: unknown) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusyKey("");
    }
  }

  function validateDraft(): string | null {
    if (!draft.title.trim()) return "Add a title before saving.";
    if (draft.featuredImage && !draft.featuredImage.alt.trim()) return "Featured images need alt text.";
    if (draft.inlineImages.some((image) => !image.alt.trim())) return "Inline images need alt text.";
    return null;
  }

  async function saveDraft(quiet = false): Promise<CommunityBlogStaffPost | null> {
    const validationError = validateDraft();
    if (validationError) {
      setError(validationError);
      return null;
    }

    setBusyKey("save");
    setError("");
    if (!quiet) setStatus("");
    try {
      const response = await client.postJson<StaffUpsertResponse>(COMMUNITY_BLOGS_STAFF_UPSERT_FN, {
        postId: draft.postId ?? undefined,
        title: draft.title.trim(),
        slug: draft.slug.trim() || undefined,
        excerpt: draft.excerpt.trim() || null,
        bodyMarkdown: draft.bodyMarkdown,
        featuredImage: draft.featuredImage,
        inlineImages: draft.inlineImages,
        tags: parseCommunityBlogTagsInput(draft.tagsInput),
        tonePreset: draft.tonePreset,
        marketingFocus: draft.marketingFocus,
      });
      if (!response.ok || !response.post) {
        setError(response.message ?? "Could not save draft.");
        return null;
      }
      const saved = normalizeCommunityBlogStaffPost(response.post);
      setPosts((prev) => mergePost(prev, saved));
      setSelectedPostId(saved.id);
      setDraft(draftFromPost(saved));
      setStatus(response.message ?? "Draft saved.");
      onPostsChanged?.();
      return saved;
    } catch (nextError: unknown) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
      return null;
    } finally {
      setBusyKey("");
    }
  }

  async function saveAndChangeStatus(nextStatus: "draft" | "staged" | "published" | "archived") {
    const saved = await saveDraft(true);
    if (!saved) return;
    if (nextStatus === "draft" && saved.status === "draft") {
      setStatus("Draft saved.");
      return;
    }

    setBusyKey(nextStatus);
    setError("");
    setStatus("");
    try {
      const response = await client.postJson<StaffStatusResponse>(COMMUNITY_BLOGS_STAFF_SET_STATUS_FN, {
        postId: saved.id,
        status: nextStatus,
        overrideReason: draft.lastPublishOverrideReason.trim() || null,
      });
      if (!response.ok || !response.post) {
        setError(response.message ?? `Could not move post to ${nextStatus}.`);
        return;
      }
      const nextPost = normalizeCommunityBlogStaffPost(response.post);
      setPosts((prev) => mergePost(prev, nextPost));
      setSelectedPostId(nextPost.id);
      setDraft(draftFromPost(nextPost));
      setStatus(response.message ?? `Post moved to ${nextStatus}.`);
      onPostsChanged?.();
    } catch (nextError: unknown) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusyKey("");
    }
  }

  async function deletePost() {
    if (!draft.postId) return;
    if (typeof window !== "undefined" && !window.confirm("Delete this blog? It will be removed from portal and website feeds.")) {
      return;
    }
    setBusyKey("delete");
    setError("");
    setStatus("");
    try {
      const response = await client.postJson<StaffDeleteResponse>(COMMUNITY_BLOGS_STAFF_DELETE_FN, {
        postId: draft.postId,
        reason: draft.deletedReason.trim() || null,
      });
      if (!response.ok || !response.post) {
        setError(response.message ?? "Could not delete post.");
        return;
      }
      const nextPost = normalizeCommunityBlogStaffPost(response.post);
      setPosts((prev) => mergePost(prev, nextPost));
      setSelectedPostId(nextPost.id);
      setDraft(draftFromPost(nextPost));
      setStatus(response.message ?? "Post deleted.");
      onPostsChanged?.();
    } catch (nextError: unknown) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusyKey("");
    }
  }

  function insertMarkup(before: string, after = "", fallback = "") {
    const textarea = bodyInputRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart ?? draft.bodyMarkdown.length;
    const end = textarea.selectionEnd ?? start;
    const selected = draft.bodyMarkdown.slice(start, end) || fallback;
    const insertion = `${before}${selected}${after}`;
    updateDraft({
      bodyMarkdown: setTextAtSelection(draft.bodyMarkdown, start, end, insertion),
    });
    setSelectionSnapshot({ start, end: start + insertion.length, text: selected });
  }

  async function uploadImage(file: File, placement: "featured" | "inline") {
    setBusyKey(placement === "featured" ? "upload-featured" : "upload-inline");
    setError("");
    setStatus("");
    try {
      const prep = await client.postJson<PrepareImageResponse>(COMMUNITY_BLOGS_STAFF_PREPARE_IMAGE_FN, {
        postId: draft.postId,
        fileName: file.name,
        contentType: file.type || null,
      });
      if (!prep.ok || !prep.imageId || !prep.storagePath) {
        setError(prep.message ?? "Could not prepare upload.");
        return;
      }
      const storage = connectBlogStorageEmulatorIfNeeded();
      const uploadRef = ref(storage, prep.storagePath);
      await uploadBytes(uploadRef, file, { contentType: file.type || "image/jpeg" });
      const url = await getDownloadURL(uploadRef);
      const dimensions = await readImageDimensions(file).catch(() => null);
      const image: CommunityBlogImage = {
        id: prep.imageId,
        url,
        path: prep.storagePath,
        alt: makeImageAltFromFile(file.name, draft.title),
        caption: null,
        width: dimensions?.width ?? null,
        height: dimensions?.height ?? null,
        uploadedAtMs: Date.now(),
        uploadedByUid: user.uid,
      };
      if (placement === "featured") {
        updateDraft({ featuredImage: image });
        setStatus("Featured image uploaded.");
      } else {
        const nextImages = [...draft.inlineImages, image];
        const textarea = bodyInputRef.current;
        const start = textarea?.selectionStart ?? draft.bodyMarkdown.length;
        const end = textarea?.selectionEnd ?? start;
        const snippet = `\n\n![${image.alt}](${image.url})\n\n`;
        updateDraft({
          inlineImages: nextImages,
          bodyMarkdown: setTextAtSelection(draft.bodyMarkdown, start, end, snippet),
        });
        setSelectionSnapshot({ start, end: start + snippet.length, text: snippet });
        setStatus("Inline image uploaded and inserted.");
      }
    } catch (nextError: unknown) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusyKey("");
      if (featuredInputRef.current) featuredInputRef.current.value = "";
      if (inlineInputRef.current) inlineInputRef.current.value = "";
    }
  }

  async function runAiAssist() {
    setBusyKey("ai");
    setError("");
    setAiMessage("");
    const textarea = bodyInputRef.current;
    const start = textarea?.selectionStart ?? 0;
    const end = textarea?.selectionEnd ?? 0;
    const selectedText = start !== end ? draft.bodyMarkdown.slice(start, end) : "";
    setSelectionSnapshot(selectedText ? { start, end, text: selectedText } : null);

    try {
      const response = await client.postJson<AiAssistResponse>(COMMUNITY_BLOGS_STAFF_AI_ASSIST_FN, {
        mode: aiMode,
        title: draft.title || null,
        excerpt: draft.excerpt || null,
        bodyMarkdown: draft.bodyMarkdown || null,
        selectedText: selectedText || null,
        tonePreset: draft.tonePreset,
        marketingFocus: draft.marketingFocus,
        tags: parseCommunityBlogTagsInput(draft.tagsInput),
        count: 3,
      });
      if (!response.ok) {
        setAiAvailable(false);
        setAiMessage(response.message ?? "AI assist failed.");
        setAiSuggestions([]);
        return;
      }
      setAiAvailable(response.available !== false);
      setAiMessage(response.message ?? (response.available === false ? "AI assist unavailable." : "Suggestions ready."));
      setAiModelLabel(response.model?.version ? `${response.model.provider ?? "AI"} · ${response.model.version}` : "");
      setAiSuggestions(normalizeAiSuggestions(response.suggestions));
    } catch (nextError: unknown) {
      setAiAvailable(false);
      setAiSuggestions([]);
      setAiMessage(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusyKey("");
    }
  }

  function applyAiSuggestion(suggestion: AiSuggestion) {
    if (aiMode === "social_copy") {
      setDistributionCaption(suggestion.bodyMarkdown ?? suggestion.excerpt ?? suggestion.title);
      setStatus("Loaded the AI social caption into the distribution box.");
      return;
    }
    if (aiMode === "cta_angle") {
      updateDraft({
        excerpt: suggestion.excerpt ?? draft.excerpt,
      });
      setStatus("Applied the CTA angle to the excerpt.");
      return;
    }
    if (aiMode === "title_excerpt") {
      updateDraft({
        title: suggestion.title || draft.title,
        excerpt: suggestion.excerpt ?? draft.excerpt,
        bodyMarkdown: suggestion.bodyMarkdown ?? draft.bodyMarkdown,
      });
      setStatus("Applied title/excerpt suggestion.");
      return;
    }
    if (aiMode === "tone_rewrite" && suggestion.bodyMarkdown) {
      if (selectionSnapshot?.text) {
        updateDraft({
          bodyMarkdown: setTextAtSelection(draft.bodyMarkdown, selectionSnapshot.start, selectionSnapshot.end, suggestion.bodyMarkdown),
        });
        setStatus("Replaced the selected draft text.");
      } else {
        updateDraft({ bodyMarkdown: suggestion.bodyMarkdown });
        setStatus("Replaced the draft body with the AI rewrite.");
      }
      return;
    }
    updateDraft({
      title: suggestion.title || draft.title,
      excerpt: suggestion.excerpt ?? draft.excerpt,
      bodyMarkdown: suggestion.bodyMarkdown ?? draft.bodyMarkdown,
    });
    setStatus("Applied AI suggestion.");
  }

  function requestClose() {
    if (!confirmDiscard(isDirty)) return;
    onRequestClose?.();
  }

  function renderExpandableCard(options: {
    title: string;
    description: string;
    open: boolean;
    toggle: () => void;
    children: ReactNode;
  }) {
    return (
      <section className={`community-blog-collapsible-card ${options.open ? "open" : ""}`}>
        <div className="community-blog-collapsible-head">
          <div>
            <strong>{options.title}</strong>
            <div className="staff-mini">{options.description}</div>
          </div>
          <button
            type="button"
            className={`btn btn-ghost btn-small community-blog-workspace-toggle ${options.open ? "active" : ""}`}
            onClick={options.toggle}
            aria-expanded={options.open}
          >
            {options.open ? "Hide" : "Show"}
          </button>
        </div>
        {options.open ? <div className="community-blog-collapsible-body">{options.children}</div> : null}
      </section>
    );
  }

  const detailFields = (
    <>
      <label className="staff-field">
        Slug
        <input
          value={draft.slug}
          onChange={(event) => updateDraft({ slug: event.target.value })}
          placeholder="optional-custom-slug"
        />
      </label>
      <label className="staff-field">
        Tone
        <select
          value={draft.tonePreset}
          onChange={(event) => updateDraft({ tonePreset: event.target.value as CommunityBlogTonePreset })}
        >
          {COMMUNITY_BLOG_TONE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <div className="staff-mini">
          {COMMUNITY_BLOG_TONE_OPTIONS.find((option) => option.value === draft.tonePreset)?.help}
        </div>
      </label>
      <label className="staff-field">
        Marketing focus
        <select
          value={draft.marketingFocus}
          onChange={(event) => updateDraft({ marketingFocus: event.target.value as CommunityBlogMarketingFocus })}
        >
          {COMMUNITY_BLOG_MARKETING_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <div className="staff-mini">
          {COMMUNITY_BLOG_MARKETING_OPTIONS.find((option) => option.value === draft.marketingFocus)?.help}
        </div>
      </label>
      <label className="staff-field community-blog-field-wide">
        Tags
        <input
          value={draft.tagsInput}
          onChange={(event) => updateDraft({ tagsInput: event.target.value })}
          placeholder="kiln, glaze, production"
        />
        <div className="staff-mini">Comma-separated. Up to 8 tags.</div>
      </label>
    </>
  );

  const mediaContent = (
    <div className="community-blog-media-grid">
      <section className="community-blog-media-card">
        <div className="community-blog-media-head">
          <strong>Featured image</strong>
          <button type="button" className="btn btn-ghost btn-small" onClick={() => featuredInputRef.current?.click()}>
            Upload
          </button>
          <input
            ref={featuredInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void uploadImage(file, "featured");
              }
            }}
          />
        </div>
        {draft.featuredImage ? (
          <div className="community-blog-image-editor">
            <img src={draft.featuredImage.url} alt={draft.featuredImage.alt} />
            <label className="staff-field">
              Alt text
              <input
                value={draft.featuredImage.alt}
                onChange={(event) =>
                  updateDraft({
                    featuredImage: {
                      ...draft.featuredImage!,
                      alt: event.target.value,
                    },
                  })
                }
              />
            </label>
            <label className="staff-field">
              Caption
              <input
                value={draft.featuredImage.caption ?? ""}
                onChange={(event) =>
                  updateDraft({
                    featuredImage: {
                      ...draft.featuredImage!,
                      caption: event.target.value || null,
                    },
                  })
                }
              />
            </label>
          </div>
        ) : (
          <div className="staff-note">No featured image yet.</div>
        )}
      </section>

      <section className="community-blog-media-card">
        <div className="community-blog-media-head">
          <strong>Inline images</strong>
          <button type="button" className="btn btn-ghost btn-small" onClick={() => inlineInputRef.current?.click()}>
            Upload
          </button>
          <input
            ref={inlineInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void uploadImage(file, "inline");
              }
            }}
          />
        </div>
        <div className="community-blog-inline-list">
          {draft.inlineImages.length === 0 ? (
            <div className="staff-note">Inline images will also be inserted into the body.</div>
          ) : (
            draft.inlineImages.map((image) => (
              <div className="community-blog-inline-item" key={image.id}>
                <img src={image.url} alt={image.alt} />
                <label className="staff-field">
                  Alt text
                  <input
                    value={image.alt}
                    onChange={(event) =>
                      updateDraft({
                        inlineImages: draft.inlineImages.map((entry) =>
                          entry.id === image.id ? { ...entry, alt: event.target.value } : entry
                        ),
                        bodyMarkdown: replaceImageAltInMarkdown(draft.bodyMarkdown, image.url, event.target.value),
                      })
                    }
                  />
                </label>
                <div className="community-blog-inline-actions">
                  <button
                    type="button"
                    className="btn btn-ghost btn-small"
                    onClick={() =>
                      updateDraft({
                        inlineImages: draft.inlineImages.filter((entry) => entry.id !== image.id),
                        bodyMarkdown: removeImageFromMarkdown(draft.bodyMarkdown, image.url),
                      })
                    }
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );

  const distributionSection = (
    <section className="community-blog-ai community-blog-distribution">
      <div className="community-blog-ai-head">
        <div>
          <strong>Distribution</strong>
          <div className="staff-mini">Push published posts to connected channels without leaving the studio.</div>
        </div>
        <div className="community-blog-tag-list">
          <span className="community-blog-tag">{communityBlogMarketingFocusLabel(draft.marketingFocus)}</span>
        </div>
      </div>
      <label className="staff-field community-blog-field-wide">
        Social caption override
        <textarea
          value={distributionCaption}
          onChange={(event) => setDistributionCaption(event.target.value)}
          placeholder="Optional custom caption. Leave blank to use the generated post summary."
        />
      </label>
      <div className="community-blog-channel-list">
        {(["facebook_page", "instagram_business"] as CommunityBlogDistributionChannel[]).map((channel) => {
          const availability = distributionAvailabilityByChannel[channel];
          const currentStatus = selectedSavedPost?.distributions[channel] ?? null;
          const disabled =
            !draft.postId ||
            draft.status !== "published" ||
            Boolean(busyKey) ||
            availability?.available === false ||
            (channel === "instagram_business" && !draft.featuredImage && draft.inlineImages.length === 0);
          return (
            <article className="community-blog-channel-card" key={channel}>
              <div className="community-blog-channel-head">
                <strong>{channel === "facebook_page" ? "Facebook Page" : "Instagram Business"}</strong>
                <span className={`community-blog-status-chip status-${currentStatus?.status ?? "draft"}`}>
                  {currentStatus?.status ?? "idle"}
                </span>
              </div>
              <div className="staff-mini">
                {currentStatus?.message || availability?.reason || "Ready when the post is published."}
              </div>
              {currentStatus?.publishedAtMs ? (
                <div className="staff-mini">Last sent {formatCommunityBlogDate(currentStatus.publishedAtMs)}</div>
              ) : null}
              <div className="community-blog-channel-actions">
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  onClick={() => void publishDistribution([channel])}
                  disabled={disabled}
                >
                  {busyKey === `distribution:${channel}` ? "Sending..." : "Send now"}
                </button>
                {currentStatus?.permalinkUrl ? (
                  <a className="btn btn-ghost btn-small" href={currentStatus.permalinkUrl} target="_blank" rel="noreferrer">
                    Open post
                  </a>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );

  const sourcesSection = (
    <section className="community-blog-ai community-blog-source-manager">
      <div className="community-blog-ai-head">
        <div>
          <strong>Outside feeds</strong>
          <div className="staff-mini">Add studio-adjacent blogs or RSS feeds and surface the strongest reads.</div>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-small"
          onClick={() => void refreshSources()}
          disabled={busyKey === "refresh-sources"}
        >
          {busyKey === "refresh-sources" ? "Refreshing..." : "Refresh feeds"}
        </button>
      </div>

      <div className="community-blog-form-grid">
        <label className="staff-field">
          Source title
          <input value={sourceDraft.title} onChange={(event) => updateSourceDraft({ title: event.target.value })} placeholder="Ceramic Arts Daily" />
        </label>
        <label className="staff-field">
          Status
          <select value={sourceDraft.status} onChange={(event) => updateSourceDraft({ status: event.target.value as SourceDraft["status"] })}>
            <option value="enabled">Enabled</option>
            <option value="disabled">Disabled</option>
          </select>
        </label>
        <label className="staff-field community-blog-field-wide">
          Feed URL
          <input value={sourceDraft.feedUrl} onChange={(event) => updateSourceDraft({ feedUrl: event.target.value })} placeholder="https://example.com/feed.xml" />
        </label>
        <label className="staff-field">
          Site URL
          <input value={sourceDraft.siteUrl} onChange={(event) => updateSourceDraft({ siteUrl: event.target.value })} placeholder="https://example.com" />
        </label>
        <label className="staff-field community-blog-field-wide">
          Summary
          <input value={sourceDraft.summary} onChange={(event) => updateSourceDraft({ summary: event.target.value })} placeholder="Why this source matters to Monsoon Fire." />
        </label>
      </div>

      <div className="community-blog-ai-controls">
        <button type="button" className="btn btn-secondary" onClick={() => void saveSource()} disabled={busyKey === "save-source"}>
          {busyKey === "save-source" ? "Saving..." : sourceDraft.sourceId ? "Save source" : "Add source"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setSourceDraft({ ...EMPTY_SOURCE_DRAFT })}>
          New source
        </button>
      </div>

      <div className="community-blog-source-list">
        {sources.map((source) => (
          <button
            key={source.id}
            type="button"
            className={`community-blog-library-item ${sourceDraft.sourceId === source.id ? "active" : ""}`}
            onClick={() => openSource(source)}
          >
            <span className={`community-blog-status-chip status-${source.status === "disabled" ? "archived" : "published"}`}>
              {source.status}
            </span>
            <strong>{source.title}</strong>
            <span>{source.lastFetchedAtMs ? `Fetched ${formatCommunityBlogDate(source.lastFetchedAtMs)}` : "Not refreshed yet"}</span>
          </button>
        ))}
      </div>

      <div className="community-blog-external-grid">
        {externalItems.slice(0, 12).map((item) => (
          <article className="community-blog-ai-card" key={item.id}>
            <strong>{item.title}</strong>
            <div className="staff-mini">{item.sourceTitle}</div>
            <p>{item.excerpt}</p>
            {item.studioNote ? <div className="staff-mini">{item.studioNote}</div> : null}
            <div className="community-blog-tag-list">
              {item.tags.slice(0, 3).map((tag) => (
                <span className="community-blog-tag" key={tag}>
                  {tag}
                </span>
              ))}
            </div>
            <div className="community-blog-channel-actions">
              <button
                type="button"
                className="btn btn-ghost btn-small"
                onClick={() => void setExternalItemStatus(item, item.status === "featured" ? "available" : "featured")}
                disabled={busyKey === `external:${item.id}`}
              >
                {item.status === "featured" ? "Unfeature" : "Feature"}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-small"
                onClick={() => void setExternalItemStatus(item, item.status === "hidden" ? "available" : "hidden")}
                disabled={busyKey === `external:${item.id}`}
              >
                {item.status === "hidden" ? "Unhide" : "Hide"}
              </button>
              <a className="btn btn-ghost btn-small" href={item.canonicalUrl} target="_blank" rel="noreferrer">
                Open
              </a>
            </div>
          </article>
        ))}
      </div>
    </section>
  );

  const aiSection = (
    <section className="community-blog-ai">
      <div className="community-blog-ai-head">
        <div>
          <strong>AI assist</strong>
          <div className="staff-mini">Manual suggestions only. Nothing auto-applies or auto-publishes.</div>
        </div>
        <div className="community-blog-ai-controls">
          <select value={aiMode} onChange={(event) => setAiMode(event.target.value as CommunityBlogAiMode)}>
            {COMMUNITY_BLOG_AI_MODES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-secondary" onClick={() => void runAiAssist()} disabled={busyKey === "ai"}>
            {busyKey === "ai" ? "Thinking..." : "Ask AI"}
          </button>
        </div>
      </div>
      <div className="staff-mini">
        {COMMUNITY_BLOG_AI_MODES.find((option) => option.value === aiMode)?.help}
      </div>
      {aiMessage ? (
        <div className={`staff-note ${aiAvailable === false ? "staff-note-error" : ""}`}>
          {aiMessage}
          {aiModelLabel ? <div className="staff-mini">{aiModelLabel}</div> : null}
        </div>
      ) : null}
      <div className="community-blog-ai-results">
        {aiSuggestions.map((suggestion) => (
          <article className="community-blog-ai-card" key={suggestion.id}>
            <strong>{suggestion.title}</strong>
            {suggestion.excerpt ? <p>{suggestion.excerpt}</p> : null}
            {suggestion.note ? <div className="staff-mini">{suggestion.note}</div> : null}
            {suggestion.bodyMarkdown ? <pre className="community-blog-ai-body">{suggestion.bodyMarkdown}</pre> : null}
            <button type="button" className="btn btn-ghost btn-small" onClick={() => applyAiSuggestion(suggestion)}>
              Apply suggestion
            </button>
          </article>
        ))}
      </div>
    </section>
  );

  const previewSection = (
    <section className="community-blog-preview card">
      <div className="community-blog-preview-head">
        <strong>Preview</strong>
        {!isCommunityVariant ? (
          <button type="button" className="btn btn-ghost btn-small" onClick={() => setPreviewOpen((prev) => !prev)}>
            {previewOpen ? "Hide preview" : "Show preview"}
          </button>
        ) : null}
      </div>
      {previewOpen ? (
        <div className="community-blog-preview-surface">
          {draft.featuredImage ? (
            <img
              className="community-blog-preview-featured"
              src={draft.featuredImage.url}
              alt={draft.featuredImage.alt}
            />
          ) : null}
          <div className="community-blog-preview-meta">
            <span className={`community-blog-status-chip status-${draft.status}`}>{statusLabel(draft.status)}</span>
            <span>{draft.title || "Untitled studio note"}</span>
          </div>
          <p className="community-copy">{draft.excerpt || "Excerpt will appear here once added."}</p>
          <div className="community-blog-tag-list">
            {parseCommunityBlogTagsInput(draft.tagsInput).map((tag) => (
              <span key={tag} className="community-blog-tag">
                {tag}
              </span>
            ))}
          </div>
          {previewHtml ? (
            <div className="community-blog-rendered" dangerouslySetInnerHTML={{ __html: previewHtml }} />
          ) : (
            <div className="staff-note">Start writing to see a preview.</div>
          )}
        </div>
      ) : null}
    </section>
  );

  return (
    <section
      className={`card card-3d community-blog-studio ${isCommunityVariant ? "community-blog-studio-compact community-blog-studio-focus" : ""}`}
    >
      <div className="community-blog-studio-head">
        <div>
          <h2 className="card-title">{isCommunityVariant ? "Blog studio" : "Community blogs"}</h2>
          <p className="community-copy">
            {isCommunityVariant
              ? "A writing-first workspace for fast blog drafting on phone or laptop. Open the extra panels only when you need them."
              : "Draft, stage, publish, archive, and delete short studio posts. Published posts feed the portal Community page and website blog."}
          </p>
        </div>
        <div className="community-blog-studio-actions">
          <button type="button" className="btn btn-secondary" onClick={openNewDraft}>
            Write blog
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setSelectedPostId(selectedPostId);
              setDraft(draftFromPost(selectedSavedPost));
              setStatus("Reloaded from saved version.");
            }}
            disabled={!selectedSavedPost}
          >
            Revert edits
          </button>
          {onRequestClose ? (
            <button type="button" className="btn btn-ghost" onClick={requestClose}>
              {isCommunityVariant ? "Close editor" : "Close"}
            </button>
          ) : null}
        </div>
      </div>

      {status ? (
        <div className="staff-note" role="status" aria-live="polite">
          {status}
        </div>
      ) : null}
      {error ? (
        <div className="staff-note staff-note-error" role="alert" aria-live="assertive">
          {error}
        </div>
      ) : null}

      {isCommunityVariant ? (
        <div className="community-blog-workspace-strip" role="toolbar" aria-label="Blog studio tools">
          <button
            type="button"
            className={`btn btn-ghost btn-small community-blog-workspace-toggle ${libraryOpen ? "active" : ""}`}
            onClick={() => setLibraryOpen((prev) => !prev)}
            aria-expanded={libraryOpen}
          >
            {libraryOpen ? "Hide library" : "Open library"}
          </button>
          <button
            type="button"
            className={`btn btn-ghost btn-small community-blog-workspace-toggle ${detailsOpen ? "active" : ""}`}
            onClick={() => setDetailsOpen((prev) => !prev)}
            aria-expanded={detailsOpen}
          >
            Details
          </button>
          <button
            type="button"
            className={`btn btn-ghost btn-small community-blog-workspace-toggle ${mediaOpen ? "active" : ""}`}
            onClick={() => setMediaOpen((prev) => !prev)}
            aria-expanded={mediaOpen}
          >
            Images
          </button>
          <button
            type="button"
            className={`btn btn-ghost btn-small community-blog-workspace-toggle ${distributionOpen ? "active" : ""}`}
            onClick={() => setDistributionOpen((prev) => !prev)}
            aria-expanded={distributionOpen}
          >
            Distribution
          </button>
          <button
            type="button"
            className={`btn btn-ghost btn-small community-blog-workspace-toggle ${sourcesOpen ? "active" : ""}`}
            onClick={() => setSourcesOpen((prev) => !prev)}
            aria-expanded={sourcesOpen}
          >
            Outside feeds
          </button>
          <button
            type="button"
            className={`btn btn-ghost btn-small community-blog-workspace-toggle ${aiOpen ? "active" : ""}`}
            onClick={() => setAiOpen((prev) => !prev)}
            aria-expanded={aiOpen}
          >
            AI
          </button>
          <button
            type="button"
            className={`btn btn-ghost btn-small community-blog-workspace-toggle ${previewOpen ? "active" : ""}`}
            onClick={() => setPreviewOpen((prev) => !prev)}
            aria-expanded={previewOpen}
          >
            Preview
          </button>
        </div>
      ) : null}

      <div className={`community-blog-studio-layout ${isCommunityVariant ? "community-blog-studio-layout-focus" : ""}`}>
        {!isCommunityVariant || libraryOpen ? (
          <aside className={`community-blog-library ${isCommunityVariant ? "community-blog-library-drawer" : ""}`}>
            <div className="community-blog-library-head">
              <strong>Library</strong>
              <button
                type="button"
                className="btn btn-ghost btn-small"
                onClick={() => {
                  setStatus("");
                  setError("");
                  setReloadKey((prev) => prev + 1);
                }}
                disabled={busyKey === "refresh"}
              >
                {busyKey === "refresh" ? "Refreshing..." : "Refresh"}
              </button>
            </div>
            <div className="community-blog-status-row">
              <button
                type="button"
                className={`community-blog-filter ${filterStatus === "all" ? "active" : ""}`}
                onClick={() => setFilterStatus("all")}
              >
                All <span>{counts.draft + counts.staged + counts.published + counts.archived}</span>
              </button>
              {(["draft", "staged", "published", "archived", "deleted"] as CommunityBlogStatus[]).map((statusOption) => (
                <button
                  key={statusOption}
                  type="button"
                  className={`community-blog-filter ${filterStatus === statusOption ? "active" : ""}`}
                  onClick={() => setFilterStatus(statusOption)}
                >
                  {statusLabel(statusOption)} <span>{counts[statusOption]}</span>
                </button>
              ))}
            </div>
            <div className="community-blog-library-list">
              {filteredPosts.length === 0 ? (
                <div className="staff-note">No posts in this filter yet.</div>
              ) : (
                filteredPosts.map((post) => (
                  <button
                    key={post.id}
                    type="button"
                    className={`community-blog-library-item ${selectedPostId === post.id ? "active" : ""}`}
                    onClick={() => openExistingPost(post)}
                  >
                    <span className={`community-blog-status-chip status-${post.status}`}>{statusLabel(post.status)}</span>
                    <strong>{post.title}</strong>
                    <span>{formatCommunityBlogDate(post.publishedAtMs || post.updatedAtMs || post.createdAtMs)}</span>
                  </button>
                ))
              )}
            </div>
          </aside>
        ) : null}

        <div className="community-blog-editor">
          <div className={`community-blog-editor-head ${isCommunityVariant ? "community-blog-editor-head-sticky" : ""}`}>
            <div>
              <div className="community-blog-editor-title">
                {draft.postId ? "Editing post" : "New post"}
                {isDirty ? <span className="community-blog-dirty-dot">Unsaved changes</span> : null}
              </div>
              <div className="community-blog-editor-meta">
                Status: <span className={`community-blog-status-chip status-${draft.status}`}>{statusLabel(draft.status)}</span>
                {draft.publishedAtMs ? <span>Published {formatCommunityBlogDate(draft.publishedAtMs)}</span> : null}
              </div>
            </div>
            <div className="community-blog-editor-actions">
              <button type="button" className="btn btn-secondary" onClick={() => void saveDraft()} disabled={busyKey === "save"}>
                {busyKey === "save" ? "Saving..." : "Save draft"}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => void saveAndChangeStatus("staged")}
                disabled={!canStageOrPublish || Boolean(busyKey)}
              >
                Stage
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void saveAndChangeStatus("published")}
                disabled={!canStageOrPublish || Boolean(busyKey)}
              >
                Publish
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => void saveAndChangeStatus("archived")}
                disabled={!draft.postId || Boolean(busyKey)}
              >
                Archive
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => void saveAndChangeStatus("draft")}
                disabled={Boolean(busyKey)}
              >
                Draft
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => void deletePost()}
                disabled={!draft.postId || Boolean(busyKey)}
              >
                Delete
              </button>
            </div>
          </div>

          <div className={`community-blog-form-grid ${isCommunityVariant ? "community-blog-form-grid-primary" : ""}`}>
            <label className="staff-field community-blog-field-wide">
              Title
              <input
                value={draft.title}
                onChange={(event) => updateDraft({ title: event.target.value })}
                placeholder="Studio note title"
              />
            </label>
            {!isCommunityVariant ? detailFields : null}
            <label className="staff-field community-blog-field-wide">
              Excerpt
              <textarea
                value={draft.excerpt}
                maxLength={280}
                onChange={(event) => updateDraft({ excerpt: event.target.value })}
                placeholder="Short summary for cards and search previews."
              />
            </label>
          </div>

          {isCommunityVariant
            ? renderExpandableCard({
                title: "Post details",
                description: "Slug, tone, tags, and marketing focus stay available without crowding the writing lane.",
                open: detailsOpen,
                toggle: () => setDetailsOpen((prev) => !prev),
                children: <div className="community-blog-form-grid community-blog-form-grid-compact">{detailFields}</div>,
              })
            : null}

          <div className="community-blog-toolbar">
            <button type="button" className="btn btn-ghost btn-small" onClick={() => insertMarkup("# ", "", "Heading")}>
              Heading
            </button>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => insertMarkup("**", "**", "bold text")}>
              Bold
            </button>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => insertMarkup("*", "*", "italic text")}>
              Italic
            </button>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => insertMarkup("- ", "", "list item")}>
              Bullet
            </button>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => insertMarkup("> ", "", "quoted note")}>
              Quote
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-small"
              onClick={() => insertMarkup("[", "](https://example.com)", "link text")}
            >
              Link
            </button>
          </div>

          <label className="staff-field community-blog-field-wide">
            Body
            <textarea
              ref={bodyInputRef}
              className={`community-blog-body-input ${isCommunityVariant ? "community-blog-body-input-focus" : ""}`}
              value={draft.bodyMarkdown}
              onChange={(event) => updateDraft({ bodyMarkdown: event.target.value })}
              placeholder="Write in a lightweight markdown style. Use the toolbar above for quick formatting."
            />
            <div className="staff-mini">
              Supports headings, bold, italic, bullets, blockquotes, links, and inline images.
            </div>
          </label>

          {isCommunityVariant
            ? renderExpandableCard({
                title: "Images",
                description: "Featured and inline images stay available, but out of the way until you need them.",
                open: mediaOpen,
                toggle: () => setMediaOpen((prev) => !prev),
                children: mediaContent,
              })
            : mediaContent}

          {isCommunityVariant ? (
            <>
              {renderExpandableCard({
                title: "Distribution",
                description: "Check channel readiness and send published posts without leaving the editor.",
                open: distributionOpen,
                toggle: () => setDistributionOpen((prev) => !prev),
                children: distributionSection,
              })}
              {renderExpandableCard({
                title: "Outside feeds",
                description: "Keep external inspiration and curation tools available without eating the composer width.",
                open: sourcesOpen,
                toggle: () => setSourcesOpen((prev) => !prev),
                children: sourcesSection,
              })}
              {renderExpandableCard({
                title: "AI assist",
                description: "Use AI for topic, tone, and caption help when you need it.",
                open: aiOpen,
                toggle: () => setAiOpen((prev) => !prev),
                children: aiSection,
              })}
              {renderExpandableCard({
                title: "Preview",
                description: "Open a full preview only when you want to check the reading experience.",
                open: previewOpen,
                toggle: () => setPreviewOpen((prev) => !prev),
                children: previewSection,
              })}
            </>
          ) : (
            <>
              <div className="community-blog-ops-grid">
                {distributionSection}
                {sourcesSection}
              </div>
              {aiSection}
              {previewSection}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

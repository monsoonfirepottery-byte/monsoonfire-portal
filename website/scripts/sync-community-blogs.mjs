#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const websiteRoots = [
  path.join(repoRoot, "website"),
  path.join(repoRoot, "website", "ncsitebuilder"),
];

const DEFAULT_FEED_URL = "https://us-central1-monsoonfire-portal.cloudfunctions.net/listPublishedCommunityBlogExperience";
const WEBSITE_BASE_URL = "https://monsoonfire.com";
const DEFAULT_OG_IMAGE = `${WEBSITE_BASE_URL}/assets/images/finished-work-1200.jpg`;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeXml(value) {
  return escapeHtml(value);
}

function stripHtml(value) {
  return String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function formatDisplayDate(ms) {
  return new Date(ms || Date.now()).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatLastMod(ms) {
  return new Date(ms || Date.now()).toISOString().slice(0, 10);
}

function normalizeMarketingFocus(value) {
  if (value === "kiln-firing" || value === "memberships" || value === "contact") return value;
  return "studio-services";
}

function canonicalUrlForSlug(slug) {
  return `${WEBSITE_BASE_URL}/blog/${String(slug || "").trim()}/`;
}

function appendUtm(urlValue, medium, slug) {
  const url = new URL(urlValue);
  url.searchParams.set("utm_source", "blog");
  url.searchParams.set("utm_medium", medium);
  url.searchParams.set("utm_campaign", `blog_${String(slug || "").trim()}`);
  return url.toString();
}

function marketingCta(post) {
  switch (post.marketingFocus) {
    case "kiln-firing":
      return {
        eyebrow: "Kiln firing",
        title: "Need dependable firing support for the next load?",
        body: "See firing options, requirements, and how the queue works before you drop work off.",
        href: appendUtm(`${WEBSITE_BASE_URL}/kiln-firing/`, "article_cta", post.slug),
        label: "Explore kiln firing",
      };
    case "memberships":
      return {
        eyebrow: "Memberships",
        title: "Want a steadier studio rhythm?",
        body: "Compare memberships and see what Monsoon Fire looks like for regular making and production flow.",
        href: appendUtm(`${WEBSITE_BASE_URL}/memberships/`, "article_cta", post.slug),
        label: "See memberships",
      };
    case "contact":
      return {
        eyebrow: "Contact",
        title: "Talk with the studio about fit or opportunity.",
        body: "Use the contact form when you want to ask a question, start a conversation, or explore a business opportunity.",
        href: appendUtm(`${WEBSITE_BASE_URL}/contact/`, "article_cta", post.slug),
        label: "Start the conversation",
      };
    default:
      return {
        eyebrow: "Studio services",
        title: "See how Monsoon Fire supports focused makers.",
        body: "Explore studio access, production support, and the service mix behind the work shared in these notes.",
        href: appendUtm(`${WEBSITE_BASE_URL}/services/`, "article_cta", post.slug),
        label: "Explore studio services",
      };
  }
}

function normalizePost(row) {
  const publishedAtMs = Number(row?.publishedAtMs || row?.publishedAt || 0) || 0;
  const updatedAtMs = Number(row?.updatedAtMs || row?.updatedAt || publishedAtMs) || publishedAtMs;
  const slug = typeof row?.slug === "string" ? row.slug.trim() : "";
  const title = typeof row?.title === "string" ? row.title.trim() : "";
  if (!slug || !title) return null;
  const featuredImage = row?.featuredImage && typeof row.featuredImage === "object"
    ? {
        url: typeof row.featuredImage.url === "string" ? row.featuredImage.url.trim() : "",
        alt: typeof row.featuredImage.alt === "string" ? row.featuredImage.alt.trim() : "",
      }
    : null;
  return {
    id: typeof row?.id === "string" ? row.id : slug,
    slug,
    title,
    excerpt: typeof row?.excerpt === "string" ? row.excerpt.trim() : "",
    bodyHtml: typeof row?.bodyHtml === "string" ? row.bodyHtml : "",
    tags: Array.isArray(row?.tags) ? row.tags.filter((entry) => typeof entry === "string" && entry.trim()) : [],
    readingMinutes: Math.max(1, Number(row?.readingMinutes || 1) || 1),
    authorName: typeof row?.authorName === "string" && row.authorName.trim() ? row.authorName.trim() : "Studio staff",
    publishedAtMs,
    updatedAtMs,
    featuredImage,
    canonicalUrl:
      typeof row?.canonicalUrl === "string" && row.canonicalUrl.trim()
        ? row.canonicalUrl.trim()
        : canonicalUrlForSlug(slug),
    marketingFocus: normalizeMarketingFocus(row?.marketingFocus),
    previousSlug: null,
    nextSlug: null,
    relatedSlugs: [],
  };
}

function normalizeExternalHighlight(row) {
  const canonicalUrl = typeof row?.canonicalUrl === "string" ? row.canonicalUrl.trim() : "";
  const title = typeof row?.title === "string" ? row.title.trim() : "";
  if (!canonicalUrl || !title) return null;
  return {
    id: typeof row?.id === "string" ? row.id : canonicalUrl,
    sourceId: typeof row?.sourceId === "string" ? row.sourceId : "external",
    sourceTitle: typeof row?.sourceTitle === "string" && row.sourceTitle.trim() ? row.sourceTitle.trim() : "External source",
    sourceUrl: typeof row?.sourceUrl === "string" && row.sourceUrl.trim() ? row.sourceUrl.trim() : null,
    title,
    excerpt: typeof row?.excerpt === "string" ? row.excerpt.trim() : "",
    canonicalUrl,
    imageUrl: typeof row?.imageUrl === "string" && row.imageUrl.trim() ? row.imageUrl.trim() : null,
    imageAlt: typeof row?.imageAlt === "string" && row.imageAlt.trim() ? row.imageAlt.trim() : null,
    publishedAtMs: Number(row?.publishedAtMs || row?.publishedAt || 0) || 0,
    updatedAtMs: Number(row?.updatedAtMs || row?.updatedAt || 0) || 0,
    importedAtMs: Number(row?.importedAtMs || row?.importedAt || 0) || 0,
    status: typeof row?.status === "string" ? row.status : "featured",
    authorName: typeof row?.authorName === "string" && row.authorName.trim() ? row.authorName.trim() : null,
    tags: Array.isArray(row?.tags) ? row.tags.filter((entry) => typeof entry === "string" && entry.trim()) : [],
    studioNote: typeof row?.studioNote === "string" && row.studioNote.trim() ? row.studioNote.trim() : null,
  };
}

function buildExperience(raw) {
  const posts = Array.isArray(raw?.posts) ? raw.posts.map((row) => normalizePost(row)).filter(Boolean) : [];
  const sortedPosts = posts.sort((a, b) => (b.publishedAtMs || b.updatedAtMs) - (a.publishedAtMs || a.updatedAtMs));
  const externalHighlights = Array.isArray(raw?.externalHighlights)
    ? raw.externalHighlights.map((row) => normalizeExternalHighlight(row)).filter(Boolean).sort((a, b) => {
        const aKey = a.publishedAtMs || a.updatedAtMs || a.importedAtMs;
        const bKey = b.publishedAtMs || b.updatedAtMs || b.importedAtMs;
        return bKey - aKey;
      })
    : [];

  const postsWithLinks = sortedPosts.map((post, index) => {
    const tagSet = new Set(post.tags);
    const related = sortedPosts
      .filter((candidate) => candidate.slug !== post.slug)
      .map((candidate) => ({
        slug: candidate.slug,
        sharedTags: candidate.tags.filter((tag) => tagSet.has(tag)).length,
        publishedAtMs: candidate.publishedAtMs,
      }))
      .sort((a, b) => (b.sharedTags - a.sharedTags) || (b.publishedAtMs - a.publishedAtMs))
      .slice(0, 3)
      .map((candidate) => candidate.slug);
    return {
      ...post,
      previousSlug: sortedPosts[index + 1]?.slug ?? null,
      nextSlug: sortedPosts[index - 1]?.slug ?? null,
      relatedSlugs: related,
    };
  });

  return {
    generatedAtMs: Number(raw?.generatedAtMs || Date.now()) || Date.now(),
    posts: postsWithLinks,
    externalHighlights,
  };
}

function relatedPostsFor(post, experience) {
  const related = post.relatedSlugs
    .map((slug) => experience.posts.find((candidate) => candidate.slug === slug))
    .filter(Boolean);
  if (related.length >= 3) return related.slice(0, 3);
  const fallback = experience.posts.filter((candidate) => candidate.slug !== post.slug && !related.some((entry) => entry.slug === candidate.slug));
  return [...related, ...fallback].slice(0, 3);
}

function renderHead({ title, description, canonicalUrl, imageUrl, isArticle, jsonLd }) {
  return `  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />
  <link rel="icon" href="/assets/images/logo-mark-black.png" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Fraunces:opsz,wght@9..144,300;9..144,400;9..144,600;9..144,700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/assets/css/styles.css" />
  <style>
    .blog-shell { display: grid; gap: 28px; }
    .blog-feature, .blog-card, .blog-cta, .blog-nav-card, .blog-share, .blog-rail-card {
      border: 1px solid var(--border);
      border-radius: 22px;
      background: var(--surface);
    }
    .blog-feature {
      display: grid;
      gap: 18px;
      padding: 20px;
      background:
        radial-gradient(circle at top left, rgba(180, 79, 53, 0.18), transparent 40%),
        var(--surface);
    }
    .blog-feature-grid, .blog-grid, .blog-rail-grid, .blog-nav-grid { display: grid; gap: 18px; }
    .blog-card, .blog-nav-card, .blog-rail-card { padding: 18px; display: grid; gap: 14px; }
    .blog-card-media, .blog-feature-media, .blog-article-media {
      width: 100%;
      border-radius: 18px;
      border: 1px solid var(--border);
      aspect-ratio: 16 / 9;
      object-fit: cover;
    }
    .blog-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      color: var(--ink-700);
      font-family: var(--font-ui);
      font-size: var(--text-xs);
      letter-spacing: 0.16em;
      text-transform: uppercase;
    }
    .blog-tag-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .blog-tag {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 999px;
      padding: 6px 10px;
      border: 1px solid rgba(180, 79, 53, 0.22);
      background: rgba(180, 79, 53, 0.1);
      color: var(--accent);
      font-family: var(--font-ui);
      font-size: 11px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }
    .blog-rich {
      display: grid;
      gap: 18px;
      line-height: 1.75;
    }
    .blog-rich p, .blog-rich blockquote, .blog-rich ul, .blog-rich ol, .blog-rich h1, .blog-rich h2, .blog-rich h3, .blog-rich figure { margin: 0; }
    .blog-rich blockquote {
      padding-left: 16px;
      border-left: 3px solid rgba(180, 79, 53, 0.35);
      color: var(--ink-700);
    }
    .blog-rich ul, .blog-rich ol { padding-left: 20px; }
    .blog-rich a { color: var(--accent); }
    .blog-rich figure { display: grid; gap: 8px; }
    .blog-rich figure img {
      width: 100%;
      border-radius: 18px;
      border: 1px solid var(--border);
    }
    .blog-rich figcaption {
      font-size: var(--text-xs);
      color: var(--ink-700);
    }
    .blog-share {
      padding: 16px;
      display: grid;
      gap: 12px;
    }
    .blog-share-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }
    .blog-share-status {
      color: var(--ink-700);
      font-size: var(--text-sm);
      min-height: 1.3em;
    }
    .blog-cta {
      padding: 18px;
      display: grid;
      gap: 10px;
      background:
        linear-gradient(135deg, rgba(180, 79, 53, 0.18), transparent 55%),
        var(--surface);
    }
    .blog-cta p, .blog-card p, .blog-rail-card p { margin: 0; }
    .blog-nav-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .blog-rail-card .meta { color: var(--ink-700); font-size: var(--text-sm); }
    .blog-list-split {
      display: grid;
      gap: 18px;
      grid-template-columns: minmax(0, 1.5fr) minmax(300px, 0.95fr);
      align-items: start;
    }
    .blog-side-stack { display: grid; gap: 18px; }
    @media (max-width: 960px) {
      .blog-list-split, .blog-nav-grid { grid-template-columns: minmax(0, 1fr); }
    }
    @media (max-width: 720px) {
      .blog-feature, .blog-card, .blog-share, .blog-cta, .blog-nav-card, .blog-rail-card { padding: 16px; }
      .blog-share-actions { flex-direction: column; }
    }
  </style>
  <script src="/assets/js/analytics.js" defer></script>
  <meta property="og:site_name" content="Monsoon Fire Pottery" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:type" content="${isArticle ? "article" : "website"}" />
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}" />
  <meta property="og:image" content="${escapeHtml(imageUrl)}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="1600" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <meta name="twitter:image" content="${escapeHtml(imageUrl)}" />
  ${jsonLd ? `<script type="application/ld+json">${jsonLd}</script>` : ""}`;
}

function renderHeader() {
  return `<header class="site-header">
    <div class="container navbar">
      <a class="brand" href="/">
        <img loading="eager" src="/assets/images/logo-mark-black.png" alt="Monsoon Fire Pottery logo" />
        Monsoon Fire Pottery
      </a>
      <nav class="nav-links" data-nav-links>
        <a href="/services/">The Studio</a>
        <a href="/kiln-firing/">Kiln Firing</a>
        <a href="/faq/">Community</a>
        <a href="/support/">Support</a>
        <a href="/blog/">Studio Notes</a>
      </nav>
      <div class="nav-portal-wrap">
        <a class="button button-ghost nav-login" href="https://monsoonfire.kilnfire.com" target="_blank" rel="noopener noreferrer">Login</a>
      </div>
      <button class="menu-toggle" type="button" aria-label="Toggle menu" aria-expanded="false" data-menu-toggle>
        <span></span><span></span><span></span>
      </button>
    </div>
  </header>`;
}

function renderFooter() {
  return `<footer class="footer">
    <div class="container footer-grid">
      <div>
        <div class="footer-brand">Monsoon Fire Pottery</div>
        <p class="footer-note">West Valley, Arizona. Address shared via portal.</p>
        <p>All interactions are by appointment only.</p>
      </div>
      <div>
        <div class="footer-title">Contact</div>
        <p><a href="mailto:support@monsoonfire.com">support@monsoonfire.com</a></p>
        <p><a href="/contact/">Contact form</a></p>
        <p><a href="/policies/accessibility/">Accessibility statement</a></p>
      </div>
    </div>
  </footer>`;
}

function renderShareScript() {
  return `<script>
  document.addEventListener("click", async (event) => {
    const target = event.target.closest("[data-share-url]");
    if (!target) return;
    event.preventDefault();
    const url = target.getAttribute("data-share-url");
    const title = target.getAttribute("data-share-title") || document.title;
    const statusNode = target.closest("[data-share-root]")?.querySelector("[data-share-status]");
    const setStatus = (message) => { if (statusNode) statusNode.textContent = message; };
    try {
      if (target.hasAttribute("data-native-share") && navigator.share) {
        await navigator.share({ title, url });
        setStatus("Share sheet opened.");
        return;
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        setStatus("Copied link.");
        return;
      }
      setStatus(url);
    } catch (error) {
      if (error && error.name === "AbortError") return;
      setStatus(error?.message || "Could not share this note.");
    }
  });
  </script>`;
}

function renderBlogPostingJsonLd(post) {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.excerpt || stripHtml(post.bodyHtml).slice(0, 180),
    datePublished: new Date(post.publishedAtMs || post.updatedAtMs).toISOString(),
    dateModified: new Date(post.updatedAtMs || post.publishedAtMs).toISOString(),
    author: {
      "@type": "Person",
      name: post.authorName || "Studio staff",
    },
    publisher: {
      "@type": "Organization",
      name: "Monsoon Fire Pottery",
      logo: {
        "@type": "ImageObject",
        url: `${WEBSITE_BASE_URL}/assets/images/logo-mark-black.png`,
      },
    },
    mainEntityOfPage: post.canonicalUrl,
    image: post.featuredImage?.url || DEFAULT_OG_IMAGE,
  });
}

export function renderBlogIndexPage(experience, generatedAtMs = Date.now()) {
  const hero = experience.posts[0] ?? null;
  const recent = hero ? experience.posts.slice(1) : experience.posts;
  const external = experience.externalHighlights.slice(0, 6);
  const latestDate = hero?.updatedAtMs || generatedAtMs;

  const heroHtml = hero
    ? `<article class="blog-feature">
      ${hero.featuredImage?.url ? `<img class="blog-feature-media" src="${escapeHtml(hero.featuredImage.url)}" alt="${escapeHtml(hero.featuredImage.alt || hero.title)}" />` : ""}
      <div class="blog-meta">
        <span>Latest studio note</span>
        <span>${escapeHtml(formatDisplayDate(hero.publishedAtMs))}</span>
        <span>${escapeHtml(hero.authorName)}</span>
        <span>${hero.readingMinutes} min read</span>
      </div>
      <div>
        <h2><a href="/blog/${escapeHtml(hero.slug)}/">${escapeHtml(hero.title)}</a></h2>
        <p class="lead">${escapeHtml(hero.excerpt || stripHtml(hero.bodyHtml).slice(0, 180))}</p>
      </div>
      <div class="blog-tag-row">
        ${hero.tags.map((tag) => `<span class="blog-tag">${escapeHtml(tag)}</span>`).join("")}
      </div>
      <div class="blog-share-actions">
        <a class="button button-primary" href="/blog/${escapeHtml(hero.slug)}/">Open full note</a>
        <a class="button button-ghost" href="${escapeHtml(marketingCta(hero).href)}">Explore the studio</a>
      </div>
    </article>`
    : `<article class="blog-card"><h2>No studio notes yet.</h2><p>Published studio notes will appear here once staff posts them from the portal.</p></article>`;

  const recentHtml = recent.length
    ? recent
        .map(
          (post) => `<article class="blog-card">
  ${post.featuredImage?.url ? `<img class="blog-card-media" src="${escapeHtml(post.featuredImage.url)}" alt="${escapeHtml(post.featuredImage.alt || post.title)}" />` : ""}
  <div class="blog-meta">
    <span>${escapeHtml(formatDisplayDate(post.publishedAtMs))}</span>
    <span>${escapeHtml(post.authorName)}</span>
    <span>${post.readingMinutes} min read</span>
  </div>
  <div>
    <h2><a href="/blog/${escapeHtml(post.slug)}/">${escapeHtml(post.title)}</a></h2>
    <p>${escapeHtml(post.excerpt || stripHtml(post.bodyHtml).slice(0, 180))}</p>
  </div>
  <div class="blog-tag-row">
    ${post.tags.map((tag) => `<span class="blog-tag">${escapeHtml(tag)}</span>`).join("")}
  </div>
  <div><a class="button button-ghost" href="/blog/${escapeHtml(post.slug)}/">Read note</a></div>
</article>`
        )
        .join("\n")
    : `<article class="blog-card"><h2>More notes soon.</h2><p>The latest published post will stay featured here until another note lands.</p></article>`;

  const externalHtml = external.length
    ? external
        .map(
          (item) => `<article class="blog-rail-card">
  ${item.imageUrl ? `<img class="blog-card-media" src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.imageAlt || item.title)}" />` : ""}
  <div class="blog-meta">
    <span>${escapeHtml(item.sourceTitle)}</span>
    <span>${escapeHtml(formatDisplayDate(item.publishedAtMs || item.importedAtMs))}</span>
  </div>
  <div>
    <h3>${escapeHtml(item.title)}</h3>
    <p>${escapeHtml(item.excerpt)}</p>
  </div>
  ${item.studioNote ? `<p class="meta">${escapeHtml(item.studioNote)}</p>` : ""}
  <div><a class="button button-ghost" href="${escapeHtml(item.canonicalUrl)}" target="_blank" rel="noreferrer">Open source</a></div>
</article>`
        )
        .join("\n")
    : `<article class="blog-rail-card"><h3>No outside highlights yet.</h3><p>Featured outside sources will show up here once staff curates them.</p></article>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
${renderHead({
  title: "Studio Notes | Monsoon Fire Pottery",
  description: "Short studio notes, process updates, and practical pottery community posts from Monsoon Fire.",
  canonicalUrl: `${WEBSITE_BASE_URL}/blog/`,
  imageUrl: hero?.featuredImage?.url || DEFAULT_OG_IMAGE,
  isArticle: false,
})}
</head>
<body data-nav-parent="/blog/">
  <a class="skip-link" href="#main">Skip to content</a>
  ${renderHeader()}
  <main class="page" id="main">
    <section class="section">
      <div class="container blog-shell">
        <div class="heading-block">
          <p class="eyebrow">Studio notes</p>
          <h1 class="section-title">Short reads from the studio floor.</h1>
          <p class="lead">Operational notes, pottery process thinking, and studio signals that can turn into real momentum.</p>
          <p class="meta">Updated ${escapeHtml(formatDisplayDate(latestDate))}</p>
        </div>
        ${heroHtml}
        <div class="blog-list-split">
          <div class="blog-grid">
            <div class="heading-block heading-block--compact">
              <p class="eyebrow">Recent notes</p>
              <h2 class="section-title">Fresh from Monsoon Fire.</h2>
            </div>
            ${recentHtml}
          </div>
          <aside class="blog-side-stack">
            <div class="heading-block heading-block--compact">
              <p class="eyebrow">Around the studio</p>
              <h2 class="section-title">Outside reads we’re tracking.</h2>
              <p class="lead">A few external posts and feeds that support the way Monsoon Fire thinks and works.</p>
            </div>
            <div class="blog-rail-grid">
              ${externalHtml}
            </div>
          </aside>
        </div>
      </div>
    </section>
  </main>
  ${renderFooter()}
  <script defer src="/assets/js/main.js"></script>
</body>
</html>`;
}

export function renderBlogPostPage(post, experience) {
  const description = post.excerpt || stripHtml(post.bodyHtml).slice(0, 180) || "Studio note from Monsoon Fire.";
  const related = relatedPostsFor(post, experience);
  const previousPost = experience.posts.find((entry) => entry.slug === post.previousSlug) || null;
  const nextPost = experience.posts.find((entry) => entry.slug === post.nextSlug) || null;
  const cta = marketingCta(post);
  const external = experience.externalHighlights.slice(0, 2);

  return `<!DOCTYPE html>
<html lang="en">
<head>
${renderHead({
  title: `${post.title} | Studio Notes | Monsoon Fire Pottery`,
  description,
  canonicalUrl: post.canonicalUrl,
  imageUrl: post.featuredImage?.url || DEFAULT_OG_IMAGE,
  isArticle: true,
  jsonLd: renderBlogPostingJsonLd(post),
})}
</head>
<body data-nav-parent="/blog/">
  <a class="skip-link" href="#main">Skip to content</a>
  ${renderHeader()}
  <main class="page" id="main">
    <section class="section">
      <div class="container blog-shell">
        <div class="heading-block heading-block--compact">
          <p class="eyebrow">Studio note</p>
          <h1 class="section-title">${escapeHtml(post.title)}</h1>
          <div class="blog-meta">
            <span>${escapeHtml(formatDisplayDate(post.publishedAtMs))}</span>
            <span>${escapeHtml(post.authorName)}</span>
            <span>${post.readingMinutes} min read</span>
          </div>
          <p class="lead">${escapeHtml(post.excerpt || description)}</p>
          <div class="blog-tag-row">
            ${post.tags.map((tag) => `<span class="blog-tag">${escapeHtml(tag)}</span>`).join("")}
          </div>
        </div>

        <article class="blog-card">
          ${post.featuredImage?.url ? `<img class="blog-article-media" src="${escapeHtml(post.featuredImage.url)}" alt="${escapeHtml(post.featuredImage.alt || post.title)}" />` : ""}
          <div class="blog-rich">${post.bodyHtml}</div>
        </article>

        <section class="blog-share" data-share-root>
          <strong>Share this note</strong>
          <div class="blog-share-actions">
            <button class="button button-ghost" data-native-share data-share-url="${escapeHtml(post.canonicalUrl)}" data-share-title="${escapeHtml(post.title)}">Share</button>
            <button class="button button-ghost" data-share-url="${escapeHtml(post.canonicalUrl)}" data-share-title="${escapeHtml(post.title)}">Copy link</button>
          </div>
          <div class="blog-share-status" data-share-status></div>
        </section>

        <section class="blog-cta">
          <p class="eyebrow">${escapeHtml(cta.eyebrow)}</p>
          <h2 class="section-title">${escapeHtml(cta.title)}</h2>
          <p>${escapeHtml(cta.body)}</p>
          <div><a class="button button-primary" href="${escapeHtml(cta.href)}">${escapeHtml(cta.label)}</a></div>
        </section>

        <section class="blog-nav-grid">
          <article class="blog-nav-card">
            <p class="eyebrow">Previous note</p>
            ${previousPost ? `<h3><a href="/blog/${escapeHtml(previousPost.slug)}/">${escapeHtml(previousPost.title)}</a></h3><p>${escapeHtml(previousPost.excerpt)}</p>` : "<h3>Start at the latest</h3><p>You’re already at the oldest note in this set.</p>"}
          </article>
          <article class="blog-nav-card">
            <p class="eyebrow">Next note</p>
            ${nextPost ? `<h3><a href="/blog/${escapeHtml(nextPost.slug)}/">${escapeHtml(nextPost.title)}</a></h3><p>${escapeHtml(nextPost.excerpt)}</p>` : "<h3>Newest published note</h3><p>You’re reading the latest studio note right now.</p>"}
          </article>
        </section>

        <div class="blog-list-split">
          <section class="blog-grid">
            <div class="heading-block heading-block--compact">
              <p class="eyebrow">More studio notes</p>
              <h2 class="section-title">Keep reading</h2>
            </div>
            ${related.map((item) => `<article class="blog-card">
              <div class="blog-meta">
                <span>${escapeHtml(formatDisplayDate(item.publishedAtMs))}</span>
                <span>${item.readingMinutes} min read</span>
              </div>
              <div>
                <h3><a href="/blog/${escapeHtml(item.slug)}/">${escapeHtml(item.title)}</a></h3>
                <p>${escapeHtml(item.excerpt)}</p>
              </div>
            </article>`).join("\n")}
          </section>
          <aside class="blog-side-stack">
            <div class="heading-block heading-block--compact">
              <p class="eyebrow">Around the studio</p>
              <h2 class="section-title">Outside signals</h2>
            </div>
            <div class="blog-rail-grid">
              ${external.map((item) => `<article class="blog-rail-card">
                <div class="blog-meta">
                  <span>${escapeHtml(item.sourceTitle)}</span>
                  <span>${escapeHtml(formatDisplayDate(item.publishedAtMs || item.importedAtMs))}</span>
                </div>
                <div>
                  <h3>${escapeHtml(item.title)}</h3>
                  <p>${escapeHtml(item.excerpt)}</p>
                </div>
                ${item.studioNote ? `<p class="meta">${escapeHtml(item.studioNote)}</p>` : ""}
                <div><a class="button button-ghost" href="${escapeHtml(item.canonicalUrl)}" target="_blank" rel="noreferrer">Open source</a></div>
              </article>`).join("\n")}
            </div>
            <section class="blog-nav-card">
              <p class="eyebrow">Back to the portal</p>
              <h3>Need the operational view too?</h3>
              <p>Use the portal for queue status, reservations, and studio workflows alongside these notes.</p>
              <div><a class="button button-ghost" href="https://portal.monsoonfire.com/community/">Open portal community</a></div>
            </section>
          </aside>
        </div>
      </div>
    </section>
  </main>
  ${renderFooter()}
  <script defer src="/assets/js/main.js"></script>
  ${renderShareScript()}
</body>
</html>`;
}

export function renderRssFeed(experience, generatedAtMs = Date.now()) {
  const items = experience.posts
    .map((post) => {
      const description = escapeXml(post.excerpt || stripHtml(post.bodyHtml).slice(0, 180));
      return `<item>
  <title>${escapeXml(post.title)}</title>
  <link>${escapeXml(post.canonicalUrl)}</link>
  <guid>${escapeXml(post.canonicalUrl)}</guid>
  <pubDate>${new Date(post.publishedAtMs || generatedAtMs).toUTCString()}</pubDate>
  <description>${description}</description>
</item>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>Monsoon Fire Pottery Studio Notes</title>
  <link>${WEBSITE_BASE_URL}/blog/</link>
  <description>Short studio notes, process updates, and community guidance from Monsoon Fire.</description>
  <lastBuildDate>${new Date(generatedAtMs).toUTCString()}</lastBuildDate>
  ${items}
</channel>
</rss>`;
}

export function updateSitemapXml(existingXml, posts, generatedAtMs = Date.now()) {
  const withoutBlogEntries = String(existingXml)
    .replace(/\s*<url><loc>https:\/\/monsoonfire\.com\/blog\/<\/loc><lastmod>[^<]+<\/lastmod><\/url>/g, "")
    .replace(/\s*<url><loc>https:\/\/monsoonfire\.com\/blog\/[^<]+<\/loc><lastmod>[^<]+<\/lastmod><\/url>/g, "");
  const blogLines = [
    `  <url><loc>https://monsoonfire.com/blog/</loc><lastmod>${formatLastMod(posts[0]?.updatedAtMs || generatedAtMs)}</lastmod></url>`,
    ...posts.map(
      (post) =>
        `  <url><loc>${escapeHtml(post.canonicalUrl)}</loc><lastmod>${formatLastMod(post.updatedAtMs || post.publishedAtMs)}</lastmod></url>`
    ),
  ].join("\n");
  return withoutBlogEntries.replace("</urlset>", `${blogLines}\n</urlset>`);
}

async function fetchPublishedExperienceFromFeed(feedUrl) {
  const response = await fetch(feedUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: "{}",
  });
  if (!response.ok) {
    throw new Error(`Community blog feed failed with HTTP ${response.status}`);
  }
  return buildExperience(await response.json());
}

async function loadPayload({ feedUrl, inputFile }) {
  if (inputFile) {
    return buildExperience(JSON.parse(await fs.readFile(inputFile, "utf8")));
  }
  return await fetchPublishedExperienceFromFeed(feedUrl);
}

async function syncRoot(rootDir, experience) {
  const dataDir = path.join(rootDir, "data");
  const blogDir = path.join(rootDir, "blog");
  const sitemapPath = path.join(rootDir, "sitemap.xml");
  await fs.mkdir(dataDir, { recursive: true });
  await fs.rm(blogDir, { recursive: true, force: true });
  await fs.mkdir(blogDir, { recursive: true });

  await fs.writeFile(
    path.join(dataDir, "blogs.json"),
    `${JSON.stringify({
      generatedAt: new Date(experience.generatedAtMs).toISOString(),
      posts: experience.posts,
      externalHighlights: experience.externalHighlights,
    }, null, 2)}\n`,
    "utf8"
  );
  await fs.writeFile(path.join(blogDir, "index.html"), renderBlogIndexPage(experience, experience.generatedAtMs), "utf8");
  await fs.writeFile(path.join(blogDir, "feed.xml"), `${renderRssFeed(experience, experience.generatedAtMs)}\n`, "utf8");

  for (const post of experience.posts) {
    const postDir = path.join(blogDir, post.slug);
    await fs.mkdir(postDir, { recursive: true });
    await fs.writeFile(path.join(postDir, "index.html"), renderBlogPostPage(post, experience), "utf8");
  }

  const existingSitemap = await fs.readFile(sitemapPath, "utf8");
  await fs.writeFile(path.join(rootDir, "sitemap.xml"), `${updateSitemapXml(existingSitemap, experience.posts, experience.generatedAtMs)}\n`, "utf8");
}

function parseArgs(argv) {
  const parsed = {
    feedUrl: process.env.WEBSITE_COMMUNITY_BLOGS_FEED_URL || DEFAULT_FEED_URL,
    inputFile: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--feed-url") {
      parsed.feedUrl = argv[index + 1] || parsed.feedUrl;
      index += 1;
      continue;
    }
    if (current === "--input-file") {
      parsed.inputFile = argv[index + 1] ? path.resolve(process.cwd(), argv[index + 1]) : "";
      index += 1;
      continue;
    }
    if (current === "--help") {
      process.stdout.write(
        "Usage: node website/scripts/sync-community-blogs.mjs [--feed-url <url>] [--input-file <json>]\n"
      );
      process.exit(0);
    }
  }
  return parsed;
}

export async function syncCommunityBlogs(options = {}) {
  const experience = await loadPayload({
    feedUrl: options.feedUrl || DEFAULT_FEED_URL,
    inputFile: options.inputFile || "",
  });
  for (const rootDir of websiteRoots) {
    await syncRoot(rootDir, experience);
  }
  return experience;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isDirectRun) {
  const args = parseArgs(process.argv.slice(2));
  syncCommunityBlogs(args)
    .then((payload) => {
      process.stdout.write(`Synced ${payload.posts.length} published community blog post(s).\n`);
    })
    .catch((error) => {
      process.stderr.write(`Community blog sync failed: ${String(error?.message || error)}\n`);
      process.exitCode = 1;
    });
}

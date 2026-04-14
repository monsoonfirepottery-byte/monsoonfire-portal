(() => {
  const teaserContainer = document.querySelector('[data-updates-teasers]');
  const listContainer = document.querySelector('[data-updates-list]');
  const generatedLabel = document.querySelector('[data-updates-generated]');
  if (!teaserContainer && !listContainer) return;

  const safeText = (value) => (typeof value === 'string' ? value : '');

  const formatDate = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  };

  const isSafeUrl = (value) => {
    if (typeof value !== 'string') return false;
    const raw = value.trim();
    if (!raw || raw.startsWith('javascript:')) return false;
    if (raw.startsWith('/')) return true;
    try {
      const parsed = new URL(raw, window.location.href);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  };

  const buildButton = (item, compact) => {
    if (!item || !item.ctaLabel || !isSafeUrl(item.ctaUrl)) return null;
    const link = document.createElement('a');
    link.className = `button ${compact ? 'button-ghost' : 'button-primary'}`;
    link.href = item.ctaUrl;
    link.textContent = item.ctaLabel;
    if (/^https?:\/\//i.test(item.ctaUrl)) {
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    }
    return link;
  };

  const buildImage = (item) => {
    const asset = item?.asset;
    if (!asset || !asset.sitePath || !isSafeUrl(asset.sitePath)) return null;

    const figure = document.createElement('figure');
    figure.className = 'update-card-asset';

    const image = document.createElement('img');
    image.loading = 'lazy';
    image.src = asset.sitePath;
    image.alt = asset.alt || item.title || 'Studio update';
    figure.appendChild(image);

    return figure;
  };

  const createCard = (item, { compact = false } = {}) => {
    const article = document.createElement('article');
    article.className = `update-card ${compact ? 'update-card--teaser' : 'update-card--full'}`;

    const image = buildImage(item);
    if (image) {
      article.appendChild(image);
    } else {
      article.classList.add('update-card--no-asset');
    }

    const content = document.createElement('div');
    content.className = 'update-card-content';

    const meta = document.createElement('div');
    meta.className = 'update-card-meta';
    const category = document.createElement('span');
    category.className = 'update-card-category';
    category.textContent = safeText(item.categoryLabel || item.category || 'Update');
    const publishDate = document.createElement('span');
    publishDate.textContent = formatDate(item.publishAt);
    meta.append(category, publishDate);

    const title = document.createElement('h2');
    title.className = 'update-card-title';
    title.textContent = safeText(item.title || 'Studio update');

    const summary = document.createElement('p');
    summary.className = 'update-card-summary';
    summary.textContent = safeText(item.summary || '');

    content.append(meta, title, summary);

    if (!compact && Array.isArray(item.bodyParagraphs) && item.bodyParagraphs.length > 0) {
      const body = document.createElement('div');
      body.className = 'update-body';
      item.bodyParagraphs.forEach((paragraph) => {
        const node = document.createElement('p');
        node.textContent = safeText(paragraph);
        body.appendChild(node);
      });
      content.appendChild(body);
    }

    const button = buildButton(item, compact);
    if (button) {
      const row = document.createElement('div');
      row.className = 'cta-row';
      row.appendChild(button);
      content.appendChild(row);
    }

    article.appendChild(content);
    return article;
  };

  const renderEmpty = (container, message) => {
    if (!container) return;
    container.replaceChildren();
    const empty = document.createElement('div');
    empty.className = 'update-empty';
    empty.textContent = message;
    container.appendChild(empty);
  };

  const renderTeasers = (data) => {
    if (!teaserContainer) return;
    const items = Array.isArray(data?.homepageTeasers) && data.homepageTeasers.length
      ? data.homepageTeasers
      : Array.isArray(data?.items)
        ? data.items.slice(0, 3)
        : [];
    if (!items.length) {
      renderEmpty(teaserContainer, 'Public updates are quiet right now. We will post the next bulletin when the studio has something to share.');
      return;
    }
    teaserContainer.replaceChildren(...items.map((item) => createCard(item, { compact: true })));
  };

  const renderList = (data) => {
    if (!listContainer) return;
    const items = Array.isArray(data?.items) ? data.items : [];
    if (!items.length) {
      renderEmpty(listContainer, 'Public updates are quiet right now. We will post the next bulletin when the studio has something to share.');
      return;
    }
    listContainer.replaceChildren(...items.map((item) => createCard(item, { compact: false })));
  };

  renderEmpty(teaserContainer, 'Syncing the latest public bulletin.');
  renderEmpty(listContainer, 'Syncing the latest public bulletin.');

  fetch('/data/announcements.json', { cache: 'no-store' })
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => {
      if (!data) {
        renderEmpty(teaserContainer, 'Public updates are temporarily unavailable. Check back shortly for the latest bulletin.');
        renderEmpty(listContainer, 'Public updates are temporarily unavailable. Check back shortly for the latest bulletin.');
        return;
      }
      if (generatedLabel) {
        generatedLabel.textContent = formatDate(data.generatedAtUtc) || 'Unavailable';
      }
      renderTeasers(data);
      renderList(data);
    })
    .catch(() => {
      renderEmpty(teaserContainer, 'Public updates are temporarily unavailable. Check back shortly for the latest bulletin.');
      renderEmpty(listContainer, 'Public updates are temporarily unavailable. Check back shortly for the latest bulletin.');
    });
})();

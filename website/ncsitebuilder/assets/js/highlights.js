(() => {
  const safeText = (value) => (typeof value === 'string' ? value : '');
  const formatText = (value) => (typeof value === 'string' ? value : '');

  const setText = (selector, value) => {
    const el = document.querySelector(selector);
    if (!el) return;

    const text = formatText(value);
    if (text) {
      el.textContent = text;
    } else {
      el.textContent = '';
    }
  };

  const isSafeHttpUrl = (value) => {
    if (typeof value !== 'string') return false;
    const raw = value.trim();
    if (!raw || raw.startsWith('javascript:')) return false;
    try {
      const parsed = new URL(raw, window.location.href);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  };

  const setImage = (selector, src, alt) => {
    const img = document.querySelector(selector);
    if (!img) return;
    if (isSafeHttpUrl(src)) {
      img.src = String(src);
    }
    img.alt = safeText(alt) || 'Image';
  };

  const parseDate = (value, endOfDay = false) => {
    if (!value) return null;
    const parts = String(value).split('-').map(Number);
    if (parts.length === 3 && parts.every((part) => Number.isFinite(part))) {
      const [year, month, day] = parts;
      return endOfDay
        ? new Date(year, month - 1, day, 23, 59, 59, 999)
        : new Date(year, month - 1, day);
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  };

  const getMonthLabel = (value) => {
    const date = parseDate(value);
    if (!date) return '';
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  };

  const isWithinRange = (now, start, end) => {
    const startDate = parseDate(start);
    const endDate = parseDate(end, true);
    if (!startDate || !endDate) return false;
    return now >= startDate && now <= endDate;
  };

  const selectFeaturedPotter = (data) => {
    if (!data || !Array.isArray(data.potters) || !data.potters.length) {
      return { potter: data?.potter || {}, pieces: data?.featuredPieces || [], archive: [], upcoming: null };
    }

    const now = new Date();
    let featured = data.potters.find((potter) => isWithinRange(now, potter.start, potter.end)) || null;
    const monthLabel = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    if (!featured && data.rotateMonthly) {
      featured = data.potters.find((potter) => potter.month === monthLabel) || null;
    }
    if (!featured) {
      featured = data.potters.find((potter) => potter.featured) || data.potters[0];
    }

    const pieces = Array.isArray(featured?.pieces) ? featured.pieces : [];
    const archive = data.potters.filter((potter) => potter !== featured);
    const upcoming = data.potters
      .filter((potter) => potter.start && parseDate(potter.start) && parseDate(potter.start) > now)
      .sort((a, b) => parseDate(a.start) - parseDate(b.start))[0];

    return { potter: featured || {}, pieces, archive, upcoming };
  };

  const appendPieceCard = (grid, piece) => {
    const figure = document.createElement('figure');

    const img = document.createElement('img');
    img.loading = 'lazy';
    if (isSafeHttpUrl(piece.image)) {
      img.src = piece.image;
    }
    img.alt = piece.alt || piece.caption || 'Featured work';
    figure.appendChild(img);

    if (piece.caption) {
      const caption = document.createElement('figcaption');
      caption.textContent = piece.caption;
      figure.appendChild(caption);
    }

    grid.appendChild(figure);
  };

  const appendArchiveCard = (archiveList, item) => {
    const li = document.createElement('li');
    li.className = 'archive-card';

    const monthEl = document.createElement('span');
    monthEl.textContent = item.month || getMonthLabel(item.start) || 'Previous feature';

    const nameEl = document.createElement('strong');
    nameEl.textContent = item.name || 'Featured potter';

    const desc = document.createElement('p');
    const focus = item.focus ? ` · ${item.focus}` : '';
    const location = item.location ? ` · ${item.location}` : '';
    desc.textContent = `${focus}${location}`.trim();

    li.append(monthEl, nameEl, desc);
    archiveList.appendChild(li);
  };

  const updateHighlights = (data) => {
    if (!data) return;

    const { potter, pieces, archive } = selectFeaturedPotter(data);
    const scheduledMonth = safeText(potter.month || getMonthLabel(potter.start) || data.month);
    setText('[data-highlight-month]', scheduledMonth);
    setText('[data-highlight-name]', potter.name);
    setText('[data-highlight-bio]', potter.bio);
    setText('[data-highlight-focus]', potter.focus);
    setText('[data-highlight-clay]', potter.clayBody);
    setText('[data-highlight-location]', potter.location);
    setImage('[data-highlight-image]', potter.image, potter.imageAlt || `Work by ${potter.name || 'featured potter'}`);

    const handleEl = document.querySelector('[data-highlight-handle]');
    if (handleEl) {
      if (potter.instagram) {
        const handle = potter.instagram.startsWith('@') ? potter.instagram : `@${potter.instagram}`;
        const handleValue = handle.replace('@', '');
        const url = isSafeHttpUrl(potter.instagramUrl) ? potter.instagramUrl : `https://instagram.com/${handleValue}`;
        handleEl.textContent = handle;
        handleEl.href = url;
        handleEl.classList.remove("is-hidden");
      } else {
        handleEl.classList.add("is-hidden");
      }
    }

    const grid = document.querySelector('[data-highlight-grid]');
    if (grid) {
      grid.replaceChildren();
      if (Array.isArray(pieces) && pieces.length) {
        pieces.forEach((piece) => appendPieceCard(grid, piece));
      }
    }

    const archiveList = document.querySelector('[data-archive-list]');
    if (archiveList) {
      archiveList.replaceChildren();
      if (Array.isArray(archive) && archive.length) {
        archive.forEach((item) => appendArchiveCard(archiveList, item));
      }
    }
  };

  fetch('/data/highlights.json', { cache: 'no-store' })
    .then((res) => (res.ok ? res.json() : null))
    .then(updateHighlights)
    .catch(() => {});
})();

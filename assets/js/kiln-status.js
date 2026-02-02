(() => {
  const list = document.querySelector('[data-kiln-list]');
  const updated = document.querySelector('[data-kiln-updated]');
  if (!list) return;

  const renderKiln = (kiln) => {
    const controller = kiln.controller || '—';
    const nextFireType = kiln.nextFireType || '—';
    const planned = kiln.nextFirePlanned || '—';
    const ready = kiln.readyForPickup || '—';
    const notes = kiln.notes || '';

    return `
      <div class="kiln-info">
        <div class="kiln-name">${kiln.name || 'Kiln'}</div>
        <div class="kiln-detail"><span>Controller</span><strong>${controller}</strong></div>
        <div class="kiln-detail"><span>Next fire</span><strong>${nextFireType}</strong></div>
        <div class="kiln-detail"><span>Planned</span><strong>${planned}</strong></div>
        <div class="kiln-detail"><span>Ready for pickup</span><strong>${ready}</strong></div>
        ${notes ? `<div class="kiln-notes">${notes}</div>` : ''}
      </div>
    `;
  };

  const load = async () => {
    try {
      const res = await fetch('/data/kiln-status.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('Kiln status not available');
      const data = await res.json();
      list.innerHTML = data.kilns && data.kilns.length
        ? data.kilns.map(renderKiln).join('')
        : '<div>Manual status is not set yet.</div>';
      if (updated && data.lastUpdated) {
        updated.textContent = data.lastUpdated;
      }
    } catch (err) {
      list.innerHTML = '<div>Manual status is currently unavailable.</div>';
    }
  };

  load();
})();

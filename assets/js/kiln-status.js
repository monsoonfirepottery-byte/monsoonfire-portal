(() => {
  const list = document.querySelector('[data-kiln-list]');
  const updated = document.querySelector('[data-kiln-updated]');
  if (!list) return;

  const stateClass = (state) => {
    const key = String(state || '').toLowerCase();
    if (!key) return 'state-idle';
    if (key.includes('heat')) return 'state-heating';
    if (key.includes('hold')) return 'state-holding';
    if (key.includes('cool')) return 'state-cooling';
    if (key.includes('off')) return 'state-offline';
    if (key.includes('idle')) return 'state-idle';
    return 'state-idle';
  };

  const renderKiln = (kiln) => {
    const state = kiln.state || 'Idle';
    const temp = kiln.currentTempF ? `${kiln.currentTempF}°F` : '—';
    const target = kiln.targetTempF ? `${kiln.targetTempF}°F` : '—';
    const program = kiln.programName || '—';
    const segment = kiln.segment || '—';
    const cone = kiln.cone || '—';
    const eta = kiln.eta || '—';
    const notes = kiln.notes || '';

    return `
      <div>
        <div class="status-pill ${stateClass(state)}">${state}</div>
        <div style="margin-top: 10px; font-weight: 600;">${kiln.name || 'Kiln'}</div>
        <div style="font-size: 14px; margin-top: 6px;">${program}</div>
      </div>
      <div>
        <div class="status-label">Current</div>
        <div style="font-size: 18px; font-weight: 600;">${temp}</div>
      </div>
      <div>
        <div class="status-label">Target</div>
        <div style="font-size: 18px; font-weight: 600;">${target}</div>
      </div>
      <div>
        <div class="status-label">Segment</div>
        <div style="font-size: 14px;">${segment}</div>
      </div>
      <div>
        <div class="status-label">Cone</div>
        <div style="font-size: 14px;">${cone}</div>
      </div>
      <div>
        <div class="status-label">ETA</div>
        <div style="font-size: 14px;">${eta}</div>
      </div>
      <div style="grid-column: 1 / -1; font-size: 13px; opacity: 0.8;">${notes}</div>
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

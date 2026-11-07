export type FiringWorkSlipTicket = {
  ticketId: string;
  displayName: string;
  heatLabel: string;
  estimatedSpace: string | null;
  artistNote: string | null;
  createdAt: string | null;
};

type FiringWorkSlipOptions = {
  printedAt?: Date;
  reprint?: boolean;
};

const MAX_ARTIST_NOTE_LENGTH = 360;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function boundedText(value: string | null | undefined, fallback: string, maxLength = 160): string {
  const normalized = value?.replace(/\s+/gu, " ").trim() ?? "";
  if (!normalized) return fallback;
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function formatPhoenixTime(value: Date): string {
  if (Number.isNaN(value.getTime())) return "Not recorded";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Phoenix",
    month: "2-digit",
    day: "2-digit",
    year: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

export function buildFiringWorkSlipDocument(
  ticket: FiringWorkSlipTicket,
  options: FiringWorkSlipOptions = {},
): string {
  const printedAt = options.printedAt ?? new Date();
  const ticketId = escapeHtml(boundedText(ticket.ticketId, "Reference unavailable", 80));
  const displayName = escapeHtml(boundedText(ticket.displayName, "Artist name needed", 120));
  const heatLabel = escapeHtml(boundedText(ticket.heatLabel, "Firing range needs review", 120));
  const estimatedSpace = escapeHtml(boundedText(ticket.estimatedSpace, "Studio fit check", 120));
  const artistNote = escapeHtml(
    boundedText(ticket.artistNote, "No artist note.", MAX_ARTIST_NOTE_LENGTH),
  );
  const submittedAt = ticket.createdAt
    ? formatPhoenixTime(new Date(ticket.createdAt))
    : "Not recorded";
  const reprintBadge = options.reprint
    ? '<strong class="reprint">REPRINT</strong>'
    : "";
  const reprintNote = options.reprint
    ? "<p><strong>Previously printed.</strong> Confirm the earlier copy is accounted for.</p>"
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Firing work slip ${ticketId}</title>
  <style>
    @page { size: 72mm auto; margin: 0; }
    * { box-sizing: border-box; }
    html, body {
      width: 72mm;
      margin: 0;
      padding: 0;
      background: #fff;
      color: #000;
      font-family: Arial, Helvetica, sans-serif;
      font-size: 10pt;
      line-height: 1.28;
    }
    main {
      width: 67mm;
      margin: 0 auto;
      padding: 2mm 2.5mm 4mm;
      border: .35mm solid #000;
    }
    h1, h2, p, dl { margin: 0; }
    header {
      padding-bottom: 2.5mm;
      border-bottom: 1mm solid #000;
      text-align: center;
    }
    .brand-mark {
      display: block;
      width: 20mm;
      height: 20mm;
      margin: 0 auto 1mm;
      object-fit: contain;
      filter: grayscale(1) contrast(2);
    }
    .brand-name {
      font-size: 16pt;
      line-height: 1;
      font-weight: 700;
      letter-spacing: .04em;
    }
    .slip-label {
      margin-top: 1.2mm;
      font-size: 9pt;
      font-weight: 700;
      letter-spacing: .08em;
      text-transform: uppercase;
    }
    h1 {
      margin-top: 2mm;
      font-size: 24pt;
      line-height: 1;
      overflow-wrap: anywhere;
    }
    .reprint {
      display: inline-block;
      margin-top: 2mm;
      padding: 1mm 2mm;
      border: .6mm solid #000;
      font-size: 9pt;
      letter-spacing: .08em;
    }
    dl {
      margin-top: 2mm;
      padding: 1.4mm 2mm;
      border: .6mm solid #000;
      border-radius: 1.5mm;
    }
    dl div {
      display: grid;
      grid-template-columns: 19mm 1fr;
      gap: 2mm;
      padding: .9mm 0;
    }
    dt { font-size: 8pt; font-weight: 700; text-transform: uppercase; }
    dd { margin: 0; font-size: 11pt; font-weight: 700; overflow-wrap: anywhere; }
    section {
      padding: 2mm 0;
      border-bottom: .5mm solid #000;
      break-inside: avoid;
    }
    h2 {
      margin-bottom: 1.5mm;
      font-size: 11pt;
      letter-spacing: .06em;
      text-transform: uppercase;
    }
    .line { min-height: 7mm; border-bottom: .35mm solid #000; }
    .check {
      display: grid;
      grid-template-columns: 4mm 1fr;
      gap: 1.5mm;
      margin: 1.2mm 0;
    }
    .box { width: 3.5mm; height: 3.5mm; border: .45mm solid #000; }
    .note {
      min-height: 13mm;
      overflow-wrap: anywhere;
    }
    footer {
      padding-top: 2mm;
      font-size: 8.5pt;
      font-weight: 700;
    }
    footer p + p { margin-top: 1.5mm; }
    @media screen {
      body { width: 80mm; background: #ececec; }
      main { width: 72mm; padding: 4mm; background: #fff; box-shadow: 0 0 3mm rgba(0,0,0,.18); }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <img class="brand-mark" src="/branding/logo.png" alt="Monsoon Fire logo" data-print-logo>
      <p class="brand-name">MONSOON FIRE</p>
      <p class="slip-label">Firing work slip - temporary studio aid</p>
      <h1>${ticketId}</h1>
      ${reprintBadge}
    </header>
    <dl>
      <div><dt>Artist</dt><dd>${displayName}</dd></div>
      <div><dt>Range</dt><dd>${heatLabel}</dd></div>
      <div><dt>Requested</dt><dd>${estimatedSpace}</dd></div>
      <div><dt>Submitted</dt><dd>${escapeHtml(submittedAt)}</dd></div>
    </dl>
    <section>
      <h2>Physical intake</h2>
      <p>Received</p><div class="line"></div>
      <p>Staff</p><div class="line"></div>
      <p>Piece count</p><div class="line"></div>
      <p>Tray / shelf</p><div class="line"></div>
    </section>
    <section>
      <h2>Intake check</h2>
      <div class="check"><span class="box"></span><span>Clay body / firing range checked</span></div>
      <div class="check"><span class="box"></span><span>Glaze bottoms and risky surfaces checked</span></div>
      <div class="check"><span class="box"></span><span>Tall, wide, or special handling reviewed</span></div>
    </section>
    <section>
      <h2>Artist note</h2>
      <p class="note">${artistNote}</p>
    </section>
    <footer>
      <p>The digital ticket controls. This slip is temporary and must stay with cool staging - not near kiln heat or hot ware.</p>
      <p>Printed ${escapeHtml(formatPhoenixTime(printedAt))} - Phoenix time</p>
      ${reprintNote}
    </footer>
  </main>
</body>
</html>`;
}

export function openFiringWorkSlipPrintWindow(
  ticket: FiringWorkSlipTicket,
  options: FiringWorkSlipOptions = {},
): boolean {
  const popup = window.open("", "_blank", "popup,width=440,height=760");
  if (!popup) return false;

  try {
    popup.opener = null;
  } catch {
    // Some browsers protect opener assignment. Printing remains local and staff-initiated.
  }
  popup.document.open();
  popup.document.write(buildFiringWorkSlipDocument(ticket, options));
  popup.document.close();
  popup.focus();
  popup.addEventListener("afterprint", () => popup.close(), { once: true });
  const printOnce = (() => {
    let printed = false;
    return () => {
      if (printed) return;
      printed = true;
      popup.print();
    };
  })();
  const logo = popup.document.querySelector?.("[data-print-logo]") as HTMLImageElement | null | undefined;
  if (logo && !logo.complete) {
    logo.addEventListener("load", printOnce, { once: true });
    logo.addEventListener("error", printOnce, { once: true });
    popup.setTimeout(printOnce, 1200);
  } else {
    popup.setTimeout(printOnce, 120);
  }
  return true;
}

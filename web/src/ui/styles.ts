// src/ui/styles.ts
import type React from "react";

/**
 * Shared UI style tokens (web reference implementation).
 *
 * Goal:
 * - Reduce duplication across components
 * - Make the “design system” explicit (helps SwiftUI parity later)
 *
 * No runtime behavior changes; these are just reusable style objects.
 */

export const ui = {
  colors: {
    bg: "#1f1f1f",
    text: "#f5f5f5",
    warn: "#ffd1a8",
    cardBg: "rgba(255,255,255,0.04)",
    cardBorder: "1px solid rgba(255,255,255,0.08)",
    inputBg: "rgba(0,0,0,0.25)",
    inputBorder: "1px solid rgba(255,255,255,0.14)",
    btnBg: "rgba(0,0,0,0.35)",
    btnBorder: "1px solid rgba(255,255,255,0.14)",

    // timeline row tokens
    rowBg: "rgba(0,0,0,0.18)",
    rowBorder: "1px solid rgba(255,255,255,0.08)",
  },
  fontFamily:
    "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, 'Apple Color Emoji','Segoe UI Emoji'",
} as const;

export const styles: Record<string, React.CSSProperties> = {
  // layout
  page: {
    minHeight: "100vh",
    background: ui.colors.bg,
    color: ui.colors.text,
    padding: 28,
    fontFamily: ui.fontFamily,
  },
  container: {
    maxWidth: 980,
    margin: "0 auto",
    display: "flex",
    flexDirection: "column",
    gap: 18,
  },

  // list helpers
  stack: { display: "flex", flexDirection: "column", gap: 10 },

  // tiny layout helpers
  flex1: { flex: 1 },

  // text
  muted: { opacity: 0.75 },
  h1: { fontSize: 56, fontWeight: 800, letterSpacing: -1, marginTop: 10 },
  h2: { fontSize: 18, fontWeight: 700 },
  sectionTitle: { fontSize: 44, fontWeight: 800, marginTop: 10 },
  warn: { color: ui.colors.warn, marginTop: 12, marginBottom: 12 },

  // surfaces
  card: {
    background: ui.colors.cardBg,
    border: ui.colors.cardBorder,
    borderRadius: 18,
    padding: 18,
  },
  batchCard: {
    background: ui.colors.cardBg,
    border: ui.colors.cardBorder,
    borderRadius: 18,
    padding: 16,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  },

  // timeline row
  timelineRow: {
    display: "flex",
    gap: 12,
    padding: 12,
    borderRadius: 14,
    border: ui.colors.rowBorder,
    background: ui.colors.rowBg,
  },
  timelineAt: { width: 170, opacity: 0.8, fontSize: 12, paddingTop: 2 },
  timelineType: { fontWeight: 800, fontSize: 14 },
  timelineMeta: { opacity: 0.75, fontSize: 12, marginTop: 2 },
  timelineNotes: { marginTop: 6, fontSize: 13, opacity: 0.92 },

  // controls
  row: { display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" },
  rowBetween: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  input: {
    width: "100%",
    padding: "12px 14px",
    borderRadius: 12,
    border: ui.colors.inputBorder,
    background: ui.colors.inputBg,
    color: "#fff",
    outline: "none",
    fontSize: 14,
  },
  btn: {
    padding: "10px 16px",
    borderRadius: 12,
    border: ui.colors.btnBorder,
    background: ui.colors.btnBg,
    color: "#fff",
    fontSize: 14,
    cursor: "pointer",
  },
  btnSmall: {
    padding: "10px 14px",
    borderRadius: 12,
    border: ui.colors.btnBorder,
    background: ui.colors.btnBg,
    color: "#fff",
    fontSize: 14,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },

  // misc
  pre: {
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    background: ui.colors.inputBg,
    border: ui.colors.cardBorder,
    borderRadius: 12,
    padding: 12,
    fontSize: 12,
    lineHeight: 1.35,
    marginTop: 6,
  },
};

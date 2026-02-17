import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";

type Props = {
  as?: "div" | "section" | "article" | "details";
  className: string;
  children: ReactNode;
  index?: number;
  enabled?: boolean;
};

type RevealElement = HTMLDivElement | HTMLElement | HTMLDetailsElement;

export default function RevealCard({
  as = "div",
  className,
  children,
  index = 0,
  enabled = true,
}: Props) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const ref = useRef<RevealElement | null>(null);
  const [revealed, setRevealed] = useState(() => prefersReducedMotion || !enabled);
  const setNodeRef = (node: RevealElement | null) => {
    ref.current = node;
  };

  useEffect(() => {
    if (prefersReducedMotion || !enabled) return;
    const node = ref.current;
    if (!node) return;

    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        if (entry.isIntersecting) {
          setRevealed(true);
          io.disconnect();
        }
      },
      {
        root: null,
        // Slightly before it hits center, like Apple’s sequences.
        rootMargin: "0px 0px -14% 0px",
        threshold: 0.15,
      }
    );
    io.observe(node);
    return () => io.disconnect();
  }, [prefersReducedMotion, enabled]);

  const Tag = as;
  const delayClass = `reveal-card-delay-${Math.max(0, Math.min(20, Math.trunc(index)))}`;
  return (
    <Tag
      ref={setNodeRef}
      className={`reveal-card ${className} ${delayClass}`}
      data-revealed={revealed || !enabled ? "true" : "false"}
    >
      {children}
    </Tag>
  );
}

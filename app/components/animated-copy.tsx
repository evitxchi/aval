"use client";
import { useEffect, useState } from "react";
/** Reserve the complete text's height; announce it once, never character by character. */
export function AnimatedCopy({ text }: { text: string }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = performance.now();
    const duration = Math.min(850, text.length * 8);
    let frame = 0;
    const tick = (now: number) => {
      setCount(reduced ? text.length : Math.min(text.length, Math.floor((now - start) / Math.max(1, duration) * text.length)));
      if (!reduced && now - start < duration) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [text]);
  return <span className="animated-copy"><span className="sr-only">{text}</span><span aria-hidden="true" className="animated-copy-space">{text}</span><span aria-hidden="true" className="animated-copy-text">{text.slice(0, count)}{count < text.length && <i/>}</span></span>;
}

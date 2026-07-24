/**
 * Shared inline SVG icons — no icon-library dependency. Each accepts standard
 * `SVGProps` (size via width/height, styling via className) and strokes with
 * `currentColor`, so it inherits the parent's text color and drops into any
 * component. New reusable icons belong here, not inlined in a component.
 */
import type { SVGProps } from "react";

const DEFAULT_SIZE = 16;

export function SendIcon({ width = DEFAULT_SIZE, height = DEFAULT_SIZE, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg width={width} height={height} viewBox="0 0 16 16" fill="none" aria-hidden="true" {...props}>
      <path
        d="M8 13V3M8 3L4.5 6.5M8 3l3.5 3.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CloseIcon({ width = DEFAULT_SIZE, height = DEFAULT_SIZE, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg width={width} height={height} viewBox="0 0 16 16" fill="none" aria-hidden="true" {...props}>
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function DownloadIcon({ width = DEFAULT_SIZE, height = DEFAULT_SIZE, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg width={width} height={height} viewBox="0 0 16 16" fill="none" aria-hidden="true" {...props}>
      <path
        d="M8 2v8m0 0L5 7m3 3l3-3M3 13h10"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Down chevron — rotate it (e.g. -90deg) to signal a collapsed section. */
export function ChevronIcon({ width = DEFAULT_SIZE, height = DEFAULT_SIZE, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg width={width} height={height} viewBox="0 0 16 16" fill="none" aria-hidden="true" {...props}>
      <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Graduation cap — the app / assistant mark. */
export function CapIcon({ width = DEFAULT_SIZE, height = DEFAULT_SIZE, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg width={width} height={height} viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M2 8.5L12 4l10 4.5-10 4.5L2 8.5z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M6 10.5V15c0 1.1 2.7 2.5 6 2.5s6-1.4 6-2.5v-4.5M22 8.5v5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

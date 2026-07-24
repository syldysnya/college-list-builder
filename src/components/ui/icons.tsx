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

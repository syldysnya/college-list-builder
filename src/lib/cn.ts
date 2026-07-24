/**
 * `cn` — merge conditional class names, then dedupe conflicting Tailwind
 * utilities (last one wins). Used by every component for `className` passthrough.
 */
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

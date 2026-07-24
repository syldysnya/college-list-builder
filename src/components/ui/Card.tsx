/**
 * `Card` — a content surface for school entries and grouped content: a white
 * fill with a hairline outline and rounded corners (the component's own border,
 * not a divider between sections).
 */
import { cn } from "@/lib/cn";

export type CardProps = React.HTMLAttributes<HTMLDivElement>;

export function Card({ className, ...props }: CardProps) {
  return (
    <div
      className={cn("rounded-xl border border-border bg-card text-foreground", className)}
      {...props}
    />
  );
}

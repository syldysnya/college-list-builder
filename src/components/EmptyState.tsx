/**
 * `EmptyState` — the chat welcome, shown before the first message: the brand
 * mark, a heading, and a short description of what the tool does.
 */
import { content } from "@/lib/content";
import { CapIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

export interface EmptyStateProps {
  className?: string;
}

export function EmptyState({ className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex h-full flex-col items-center justify-center gap-4 px-6 text-center",
        className,
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-2 text-primary-foreground shadow-bubble">
        <CapIcon width={24} height={24} />
      </div>
      <h2 className="text-xl font-semibold">{content.ui.emptyHeading}</h2>
      <p className="max-w-md text-sm text-muted-foreground">{content.ui.emptySubtext}</p>
    </div>
  );
}

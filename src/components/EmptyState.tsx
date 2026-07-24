/**
 * `EmptyState` — shown in the list panel before a list exists. Heading + subtext
 * plus clickable example chips that seed the conversation.
 */
import { content } from "@/lib/content";
import { cn } from "@/lib/cn";

export interface EmptyStateProps {
  onExampleSelect: (prompt: string) => void;
  className?: string;
}

export function EmptyState({ onExampleSelect, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex h-full flex-col items-center justify-center gap-4 px-6 text-center",
        className,
      )}
    >
      <h2 className="text-xl font-semibold">{content.ui.emptyHeading}</h2>
      <p className="max-w-sm text-sm text-muted-foreground">{content.ui.emptySubtext}</p>
      <div className="flex w-full max-w-sm flex-col gap-2">
        {content.examples.map((example) => (
          <button
            key={example.label}
            type="button"
            onClick={() => onExampleSelect(example.prompt)}
            className="rounded-lg border border-border bg-accent px-4 py-2 text-left text-sm text-accent-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {example.label}
          </button>
        ))}
      </div>
    </div>
  );
}

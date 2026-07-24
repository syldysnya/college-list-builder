/**
 * `EmptyState` — the chat welcome, shown before the first message. Heading +
 * subtext plus clickable example chips that seed the conversation. (The list
 * panel stays hidden until a list is generated.)
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
            className="rounded-xl bg-muted px-4 py-3 text-left text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {example.label}
          </button>
        ))}
      </div>
    </div>
  );
}

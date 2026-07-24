/**
 * `ListPanel` — the right panel. Renders the tiered `CollegeList` with an
 * assumptions note and a Download-PDF button (disabled until a list exists);
 * falls back to `EmptyState` (with example chips) when there is no list yet.
 */
import { TIERS, type CollegeList } from "@/lib/types";
import { content } from "@/lib/content";
import { Button } from "@/components/ui/Button";
import { TierSection } from "@/components/TierSection";
import { EmptyState } from "@/components/EmptyState";
import { cn } from "@/lib/cn";

export interface ListPanelProps {
  list: CollegeList | null;
  onDownload: () => void;
  onExampleSelect: (prompt: string) => void;
  isDownloading?: boolean;
  className?: string;
}

export function ListPanel({
  list,
  onDownload,
  onExampleSelect,
  isDownloading = false,
  className,
}: ListPanelProps) {
  return (
    <div className={cn("flex h-full min-h-0 flex-col bg-background", className)}>
      <header className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
        <h2 className="text-lg font-semibold">{content.ui.listHeading}</h2>
        <Button onClick={onDownload} disabled={list === null || isDownloading}>
          {content.ui.downloadLabel}
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {list === null ? (
          <EmptyState onExampleSelect={onExampleSelect} />
        ) : (
          <div className="flex flex-col gap-6">
            {TIERS.map((tier) => (
              <TierSection key={tier} tier={tier} schools={list[tier]} />
            ))}
            {list.assumptions.length > 0 && (
              <section className="flex flex-col gap-2 border-t border-border pt-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {content.ui.assumptionsHeading}
                </h3>
                <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
                  {list.assumptions.map((assumption) => (
                    <li key={assumption}>{assumption}</li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

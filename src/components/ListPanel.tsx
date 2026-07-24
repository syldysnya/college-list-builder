/**
 * `ListPanel` — the artifact-style panel that slides in on the right once a list
 * exists. Header carries the title, a Download-PDF button, and a close (X); the
 * body renders the tiered `CollegeList` with its assumptions note. Rendered only
 * when there is a list to show, so `list` is always present here.
 */
import { TIERS, type CollegeList } from "@/lib/types";
import { content } from "@/lib/content";
import { Button } from "@/components/ui/Button";
import { CloseIcon } from "@/components/ui/icons";
import { TierSection } from "@/components/TierSection";
import { cn } from "@/lib/cn";

export interface ListPanelProps {
  list: CollegeList;
  onDownload: () => void;
  onClose: () => void;
  isDownloading?: boolean;
  className?: string;
}

export function ListPanel({
  list,
  onDownload,
  onClose,
  isDownloading = false,
  className,
}: ListPanelProps) {
  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <header className="flex items-center justify-between gap-4 px-6 pt-5 pb-3">
        <h2 className="text-base font-semibold">{content.ui.listHeading}</h2>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={onDownload} disabled={isDownloading}>
            {content.ui.downloadLabel}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label={content.ui.closeLabel}
            className="px-2"
          >
            <CloseIcon />
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-10 pt-2">
        <div className="flex flex-col gap-6">
          {TIERS.map((tier) => (
            <TierSection key={tier} tier={tier} schools={list[tier]} />
          ))}
          {list.assumptions.length > 0 && (
            <section className="flex flex-col gap-2 pt-2">
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
      </div>
    </div>
  );
}

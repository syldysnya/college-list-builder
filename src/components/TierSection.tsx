/**
 * `TierSection` — a tier heading (Reach/Target/Safety) with a colored dot and a
 * count badge, followed by its `SchoolCard`s. Renders nothing when the tier is
 * empty.
 */
import type { Tier, ScoredCollege } from "@/lib/types";
import { content } from "@/lib/content";
import { SchoolCard } from "@/components/SchoolCard";
import { cn } from "@/lib/cn";

export interface TierSectionProps {
  tier: Tier;
  schools: ScoredCollege[];
}

/** Dot color per tier (full classes so Tailwind keeps them). */
const TIER_DOT: Record<Tier, string> = {
  reach: "bg-tier-reach",
  target: "bg-tier-target",
  safety: "bg-tier-safety",
};

export function TierSection({ tier, schools }: TierSectionProps) {
  if (schools.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className={cn("h-2 w-2 rounded-full", TIER_DOT[tier])} aria-hidden="true" />
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {content.tiers[tier]}
        </h3>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {schools.length}
        </span>
      </div>
      <div className="flex flex-col gap-3">
        {schools.map((scored) => (
          <SchoolCard key={scored.college.id} scored={scored} />
        ))}
      </div>
    </section>
  );
}

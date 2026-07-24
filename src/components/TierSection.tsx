/**
 * `TierSection` — a tier heading (Reach/Target/Safety) and its `SchoolCard`s.
 * Renders nothing when the tier is empty.
 */
import type { Tier, ScoredCollege } from "@/lib/types";
import { content } from "@/lib/content";
import { SchoolCard } from "@/components/SchoolCard";

export interface TierSectionProps {
  tier: Tier;
  schools: ScoredCollege[];
}

export function TierSection({ tier, schools }: TierSectionProps) {
  if (schools.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {content.tiers[tier]}
      </h3>
      <div className="flex flex-col gap-3">
        {schools.map((scored) => (
          <SchoolCard key={scored.college.id} scored={scored} />
        ))}
      </div>
    </section>
  );
}

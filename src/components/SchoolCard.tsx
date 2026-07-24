/**
 * `SchoolCard` — one scored college: name, location, a row of stat chips (SAT
 * range or test-optional, admit %, net price), and the curation rationale. A
 * colored left border keys the card to its tier. Stat formatting mirrors the PDF
 * export so screen and print agree.
 */
import type { ScoredCollege, Tier } from "@/lib/types";
import { content } from "@/lib/content";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";

export interface SchoolCardProps {
  scored: ScoredCollege;
  className?: string;
}

const PERCENT_MULTIPLIER = 100;
const SAT_RANGE_SEPARATOR = "–";

/** Left-border accent per tier (full classes so Tailwind keeps them). */
const TIER_ACCENT: Record<Tier, string> = {
  reach: "border-l-tier-reach",
  target: "border-l-tier-target",
  safety: "border-l-tier-safety",
};

interface Stat {
  label?: string;
  value: string;
}

function statChips(college: ScoredCollege["college"]): Stat[] {
  const chips: Stat[] = [];
  if (college.satP25 != null && college.satP75 != null) {
    chips.push({ label: content.stats.sat, value: `${college.satP25}${SAT_RANGE_SEPARATOR}${college.satP75}` });
  } else {
    chips.push({ value: content.stats.testOptional });
  }
  chips.push({
    label: content.stats.admitRate,
    value: `${Math.round(college.admitRate * PERCENT_MULTIPLIER)}%`,
  });
  if (college.netPrice != null) {
    chips.push({
      label: content.stats.netPrice,
      value: `$${Math.round(college.netPrice).toLocaleString("en-US")}`,
    });
  }
  return chips;
}

function StatChip({ label, value }: Stat) {
  return (
    <span className="inline-flex items-baseline gap-1 rounded-full bg-muted px-2.5 py-1 text-xs">
      {label != null && <span className="text-muted-foreground">{label}</span>}
      <span className="font-medium text-foreground">{value}</span>
    </span>
  );
}

export function SchoolCard({ scored, className }: SchoolCardProps) {
  const { college, rationale, tier } = scored;
  return (
    <Card className={cn("flex flex-col gap-2.5 border-l-4 p-4", TIER_ACCENT[tier], className)}>
      <div className="flex flex-col gap-0.5">
        <h4 className="font-semibold leading-tight">{college.name}</h4>
        <p className="text-sm text-muted-foreground">
          {college.city}, {college.state}
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {statChips(college).map((stat) => (
          <StatChip key={stat.label ?? stat.value} label={stat.label} value={stat.value} />
        ))}
      </div>
      {rationale.length > 0 && <p className="text-sm">{rationale}</p>}
      <a
        href={`${content.sources.scorecardSearch}${encodeURIComponent(college.name)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs font-medium text-primary underline decoration-primary/50 decoration-dotted underline-offset-2 transition hover:decoration-primary"
      >
        {content.sources.scorecardLabel}
      </a>
    </Card>
  );
}

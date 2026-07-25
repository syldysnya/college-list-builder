/**
 * `SchoolRow` — one scored college as a row inside the recommended-colleges
 * card: name, location, an admit-chance chip (the ranking signal) plus stat
 * chips (SAT range or test-optional, admit %, net price), the curation
 * rationale, and a source link. Rows are spaced by their own padding (no
 * dividers), so this component carries only padding, not its own border.
 */
import type { ScoredCollege } from "@/lib/types";
import { content } from "@/lib/content";
import { BUBBLE_X_PADDING } from "@/components/spacing";
import { cn } from "@/lib/cn";

export interface SchoolRowProps {
  scored: ScoredCollege;
  className?: string;
}

const PERCENT_MULTIPLIER = 100;
const SAT_RANGE_SEPARATOR = "–";

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

/** The ranking signal — estimated acceptance chance, in brand accent. */
function ChanceChip({ chance }: { chance: number }) {
  return (
    <span className="inline-flex items-baseline gap-1 rounded-full bg-accent px-2.5 py-1 text-xs">
      <span className="text-accent-foreground/70">{content.stats.chance}</span>
      <span className="font-semibold text-accent-foreground">
        {Math.round(chance * PERCENT_MULTIPLIER)}%
      </span>
    </span>
  );
}

/** A labeled write-up paragraph (e.g. "Why it fits"), shown only when non-empty. */
function Writeup({ heading, text }: { heading: string; text: string }) {
  if (text.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{heading}</h5>
      <p className="text-sm">{text}</p>
    </div>
  );
}

export function SchoolRow({ scored, className }: SchoolRowProps) {
  const { college, rationale, admissionsAlignment, admitChance } = scored;
  return (
    <div className={cn("flex flex-col gap-2.5 py-4", BUBBLE_X_PADDING, className)}>
      <div className="flex flex-col gap-0.5">
        <h4 className="font-semibold leading-tight">{college.name}</h4>
        <p className="text-sm text-muted-foreground">
          {college.city}, {college.state}
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <ChanceChip chance={admitChance} />
        {statChips(college).map((stat) => (
          <StatChip key={stat.label ?? stat.value} label={stat.label} value={stat.value} />
        ))}
      </div>
      <Writeup heading={content.ui.whyItFitsHeading} text={rationale} />
      <Writeup heading={content.ui.admissionsAlignmentHeading} text={admissionsAlignment ?? ""} />
      <a
        href={`${content.sources.scorecardSearch}${encodeURIComponent(college.name)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs font-medium text-primary underline decoration-primary/50 decoration-dotted underline-offset-2 transition hover:decoration-primary"
      >
        {content.sources.scorecardLabel}
      </a>
    </div>
  );
}

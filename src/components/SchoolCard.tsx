/**
 * `SchoolCard` — one scored college: name, location, a stat line (SAT range or
 * test-optional · admit % · net price), and the curation rationale. Stat
 * formatting mirrors the PDF export so screen and print agree.
 */
import type { ScoredCollege } from "@/lib/types";
import { content } from "@/lib/content";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";

export interface SchoolCardProps {
  scored: ScoredCollege;
  className?: string;
}

const PERCENT_MULTIPLIER = 100;
const SAT_RANGE_SEPARATOR = "–";

function satRange(satP25: number | null, satP75: number | null): string {
  if (satP25 == null || satP75 == null) return content.stats.testOptional;
  return `${content.stats.sat} ${satP25}${SAT_RANGE_SEPARATOR}${satP75}`;
}

function admitRate(rate: number): string {
  return `${content.stats.admitRate} ${Math.round(rate * PERCENT_MULTIPLIER)}%`;
}

function netPrice(price: number | null): string | null {
  if (price == null) return null;
  return `${content.stats.netPrice} $${Math.round(price).toLocaleString("en-US")}`;
}

export function SchoolCard({ scored, className }: SchoolCardProps) {
  const { college, rationale } = scored;
  const stats = [
    satRange(college.satP25, college.satP75),
    admitRate(college.admitRate),
    netPrice(college.netPrice),
  ].filter((stat): stat is string => stat !== null);

  return (
    <Card className={cn("flex flex-col gap-2 p-4", className)}>
      <div className="flex flex-col gap-0.5">
        <h4 className="font-semibold leading-tight">{college.name}</h4>
        <p className="text-sm text-muted-foreground">
          {college.city}, {college.state}
        </p>
      </div>
      <p className="text-sm text-muted-foreground">{stats.join("  ·  ")}</p>
      <p className="text-sm">{rationale}</p>
    </Card>
  );
}

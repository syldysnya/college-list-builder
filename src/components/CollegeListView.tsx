/**
 * `CollegeListView` — renders a `CollegeList` inline beneath an assistant answer:
 * the three tiers (in `TIERS` order) and the assumptions note. Purely
 * presentational; the Download-PDF control lives in the answer's top-right.
 */
import { TIERS, type CollegeList } from "@/lib/types";
import { content } from "@/lib/content";
import { TierSection } from "@/components/TierSection";

export interface CollegeListViewProps {
  list: CollegeList;
}

export function CollegeListView({ list }: CollegeListViewProps) {
  return (
    <div className="flex flex-col gap-4">
      {TIERS.map((tier) => (
        <TierSection key={tier} tier={tier} schools={list[tier]} />
      ))}

      {list.assumptions.length > 0 && (
        <section className="flex flex-col gap-2">
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
  );
}

/**
 * `CollegeListView` — the body of the recommended-colleges card: the ranked
 * colleges as rows (most-likely-admitted first), separated by hairline dividers,
 * followed by the assumptions note. Rendered inside the section card, so it has
 * no border of its own.
 */
import { type CollegeList } from "@/lib/types";
import { content } from "@/lib/content";
import { SchoolRow } from "@/components/SchoolRow";

export interface CollegeListViewProps {
  list: CollegeList;
}

export function CollegeListView({ list }: CollegeListViewProps) {
  return (
    <div>
      <div className="divide-y divide-border border-t border-border">
        {list.colleges.map((scored) => (
          <SchoolRow key={scored.college.id} scored={scored} />
        ))}
      </div>

      {list.assumptions.length > 0 && (
        <section className="flex flex-col gap-2 border-t border-border px-4 py-3">
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

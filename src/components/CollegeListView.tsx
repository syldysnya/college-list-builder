/**
 * `CollegeListView` — renders a `CollegeList` inline beneath an assistant answer:
 * the ranked colleges (most-likely-admitted first) and the assumptions note.
 * Purely presentational; the Download-PDF control lives in the answer's top-right.
 */
import { type CollegeList } from "@/lib/types";
import { content } from "@/lib/content";
import { SchoolCard } from "@/components/SchoolCard";

export interface CollegeListViewProps {
  list: CollegeList;
}

export function CollegeListView({ list }: CollegeListViewProps) {
  return (
    <div className="flex flex-col gap-3">
      {list.colleges.map((scored) => (
        <SchoolCard key={scored.college.id} scored={scored} />
      ))}

      {list.assumptions.length > 0 && (
        <section className="flex flex-col gap-2 pt-1">
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

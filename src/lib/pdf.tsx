/**
 * Renders a `CollegeList` to a PDF via `@react-pdf/renderer` — pure JS, no
 * headless Chrome, no network (default Helvetica font, nothing fetched).
 *
 * Copy that's genuinely user-facing (tier labels, the disclaimer) lives in
 * `content.ts` per the app-wide convention. Everything below is layout-only
 * formatting (stat labels, separators, spacing) — named once here so no bare
 * literal is scattered through the JSX, same pattern as `matching.ts`.
 */
import { Document, Page, View, Text, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { type CollegeList, type ScoredCollege, type College } from "./types";
import { content } from "./content";

// --- Stat / layout copy (formatting labels, not app "copy") -------------------
const LABEL_SAT = "SAT";
const LABEL_ADMIT_RATE = "Admit rate";
const LABEL_NET_PRICE = "Est. net price";
const TEST_OPTIONAL_LABEL = "test-optional";
const LIST_HEADING = "Recommended colleges";
const STAT_SEPARATOR = "  ·  "; // " · "
const SAT_RANGE_SEPARATOR = "–"; // "–"

// --- Formatting helpers --------------------------------------------------------
const PERCENT_MULTIPLIER = 100;

function formatSatRange(college: College): string {
  if (college.satP25 == null || college.satP75 == null) return TEST_OPTIONAL_LABEL;
  return `${college.satP25}${SAT_RANGE_SEPARATOR}${college.satP75}`;
}

function formatAdmitRate(admitRate: number): string {
  return `${Math.round(admitRate * PERCENT_MULTIPLIER)}%`;
}

function formatNetPrice(netPrice: number | null): string | null {
  if (netPrice == null) return null;
  return `$${Math.round(netPrice).toLocaleString("en-US")}`;
}

function collegeStats(college: College): string {
  const parts = [
    `${LABEL_SAT} ${formatSatRange(college)}`,
    `${LABEL_ADMIT_RATE} ${formatAdmitRate(college.admitRate)}`,
  ];
  const netPrice = formatNetPrice(college.netPrice);
  if (netPrice != null) parts.push(`${LABEL_NET_PRICE} ${netPrice}`);
  return parts.join(STAT_SEPARATOR);
}

// --- Styles ---------------------------------------------------------------
const SPACE_XS = 4;
const SPACE_SM = 8;
const SPACE_MD = 12;
const SPACE_LG = 20;
const FONT_XS = 8;
const FONT_SM = 9;
const FONT_MD = 10;
const FONT_LG = 12;
const FONT_XL = 20;
const COLOR_TEXT = "#1a1a1a";
const COLOR_MUTED = "#6b6b6b";
const COLOR_RULE = "#d9d9d9";

const styles = StyleSheet.create({
  page: {
    paddingTop: SPACE_LG,
    paddingBottom: SPACE_LG,
    paddingHorizontal: SPACE_LG,
    fontSize: FONT_MD,
    color: COLOR_TEXT,
  },
  header: {
    marginBottom: SPACE_MD,
    paddingBottom: SPACE_SM,
    borderBottomWidth: 1,
    borderBottomColor: COLOR_RULE,
  },
  title: {
    fontSize: FONT_XL,
    fontWeight: 700,
  },
  generated: {
    marginTop: SPACE_XS,
    fontSize: FONT_SM,
    color: COLOR_MUTED,
  },
  assumptions: {
    marginBottom: SPACE_MD,
  },
  assumptionItem: {
    fontSize: FONT_SM,
    fontStyle: "italic",
    color: COLOR_MUTED,
    marginBottom: SPACE_XS / 2,
  },
  section: {
    marginBottom: SPACE_MD,
  },
  sectionHeading: {
    fontSize: FONT_LG,
    fontWeight: 700,
    marginBottom: SPACE_SM,
    paddingBottom: SPACE_XS / 2,
    borderBottomWidth: 1,
    borderBottomColor: COLOR_RULE,
  },
  emptyTierNote: {
    fontSize: FONT_SM,
    color: COLOR_MUTED,
    fontStyle: "italic",
  },
  card: {
    marginBottom: SPACE_SM,
    paddingBottom: SPACE_SM,
  },
  collegeName: {
    fontSize: FONT_MD,
    fontWeight: 700,
  },
  stats: {
    marginTop: SPACE_XS / 2,
    fontSize: FONT_SM,
    color: COLOR_MUTED,
  },
  rationale: {
    marginTop: SPACE_XS / 2,
    fontSize: FONT_SM,
  },
  writeupHeading: {
    marginTop: SPACE_XS,
    fontSize: FONT_XS,
    fontWeight: 700,
    color: COLOR_MUTED,
    textTransform: "uppercase",
  },
  footer: {
    position: "absolute",
    bottom: SPACE_SM,
    left: SPACE_LG,
    right: SPACE_LG,
    fontSize: FONT_XS,
    color: COLOR_MUTED,
  },
});

// --- Sub-components -------------------------------------------------------

function CollegeCard({ scored }: { scored: ScoredCollege }) {
  const { college, rationale, admissionsAlignment } = scored;
  return (
    <View style={styles.card} wrap={false}>
      <Text style={styles.collegeName}>
        {college.name} — {college.city}, {college.state}
      </Text>
      <Text style={styles.stats}>{collegeStats(college)}</Text>
      {rationale.length > 0 ? (
        <>
          <Text style={styles.writeupHeading}>{content.ui.whyItFitsHeading}</Text>
          <Text style={styles.rationale}>{rationale}</Text>
        </>
      ) : null}
      {admissionsAlignment != null && admissionsAlignment.length > 0 ? (
        <>
          <Text style={styles.writeupHeading}>{content.ui.admissionsAlignmentHeading}</Text>
          <Text style={styles.rationale}>{admissionsAlignment}</Text>
        </>
      ) : null}
    </View>
  );
}

// --- Public API -------------------------------------------------------------

export function CollegeListPdf({
  list,
  generatedOn = new Date(),
}: {
  list: CollegeList;
  generatedOn?: Date;
}) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>{list.studentName}</Text>
          <Text style={styles.generated}>
            {content.pdf.generatedPrefix} {generatedOn.toLocaleDateString()}
          </Text>
        </View>

        {list.assumptions.length > 0 ? (
          <View style={styles.assumptions}>
            {list.assumptions.map((assumption) => (
              <Text key={assumption} style={styles.assumptionItem}>
                {assumption}
              </Text>
            ))}
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionHeading}>{LIST_HEADING}</Text>
          {list.colleges.map((scored) => (
            <CollegeCard key={scored.college.id} scored={scored} />
          ))}
        </View>

        <Text style={styles.footer} fixed>
          {content.pdf.disclaimer}
        </Text>
      </Page>
    </Document>
  );
}

export function renderListToBuffer(list: CollegeList, generatedOn: Date = new Date()): Promise<Buffer> {
  return renderToBuffer(<CollegeListPdf list={list} generatedOn={generatedOn} />);
}

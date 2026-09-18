import { describe, expect, it } from "vitest";
import { parseCurriculumMarkdown } from "./curriculumSource";

function buildCanonicalFixture(): string {
  const lines: string[] = [
    "# The 33rd House Inner Circle",
    "## Complete 48-Week Transformational Curriculum",
    "",
    "## About This Curriculum",
    "",
    "Introductory material that is not part of a month.",
    "",
  ];

  for (let month = 1; month <= 12; month += 1) {
    lines.push(
      `## Month ${month}: Month ${month} Title`,
      `### Gate ${month} — GATE_${month}`,
      "",
      `Month ${month} introduction paragraph.`,
      "",
    );

    for (let week = 1; week <= 4; week += 1) {
      lines.push(
        `#### Week ${week}: Week ${month}.${week} Title`,
        `**Week ${month}.${week} Subtitle**`,
        "",
        `Week ${month}.${week} source body paragraph one.`,
        "",
        `Week ${month}.${week} source body paragraph two.`,
        "",
      );
    }

    lines.push("---", "");
  }

  lines.push("## Conclusion", "", "Closing material.");
  return lines.join("\n");
}

describe("parseCurriculumMarkdown", () => {
  it("parses the canonical 12-month / 48-week structure without inventing content", () => {
    const result = parseCurriculumMarkdown(buildCanonicalFixture());

    expect(result.title).toBe("The 33rd House Inner Circle");
    expect(result.subtitle).toBe("Complete 48-Week Transformational Curriculum");
    expect(result.monthCount).toBe(12);
    expect(result.weekCount).toBe(48);

    expect(result.months[0]).toMatchObject({
      monthNumber: 1,
      gateNumber: 1,
      gateName: "GATE_1",
      title: "Month 1 Title",
    });
    expect(result.months[0].introduction).toContain("Month 1 introduction paragraph.");

    expect(result.months[0].weeks[0]).toMatchObject({
      weekNumber: 1,
      globalWeekNumber: 1,
      title: "Week 1.1 Title",
      subtitle: "Week 1.1 Subtitle",
    });
    expect(result.months[0].weeks[0].body).toContain("source body paragraph one");

    expect(result.months[11].weeks[3]).toMatchObject({
      weekNumber: 4,
      globalWeekNumber: 48,
      title: "Week 12.4 Title",
      subtitle: "Week 12.4 Subtitle",
    });
  });

  it("fails closed when the source does not contain exactly 48 weeks", () => {
    const incomplete = buildCanonicalFixture().replace(
      [
        "#### Week 4: Week 12.4 Title",
        "**Week 12.4 Subtitle**",
        "",
        "Week 12.4 source body paragraph one.",
        "",
        "Week 12.4 source body paragraph two.",
        "",
      ].join("\n"),
      "",
    );

    expect(() => parseCurriculumMarkdown(incomplete)).toThrow(/48 weeks/i);
  });

  it("fails closed when a gate number does not match its month", () => {
    const invalid = buildCanonicalFixture().replace(
      "### Gate 7 — GATE_7",
      "### Gate 8 — GATE_7",
    );

    expect(() => parseCurriculumMarkdown(invalid)).toThrow(/gate 7/i);
  });
});

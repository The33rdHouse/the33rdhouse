export const DEFAULT_CURRICULUM_DRIVE_FILE_ID = "1S80MbIsii3364kqw2GJq_wMRitWP6F8z";
const CACHE_TTL_MS = 5 * 60 * 1000;

export interface CurriculumWeek {
  weekNumber: number;
  globalWeekNumber: number;
  title: string;
  subtitle: string;
  body: string;
}

export interface CurriculumMonth {
  monthNumber: number;
  gateNumber: number;
  gateName: string;
  title: string;
  introduction: string;
  weeks: CurriculumWeek[];
}

export interface CurriculumDocument {
  title: string;
  subtitle: string;
  monthCount: number;
  weekCount: number;
  months: CurriculumMonth[];
}

export interface CurriculumDriveSource {
  provider: "google_drive";
  fileId: string;
  name: string;
  mimeType: string;
  modifiedTime: string | null;
  version: string | null;
  checksum: string | null;
}

export interface DriveCurriculumDocument extends CurriculumDocument {
  source: CurriculumDriveSource;
}

interface DriveFileMetadata {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string | null;
  version?: string | number | null;
  md5Checksum?: string | null;
}

interface DriveTextResult {
  text: string;
  metadata: DriveFileMetadata;
}

interface LoadCurriculumOptions {
  fileId?: string;
  forceRefresh?: boolean;
  now?: () => number;
  fetchDriveFile?: (fileId: string) => Promise<DriveTextResult>;
}

const MONTH_HEADING = /^## Month (\d+):\s*(.+)$/;
const GATE_HEADING = /^### Gate (\d+)\s+[—-]\s+(.+)$/;
const WEEK_HEADING = /^#### Week (\d+):\s*(.+)$/;
const SUBTITLE = /^\*\*(.+)\*\*$/;

let cache:
  | {
      fileId: string;
      expiresAt: number;
      value: DriveCurriculumDocument;
    }
  | undefined;

function cleanBlock(lines: string[]): string {
  const copy = [...lines];
  while (copy.length > 0 && (copy[0].trim() === "" || copy[0].trim() === "---")) copy.shift();
  while (copy.length > 0 && (copy.at(-1)?.trim() === "" || copy.at(-1)?.trim() === "---")) copy.pop();
  return copy.join("\n").trim();
}

export function parseCurriculumMarkdown(markdown: string): CurriculumDocument {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const title = lines.find((line) => /^# [^#]/.test(line))?.replace(/^#\s+/, "").trim() ?? "";

  const titleIndex = lines.findIndex((line) => /^# [^#]/.test(line));
  const subtitle = lines
    .slice(Math.max(0, titleIndex + 1))
    .find((line) => /^## (?!Month\s+\d+:|About\b|Conclusion\b)/.test(line))
    ?.replace(/^##\s+/, "")
    .trim() ?? "";

  const months: CurriculumMonth[] = [];
  let month:
    | (Omit<CurriculumMonth, "introduction" | "weeks"> & {
        introductionLines: string[];
        weeks: CurriculumWeek[];
      })
    | undefined;
  let week:
    | (Omit<CurriculumWeek, "body"> & {
        bodyLines: string[];
      })
    | undefined;

  const flushWeek = () => {
    if (!week || !month) return;
    const body = cleanBlock(week.bodyLines);
    if (!week.subtitle) {
      throw new Error(`Month ${month.monthNumber} Week ${week.weekNumber} is missing a subtitle.`);
    }
    if (!body) {
      throw new Error(`Month ${month.monthNumber} Week ${week.weekNumber} is missing source body content.`);
    }
    month.weeks.push({
      weekNumber: week.weekNumber,
      globalWeekNumber: week.globalWeekNumber,
      title: week.title,
      subtitle: week.subtitle,
      body,
    });
    week = undefined;
  };

  const flushMonth = () => {
    flushWeek();
    if (!month) return;
    months.push({
      monthNumber: month.monthNumber,
      gateNumber: month.gateNumber,
      gateName: month.gateName,
      title: month.title,
      introduction: cleanBlock(month.introductionLines),
      weeks: month.weeks,
    });
    month = undefined;
  };

  for (const line of lines) {
    const monthMatch = line.match(MONTH_HEADING);
    if (monthMatch) {
      flushMonth();
      const monthNumber = Number(monthMatch[1]);
      month = {
        monthNumber,
        gateNumber: 0,
        gateName: "",
        title: monthMatch[2].trim(),
        introductionLines: [],
        weeks: [],
      };
      continue;
    }

    if (/^##\s+/.test(line) && month) {
      flushMonth();
      continue;
    }

    if (!month) continue;

    const gateMatch = line.match(GATE_HEADING);
    if (gateMatch && !week) {
      month.gateNumber = Number(gateMatch[1]);
      month.gateName = gateMatch[2].trim();
      continue;
    }

    const weekMatch = line.match(WEEK_HEADING);
    if (weekMatch) {
      flushWeek();
      const weekNumber = Number(weekMatch[1]);
      week = {
        weekNumber,
        globalWeekNumber: (month.monthNumber - 1) * 4 + weekNumber,
        title: weekMatch[2].trim(),
        subtitle: "",
        bodyLines: [],
      };
      continue;
    }

    if (week) {
      const subtitleMatch = line.match(SUBTITLE);
      if (!week.subtitle && subtitleMatch && cleanBlock(week.bodyLines) === "") {
        week.subtitle = subtitleMatch[1].trim();
      } else {
        week.bodyLines.push(line);
      }
      continue;
    }

    if (month.gateNumber > 0) {
      month.introductionLines.push(line);
    }
  }

  flushMonth();

  if (!title) throw new Error("Curriculum source is missing the level-1 title.");
  if (!subtitle) throw new Error("Curriculum source is missing the curriculum subtitle.");
  if (months.length !== 12) {
    throw new Error(`Curriculum source must contain exactly 12 months; found ${months.length}.`);
  }

  const weekCount = months.reduce((total, current) => total + current.weeks.length, 0);
  if (weekCount !== 48) {
    throw new Error(`Curriculum source must contain exactly 48 weeks; found ${weekCount}.`);
  }

  for (let index = 0; index < months.length; index += 1) {
    const expectedMonth = index + 1;
    const current = months[index];
    if (current.monthNumber !== expectedMonth) {
      throw new Error(`Curriculum month sequence must be 1-12; expected Month ${expectedMonth}, found Month ${current.monthNumber}.`);
    }
    if (current.gateNumber !== current.monthNumber) {
      throw new Error(
        `Month ${current.monthNumber} must map to Gate ${current.monthNumber}; found Gate ${current.gateNumber || "missing"}.`,
      );
    }
    if (!current.gateName) {
      throw new Error(`Month ${current.monthNumber} is missing its Gate heading.`);
    }
    if (!current.introduction) {
      throw new Error(`Month ${current.monthNumber} is missing its introduction.`);
    }
    if (current.weeks.length !== 4) {
      throw new Error(`Month ${current.monthNumber} must contain exactly 4 weeks; found ${current.weeks.length}.`);
    }
    current.weeks.forEach((currentWeek, weekIndex) => {
      const expectedWeek = weekIndex + 1;
      if (currentWeek.weekNumber !== expectedWeek) {
        throw new Error(
          `Month ${current.monthNumber} week sequence must be 1-4; expected Week ${expectedWeek}, found Week ${currentWeek.weekNumber}.`,
        );
      }
    });
  }

  return {
    title,
    subtitle,
    monthCount: months.length,
    weekCount,
    months,
  };
}

export async function loadCurriculumFromDrive(
  options: LoadCurriculumOptions = {},
): Promise<DriveCurriculumDocument> {
  const fileId = options.fileId ?? process.env.CURRICULUM_DRIVE_FILE_ID ?? DEFAULT_CURRICULUM_DRIVE_FILE_ID;
  const now = options.now ?? Date.now;
  const timestamp = now();

  if (!options.forceRefresh && cache?.fileId === fileId && cache.expiresAt > timestamp) {
    return cache.value;
  }

  const fetchDriveFile =
    options.fetchDriveFile ??
    (async (id: string) => {
      const { fetchDriveTextFile } = await import("./googleDriveReadonly");
      return fetchDriveTextFile(id);
    });

  const sourceFile = await fetchDriveFile(fileId);
  const parsed = parseCurriculumMarkdown(sourceFile.text);
  const value: DriveCurriculumDocument = {
    ...parsed,
    source: {
      provider: "google_drive",
      fileId: sourceFile.metadata.id || fileId,
      name: sourceFile.metadata.name,
      mimeType: sourceFile.metadata.mimeType,
      modifiedTime: sourceFile.metadata.modifiedTime ?? null,
      version:
        sourceFile.metadata.version === undefined || sourceFile.metadata.version === null
          ? null
          : String(sourceFile.metadata.version),
      checksum: sourceFile.metadata.md5Checksum ?? null,
    },
  };

  cache = {
    fileId,
    expiresAt: timestamp + CACHE_TTL_MS,
    value,
  };

  return value;
}

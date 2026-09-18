# Drive-Backed Complete Curriculum Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve the Complete 48-Week Curriculum from its canonical Google Drive Markdown source through the existing tRPC backend, while keeping existing database tables and subscription gates intact.

**Architecture:** Google Drive remains the canonical content source. The server authenticates to Drive with read-only service-account credentials stored only in runtime environment variables, fetches the canonical Markdown file, parses and validates exactly 12 months / 48 weeks, caches the parsed result briefly in memory, and exposes it through the existing `innerCircle` tRPC router. Existing month/week database APIs are normalized for the current UI, and existing `user_inner_circle_progress` is exposed without changing schema.

**Tech Stack:** TypeScript 5.9, Node.js, Express, tRPC 11, Zod 4, Drizzle ORM/MySQL, Vitest 2, Google Drive REST API.

**Spec:** Canonical Drive source `COMPLETE-CURRICULUM.md`, file ID `1S80MbIsii3364kqw2GJq_wMRitWP6F8z`, observed 2026-09-18.

## Global Constraints

- Google Drive is the canonical curriculum content source; do not copy the curriculum into a second authoritative store.
- The canonical file must parse to exactly 12 months and 48 weeks or the API fails closed.
- Never commit Google credentials, access tokens, private keys, database URLs, or production secrets.
- Runtime credential names: `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON` OR `GOOGLE_DRIVE_CLIENT_EMAIL` + `GOOGLE_DRIVE_PRIVATE_KEY`.
- Runtime source override name: `CURRICULUM_DRIVE_FILE_ID`; default is the verified canonical Drive file ID above.
- Full curriculum access remains behind the existing `seekerProcedure` gate.
- Do not change database schema in this slice.
- Do not merge or deploy from the feature branch until tests, typecheck, and build pass.
- The currently supplied Vercel hostname is not visible in the connected Vercel teams; deployment ownership must be re-grounded before production promotion.

---

### Task 1: Add pull-request CI for the backend slice

**Files:**
- Create: `.github/workflows/curriculum-backend-ci.yml`

**Interfaces:**
- Consumes: repository `package.json`, `pnpm-lock.yaml`.
- Produces: repeatable test/typecheck/build evidence on pull requests that touch curriculum backend files.

- [ ] **Step 1: Create the CI workflow**

```yaml
name: Curriculum Backend CI
on:
  pull_request:
    paths:
      - "server/_core/curriculumSource.ts"
      - "server/_core/curriculumSource.test.ts"
      - "server/_core/googleDriveReadonly.ts"
      - "server/_core/googleDriveReadonly.test.ts"
      - "server/routers.ts"
      - "server/db.ts"
      - ".github/workflows/curriculum-backend-ci.yml"
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10.4.1
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm test -- server/_core/curriculumSource.test.ts server/_core/googleDriveReadonly.test.ts
      - run: pnpm check
      - run: pnpm build
```

- [ ] **Step 2: Commit**
Commit message: `ci: verify Drive curriculum backend`.

### Task 2: Specify the curriculum parser with failing tests

**Files:**
- Create: `server/_core/curriculumSource.test.ts`
- Create later: `server/_core/curriculumSource.ts`

**Interfaces:**
- Consumes: canonical Markdown structure `## Month N`, `### Gate N — NAME`, `#### Week N`, and bold subtitle lines.
- Produces: `parseCurriculumMarkdown(markdown)` and typed `CurriculumDocument`.

- [ ] **Step 1: Write failing parser tests**

Tests must generate a 12-month/48-week fixture and assert:
```ts
expect(result.monthCount).toBe(12);
expect(result.weekCount).toBe(48);
expect(result.months[0].gateNumber).toBe(1);
expect(result.months[0].weeks[0].globalWeekNumber).toBe(1);
expect(result.months[11].weeks[3].globalWeekNumber).toBe(48);
```

A second test removes one week and asserts parsing throws with a count-validation error.

- [ ] **Step 2: Verify RED**
Run: `pnpm test -- server/_core/curriculumSource.test.ts`  
Expected: FAIL because `./curriculumSource` does not exist.

- [ ] **Step 3: Commit tests**
Commit message: `test: specify canonical curriculum parser`.

### Task 3: Implement strict curriculum parsing and Drive-source loading

**Files:**
- Create: `server/_core/curriculumSource.ts`

**Interfaces:**
- Consumes: `fetchDriveTextFile(fileId)` from Task 5.
- Produces:
  - `parseCurriculumMarkdown(markdown: string): CurriculumDocument`
  - `loadCurriculumFromDrive(options?): Promise<DriveCurriculumDocument>`

- [ ] **Step 1: Implement a state-machine parser**

Recognize only these structural headings:
```ts
const MONTH = /^## Month (\d+):\s*(.+)$/;
const GATE = /^### Gate (\d+)\s+[—-]\s+(.+)$/;
const WEEK = /^#### Week (\d+):\s*(.+)$/;
const SUBTITLE = /^\*\*(.+)\*\*$/;
```

For each week set:
```ts
globalWeekNumber = (monthNumber - 1) * 4 + weekNumber;
```

Preserve the source body text; do not invent missing teaching, practice, homework, or question content.

- [ ] **Step 2: Validate structure**
Reject unless:
- months are numbered 1 through 12 exactly once;
- each month contains weeks 1 through 4 exactly once;
- each gate number equals its month number;
- total week count is exactly 48.

- [ ] **Step 3: Add the Drive loader**
Default file ID: `1S80MbIsii3364kqw2GJq_wMRitWP6F8z`.  
Cache successful parsed responses for five minutes.  
Attach source provenance: file ID, name, MIME type, modified time, version, checksum when available.

- [ ] **Step 4: Verify GREEN**
Run: `pnpm test -- server/_core/curriculumSource.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**
Commit message: `feat: parse canonical Drive curriculum`.

### Task 4: Specify read-only Google Drive retrieval with failing tests

**Files:**
- Create: `server/_core/googleDriveReadonly.test.ts`
- Create later: `server/_core/googleDriveReadonly.ts`

**Interfaces:**
- Consumes: a Drive file ID plus injected token provider/fetch for tests.
- Produces: `fetchDriveTextFile(fileId, options?)`.

- [ ] **Step 1: Write failing tests**

Cover:
1. A stored `text/markdown` file: metadata request followed by `files/{id}?alt=media`.
2. A native Google Doc: metadata request followed by `files/{id}/export?mimeType=text%2Fplain`.
3. Non-2xx Google response: throws without returning partial content.
4. Missing runtime service-account credentials: explicit configuration error.

- [ ] **Step 2: Verify RED**
Run: `pnpm test -- server/_core/googleDriveReadonly.test.ts`  
Expected: FAIL because `./googleDriveReadonly` does not exist.

- [ ] **Step 3: Commit tests**
Commit message: `test: specify read-only Drive retrieval`.

### Task 5: Implement read-only Google Drive service-account access

**Files:**
- Create: `server/_core/googleDriveReadonly.ts`

**Interfaces:**
- Consumes:
  - `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON`, or
  - `GOOGLE_DRIVE_CLIENT_EMAIL` and `GOOGLE_DRIVE_PRIVATE_KEY`.
- Produces:
  - short-lived OAuth access token using signed RS256 service-account JWT;
  - `fetchDriveTextFile` returning `{ text, metadata }`.

- [ ] **Step 1: Load credentials fail-closed**
Do not log credential values. Normalize escaped `\\n` in private keys.

- [ ] **Step 2: Mint an OAuth token**
JWT scope: `https://www.googleapis.com/auth/drive.readonly`.  
Audience: `https://oauth2.googleapis.com/token`.  
Cache token until one minute before expiry.

- [ ] **Step 3: Fetch metadata and text**
Request fields:
`id,name,mimeType,modifiedTime,md5Checksum,version`.

Use `alt=media` for stored text/Markdown files and Drive export to `text/plain` for native Google Docs.

- [ ] **Step 4: Verify GREEN**
Run: `pnpm test -- server/_core/googleDriveReadonly.test.ts server/_core/curriculumSource.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**
Commit message: `feat: add read-only Google Drive curriculum client`.

### Task 6: Normalize the existing Inner Circle API and expose Drive content

**Files:**
- Modify: `server/routers.ts`

**Interfaces:**
- Consumes: existing `seekerProcedure`, DB month/week functions, `loadCurriculumFromDrive`.
- Produces:
  - `innerCircle.getCurriculum`
  - normalized `innerCircle.getMonths`
  - backward-compatible `innerCircle.getWeeks` accepting optional `monthId`.

- [ ] **Step 1: Add `getCurriculum`**
Return the Drive-parsed curriculum through `seekerProcedure`.

- [ ] **Step 2: Normalize month shape**
Return `gateNumber: month.gateId` while preserving existing fields.

- [ ] **Step 3: Make `getWeeks` input optional**
If `monthId` is supplied, return that month's weeks. If omitted, load all months and flatten all weeks. Return aliases expected by the current client:
```ts
{
  ...week,
  monthNumber,
  gateNumber,
  dailyHomework: week.dailyPrompt,
  engagementQuestions: week.engagementQuestion
}
```

Do not invent a subtitle; return `subtitle: null` unless sourced elsewhere.

- [ ] **Step 4: Typecheck**
Run: `pnpm check`.  
Expected: exit 0.

- [ ] **Step 5: Commit**
Commit message: `feat: expose Drive curriculum through tRPC`.

### Task 7: Expose existing Inner Circle progress storage

**Files:**
- Modify: `server/db.ts`
- Modify: `server/routers.ts`

**Interfaces:**
- Consumes: existing `userInnerCircleProgress` table and actual DB `monthId` / `weekId`.
- Produces:
  - `getInnerCircleProgress(userId)`
  - `upsertInnerCircleProgress(data)`
  - `innerCircle.getProgress`
  - `innerCircle.updateProgress`

- [ ] **Step 1: Import the existing progress table/types**
No schema or migration changes.

- [ ] **Step 2: Add DB helpers**
Get progress by user and upsert by unique `(userId, weekId)`. When `completed` becomes true set `completedAt`; when false clear it.

- [ ] **Step 3: Add seeker-gated tRPC procedures**
Validate `monthId` and `weekId` are positive integers and cap notes at 10,000 characters.

- [ ] **Step 4: Typecheck and targeted tests**
Run:
```bash
pnpm test -- server/_core/curriculumSource.test.ts server/_core/googleDriveReadonly.test.ts
pnpm check
```
Expected: all pass.

- [ ] **Step 5: Commit**
Commit message: `feat: expose curriculum progress API`.

### Task 8: Full verification and pull-request handoff

**Files:**
- No new production files.

**Interfaces:**
- Consumes: complete branch.
- Produces: verified draft PR ready for Vercel project re-grounding.

- [ ] **Step 1: Run targeted tests**
`pnpm test -- server/_core/curriculumSource.test.ts server/_core/googleDriveReadonly.test.ts`

- [ ] **Step 2: Run full typecheck**
`pnpm check`

- [ ] **Step 3: Run production build**
`pnpm build`

- [ ] **Step 4: Review changed files for secret values**
Only environment-variable names and the non-secret Drive file ID may be committed.

- [ ] **Step 5: Open/refresh draft PR**
The PR must state:
- canonical Drive file ID;
- required runtime secret names;
- Vercel deployment ownership remains unverified for `33-nine-tan.vercel.app`;
- no production deployment has been performed.

- [ ] **Step 6: Merge/deploy only after current Vercel project is identified**
Do not infer project ownership from a hostname alone.

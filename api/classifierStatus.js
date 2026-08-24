import fetch from "node-fetch";

// Overridable for GitHub Enterprise installs and for tests.
const GITHUB_API = process.env.GITHUB_API_URL || "https://api.github.com";
const DEFAULT_REPO = "colin-rod/raindrop_classifier";
const DEFAULT_WORKFLOW = "classify-bookmarks.yml";
const DEFAULT_CRON = "0 3 * * 0";
const HISTORY_LIMIT = 10;
const CACHE_TTL_MS = 10 * 60 * 1000;

// The classifier repo commits no run output, so the only durable record of a weekly
// run is its GitHub Actions job log. Responses are cached per warm lambda to stay
// well inside the GitHub rate limit.
let cache = null;

function githubHeaders(token) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "raindrop-randomizer"
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function githubJson(path, token) {
  const resp = await fetch(`${GITHUB_API}${path}`, { headers: githubHeaders(token) });
  if (!resp.ok) {
    const error = new Error(`GitHub API ${resp.status} for ${path}`);
    error.status = resp.status;
    throw error;
  }
  return resp.json();
}

function cleanLogLine(line) {
  return line
    .replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s?/, "")
    .replace(/\[[0-9;]*m/g, "")
    .replace(/\r$/, "")
    .trim();
}

function matchNumber(line, pattern) {
  const match = line.match(pattern);
  return match ? Number(match[1]) : null;
}

function matchPercent(line, pattern) {
  const match = line.match(pattern);
  return match ? Number(match[1]) / 100 : null;
}

// Mirrors the console output of classify.js and cleanup-existing-tags.js in the
// raindrop_classifier repo. Unrecognised lines are ignored, so a logging tweak
// upstream degrades a single field to null rather than breaking the panel.
export function parseRunLog(rawLog) {
  const classification = {
    unsortedFound: null,
    classified: 0,
    totalTags: null,
    newTags: null,
    completed: false
  };
  const cleanup = {
    ran: null,
    skipped: false,
    bookmarksUpdated: null,
    tagsConsolidated: null,
    canonicalTags: null,
    previousUniqueTags: null,
    currentUniqueTags: null,
    totalTagUsage: null,
    growthRate: null,
    newTagRatio: null,
    singleUseRatio: null,
    entropy: null
  };
  const categoryCounts = new Map();
  const errors = [];

  for (const rawLine of String(rawLog).split("\n")) {
    const line = cleanLogLine(rawLine);
    if (!line) continue;

    if (line.includes("No unsorted bookmarks left")) {
      classification.unsortedFound = 0;
      classification.completed = true;
      continue;
    }

    const found = matchNumber(line, /Found (\d+) truly unsorted bookmarks/);
    if (found !== null) {
      classification.unsortedFound = found;
      continue;
    }

    // classify.js logs `Updated "title" -> Category [tag, tag]`; the cleanup step logs
    // `Updated "title"` with no arrow, so the arrow is what tells the two apart.
    const classified = line.match(/Updated ".*"\s*→\s*(.+?) \[(.*)\]$/);
    if (classified) {
      classification.classified += 1;
      const category = classified[1].trim();
      categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
      continue;
    }

    const finalStats = line.match(/Final Stats: (\d+) total tags \((\d+) new tags created\)/);
    if (finalStats) {
      classification.totalTags = Number(finalStats[1]);
      classification.newTags = Number(finalStats[2]);
      continue;
    }

    if (line.includes("Done classifying all unsorted bookmarks")) {
      classification.completed = true;
      continue;
    }

    if (line.includes("Skipping AI cleanup this week")) {
      cleanup.ran = false;
      cleanup.skipped = true;
      continue;
    }

    if (line.includes("Cleanup complete")) {
      cleanup.ran = true;
      continue;
    }

    const updated = matchNumber(line, /Updated (\d+) bookmarks/);
    if (updated !== null) {
      cleanup.bookmarksUpdated = updated;
      continue;
    }

    const consolidated = matchNumber(line, /Consolidated (\d+) duplicate tags/);
    if (consolidated !== null) {
      cleanup.tagsConsolidated = consolidated;
      continue;
    }

    const canonical = matchNumber(line, /tag registry with (\d+) canonical tags/);
    if (canonical !== null) {
      cleanup.canonicalTags = canonical;
      continue;
    }

    const previousUnique = matchNumber(line, /Previous unique tags: (\d+)/);
    if (previousUnique !== null) {
      cleanup.previousUniqueTags = previousUnique;
      continue;
    }

    const currentUnique = matchNumber(line, /Current unique tags: (\d+)/);
    if (currentUnique !== null) {
      cleanup.currentUniqueTags = currentUnique;
      continue;
    }

    const totalUsage = matchNumber(line, /Total tag usage: (\d+)/);
    if (totalUsage !== null) {
      cleanup.totalTagUsage = totalUsage;
      continue;
    }

    const growth = matchPercent(line, /Growth rate: (-?[\d.]+)%/);
    if (growth !== null) {
      cleanup.growthRate = growth;
      continue;
    }

    const newRatio = matchPercent(line, /New-tag ratio: (-?[\d.]+)%/);
    if (newRatio !== null) {
      cleanup.newTagRatio = newRatio;
      continue;
    }

    const singleUse = matchPercent(line, /Single-use ratio: (-?[\d.]+)%/);
    if (singleUse !== null) {
      cleanup.singleUseRatio = singleUse;
      continue;
    }

    const entropy = line.match(/Entropy: (-?[\d.]+)/);
    if (entropy) {
      cleanup.entropy = Number(entropy[1]);
      continue;
    }

    if (line.includes("❌") && errors.length < 10) {
      errors.push(line.replace(/❌\s*/, "").trim());
    }
  }

  const categories = Array.from(categoryCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  return { classification, cleanup, categories, errors };
}

function fieldMatches(field, value, { min, max, sundayIsSeven = false }) {
  if (field === "*") return true;
  return field.split(",").some((part) => {
    const [rangePart, stepPart] = part.split("/");
    const step = stepPart ? Number(stepPart) : 1;
    if (!Number.isFinite(step) || step <= 0) return false;

    let start;
    let end;
    if (rangePart === "*") {
      start = min;
      end = max;
    } else if (rangePart.includes("-")) {
      const [from, to] = rangePart.split("-").map(Number);
      start = from;
      end = to;
    } else {
      start = Number(rangePart);
      end = start;
    }
    if (!Number.isFinite(start) || !Number.isFinite(end)) return false;

    for (let candidate = start; candidate <= end; candidate += step) {
      if (candidate === value) return true;
      if (sundayIsSeven && candidate === 7 && value === 0) return true;
    }
    return false;
  });
}

// Small UTC-only cron evaluator: enough to say when the classifier next runs,
// without pulling in a dependency for a single date calculation.
export function nextCronRun(expression, from = new Date()) {
  const fields = String(expression).trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;

  const cursor = new Date(from.getTime());
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);

  // 366 days covers every schedule that fires at least once a year.
  const limit = new Date(from.getTime() + 366 * 24 * 60 * 60 * 1000);
  while (cursor <= limit) {
    const dayOfMonthMatches = () => fieldMatches(dayOfMonth, cursor.getUTCDate(), { min: 1, max: 31 });
    const dayOfWeekMatches = () =>
      fieldMatches(dayOfWeek, cursor.getUTCDay(), { min: 0, max: 6, sundayIsSeven: true });

    // Cron treats day-of-month and day-of-week as a union once both are restricted.
    const dayMatches =
      fieldMatches(month, cursor.getUTCMonth() + 1, { min: 1, max: 12 }) &&
      (dayOfMonth === "*" && dayOfWeek === "*"
        ? true
        : dayOfMonth === "*"
          ? dayOfWeekMatches()
          : dayOfWeek === "*"
            ? dayOfMonthMatches()
            : dayOfMonthMatches() || dayOfWeekMatches());

    if (dayMatches) {
      if (
        fieldMatches(hour, cursor.getUTCHours(), { min: 0, max: 23 }) &&
        fieldMatches(minute, cursor.getUTCMinutes(), { min: 0, max: 59 })
      ) {
        return cursor.toISOString();
      }
      cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
    } else {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      cursor.setUTCHours(0, 0, 0, 0);
    }
  }
  return null;
}

function durationSeconds(startedAt, completedAt) {
  if (!startedAt || !completedAt) return null;
  const start = new Date(startedAt).getTime();
  const end = new Date(completedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return Math.round((end - start) / 1000);
}

function summarizeRun(run) {
  const startedAt = run.run_started_at || run.created_at;
  const completed = run.status === "completed";
  return {
    id: run.id,
    runNumber: run.run_number,
    status: run.status,
    conclusion: run.conclusion,
    event: run.event,
    startedAt,
    completedAt: completed ? run.updated_at : null,
    durationSeconds: completed ? durationSeconds(startedAt, run.updated_at) : null,
    url: run.html_url
  };
}

async function fetchJobLog(repo, runId, token) {
  const jobs = await githubJson(`/repos/${repo}/actions/runs/${runId}/jobs?per_page=10`, token);
  const allJobs = jobs.jobs || [];
  const job = allJobs.find((candidate) => candidate.status === "completed") || allJobs[0];
  if (!job) return null;

  const resp = await fetch(`${GITHUB_API}/repos/${repo}/actions/jobs/${job.id}/logs`, {
    headers: githubHeaders(token)
  });
  if (!resp.ok) {
    const error = new Error(`GitHub API ${resp.status} for job logs`);
    error.status = resp.status;
    throw error;
  }
  return { job, log: await resp.text() };
}

async function buildStatus({ repo, workflow, cron, token }) {
  const runsPath = `/repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}/runs?per_page=${HISTORY_LIMIT}`;
  const runsData = await githubJson(runsPath, token);
  const runs = runsData.workflow_runs || [];
  const workflowUrl = `https://github.com/${repo}/actions/workflows/${workflow}`;

  if (runs.length === 0) {
    return {
      repo,
      repoUrl: `https://github.com/${repo}`,
      workflow: { name: workflow, url: workflowUrl, cron },
      nextRunAt: nextCronRun(cron),
      latestRun: null,
      inProgressRun: null,
      history: [],
      successRate: null,
      summary: { available: false, reason: "No workflow runs found yet." }
    };
  }

  const history = runs.map(summarizeRun);
  const latestCompleted = runs.find((run) => run.status === "completed") || null;
  const inProgress = runs.find((run) => run.status !== "completed") || null;
  const completedRuns = history.filter((run) => run.status === "completed");
  const successRate = completedRuns.length
    ? completedRuns.filter((run) => run.conclusion === "success").length / completedRuns.length
    : null;

  let summary = { available: false, reason: "No completed run to summarise yet." };
  if (latestCompleted) {
    if (!token) {
      summary = {
        available: false,
        reason: "Set GITHUB_TOKEN to read run logs and show the classification summary."
      };
    } else {
      try {
        const jobLog = await fetchJobLog(repo, latestCompleted.id, token);
        summary = jobLog
          ? { available: true, ...parseRunLog(jobLog.log) }
          : { available: false, reason: "The latest run has no job logs." };
      } catch (error) {
        console.error("Failed to read classifier run logs", error);
        summary = {
          available: false,
          reason:
            error.status === 403 || error.status === 404
              ? "GITHUB_TOKEN cannot read Actions logs for this repository (needs actions:read)."
              : "Could not read the run logs from GitHub."
        };
      }
    }
  }

  return {
    repo,
    repoUrl: `https://github.com/${repo}`,
    workflow: { name: runs[0].name || workflow, url: workflowUrl, cron },
    nextRunAt: nextCronRun(cron),
    latestRun: latestCompleted ? summarizeRun(latestCompleted) : null,
    inProgressRun: inProgress ? summarizeRun(inProgress) : null,
    history,
    successRate,
    summary
  };
}

export default async function handler(req, res) {
  const repo = process.env.CLASSIFIER_REPO || DEFAULT_REPO;
  const workflow = process.env.CLASSIFIER_WORKFLOW || DEFAULT_WORKFLOW;
  const cron = process.env.CLASSIFIER_CRON || DEFAULT_CRON;
  const token = process.env.GITHUB_TOKEN || process.env.CLASSIFIER_GITHUB_TOKEN;
  const cacheKey = `${repo}|${workflow}|${cron}|${token ? "auth" : "anon"}`;
  const refresh = String(req.query?.refresh || "") === "1";

  if (!refresh && cache && cache.key === cacheKey && cache.expiresAt > Date.now()) {
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=300");
    return res.status(200).json({ ...cache.payload, cached: true });
  }

  try {
    const payload = await buildStatus({ repo, workflow, cron, token });
    payload.fetchedAt = new Date().toISOString();
    cache = { key: cacheKey, expiresAt: Date.now() + CACHE_TTL_MS, payload };
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=300");
    return res.status(200).json({ ...payload, cached: false });
  } catch (error) {
    console.error("Failed to load classifier status", error);
    if (error.status === 404) {
      return res.status(404).json({ error: `Workflow ${workflow} was not found in ${repo}` });
    }
    if (error.status === 403) {
      return res.status(503).json({
        error: "GitHub rate limit reached or access denied. Configure GITHUB_TOKEN to raise the limit."
      });
    }
    return res.status(502).json({ error: "Failed to load classifier status from GitHub" });
  }
}

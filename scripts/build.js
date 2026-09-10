// Runs everything, compares against yesterday, writes the dashboard data.
//
// The comparison is the whole point. Raw view counts tell you what's popular,
// which is mostly stuff you can't compete for. Day-over-day change tells you
// what's breaking out right now, which is the only window a small channel has.

import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { collectYouTube } from "./youtube.js";
import { collectItch } from "./itch.js";
import { collectSteam } from "./steam.js";

const OUT = config.outDir;
const HIST = path.join(OUT, "history");
const PREV = path.join(OUT, "previous.json");
const today = new Date().toISOString().slice(0, 10);

// A baseline younger than this tells you nothing — two runs ten minutes apart
// produce identical numbers. Below it we report "no usable baseline" instead
// of pretending everything is steady, and we don't overwrite the good one.
const MIN_BASELINE_HOURS = 6;

const readJson = async p => {
  try { return JSON.parse(await fs.readFile(p, "utf8")); }
  catch { return null; }
};

/**
 * The snapshot to measure today against.
 *
 * Uses a rolling previous.json rather than "yesterday's dated file", so that
 * re-running on the same day still compares against something real instead of
 * finding nothing and marking every game NEW.
 */
async function previousSnapshot() {
  let prev = await readJson(PREV);

  if (!prev) {
    // No rolling file yet (first run, or upgrading from the old layout) —
    // fall back to the newest dated snapshot from an earlier day.
    try {
      const files = (await fs.readdir(HIST))
        .filter(f => f.endsWith(".json") && f.slice(0, 10) < today)
        .sort();
      if (files.length) prev = await readJson(path.join(HIST, files[files.length - 1]));
    } catch {}
  }

  if (!prev?.generatedAt) return { snapshot: prev || null, ageHours: null, usable: false };

  const ageHours = (Date.now() - new Date(prev.generatedAt).getTime()) / 36e5;
  return { snapshot: prev, ageHours, usable: ageHours >= MIN_BASELINE_HOURS };
}

const key = s => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

function addVelocity(games, prev) {
  const before = new Map();
  if (prev?.youtube?.games) {
    for (const g of prev.youtube.games) before.set(key(g.name), g);
  }

  return games.map(g => {
    const old = before.get(key(g.name));
    const deltaViews = old ? g.views - old.views : null;
    const deltaVideos = old ? g.videos - old.videos : null;

    // Percentage growth, but only where the base is big enough to mean
    // anything — 200% growth off 300 views is noise.
    const pct = old && old.views > 5000
      ? Math.round(((g.views - old.views) / old.views) * 100)
      : null;

    let status = "steady";
    if (!old) status = "new";
    else if (pct !== null && pct >= 40) status = "climbing";
    else if (pct !== null && pct <= -25) status = "cooling";

    // A rough "should I care" score. Weighted toward movement and toward
    // spread across channels, away from raw size.
    const spread = Math.min(g.channels, 12) / 12;
    const movement = pct === null ? 0.5 : Math.max(0, Math.min(pct, 300)) / 300;
    const size = Math.min(Math.log10(Math.max(g.views, 1)) / 7, 1);
    const score = Math.round((movement * 55 + spread * 25 + size * 20));

    return { ...g, deltaViews, deltaVideos, pct, status, score };
  });
}

/**
 * Score each itch game and cross-reference it against the YouTube data.
 *
 * This is the part that separates a real find from an asset flip. An itch
 * game that YouTubers are already covering is validated by definition —
 * that's the "came out three days ago and is starting to move" case. Being
 * on itch's own new-and-popular or top-sellers list is the next best signal.
 * Appearing only in raw "newest" means nothing at all.
 */
function scoreItch(games, ytGames, prev) {
  const before = new Set((prev?.itch || []).map(g => g.id || g.url));

  // Index the YouTube rollup by normalised name so we can match against it.
  const yt = new Map();
  for (const g of ytGames) yt.set(key(g.name), g);

  const feedWeight = Object.fromEntries(
    config.itch.feeds.map(f => [f.name, f.weight ?? 0])
  );

  return games.map(g => {
    const isNew = !before.has(g.id || g.url);

    // Best weight across every feed this game appeared in, plus a bonus for
    // showing up in more than one.
    const weights = (g.feeds || []).map(f => feedWeight[f] ?? 0);
    const feedScore = Math.max(0, ...weights) + Math.max(0, weights.length - 1);

    const hit = yt.get(key(g.name));
    const covered = hit ? {
      views: hit.views,
      videos: hit.videos,
      channels: hit.channels,
      status: hit.status
    } : null;

    // 0-100. YouTube coverage dominates; itch's own ranking is the tiebreak.
    let score = feedScore * 5;
    if (covered) {
      score += 30;
      score += Math.min(Math.log10(Math.max(covered.views, 1)) * 5, 22);
      if (covered.status === "climbing" || covered.status === "new") score += 12;
    }
    if (isNew) score += 3;

    return { ...g, isNew, covered, feedScore, score: Math.min(Math.round(score), 100) };
  }).sort((a, b) => b.score - a.score);
}

async function pruneHistory() {
  try {
    const files = (await fs.readdir(HIST)).filter(f => f.endsWith(".json")).sort();
    const extra = files.length - config.keepHistoryDays;
    for (let i = 0; i < extra; i++) {
      await fs.unlink(path.join(HIST, files[i]));
    }
  } catch {}
}

async function main() {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    console.error("YOUTUBE_API_KEY is not set. Add it as a repo secret.");
    process.exit(1);
  }

  await fs.mkdir(HIST, { recursive: true });
  const base = await previousSnapshot();
  const prev = base.usable ? base.snapshot : null;

  if (prev) {
    console.log(`Comparing against ${prev.date} (${base.ageHours.toFixed(1)}h ago)`);
  } else if (base.snapshot) {
    console.log(
      `Baseline is only ${base.ageHours.toFixed(1)}h old — too fresh to mean anything. ` +
      `Everything will read NEW until a run at least ${MIN_BASELINE_HOURS}h later.`);
  } else {
    console.log("No previous run — first snapshot, everything reads NEW.");
  }

  console.log("YouTube:");
  const yt = await collectYouTube(apiKey);

  console.log("itch.io:");
  const itch = await collectItch();

  console.log("Steam:");
  const steam = await collectSteam();

  const games = addVelocity(yt.games, prev).sort((a, b) => b.score - a.score);

  const snapshot = {
    date: today,
    generatedAt: new Date().toISOString(),
    comparedTo: prev?.date || null,
    baselineAgeHours: prev ? Math.round(base.ageHours) : null,
    minBaselineHours: MIN_BASELINE_HOURS,
    youtube: {
      games,
      videoCount: yt.videoCount,
      topVideos: yt.topVideos,
      lookbackDays: config.youtube.lookbackDays
    },
    itch: scoreItch(itch, games, prev),
    steam
  };

  await fs.writeFile(path.join(OUT, "latest.json"), JSON.stringify(snapshot, null, 2));
  await fs.writeFile(path.join(HIST, `${today}.json`), JSON.stringify(snapshot));

  // Only advance the baseline if the current one has aged out. This keeps a
  // rapid re-run from burning a perfectly good comparison point.
  if (!base.snapshot || base.usable) {
    await fs.writeFile(PREV, JSON.stringify(snapshot));
  }

  await pruneHistory();

  const climbing = games.filter(g => g.status === "climbing").length;
  const fresh = games.filter(g => g.status === "new").length;
  const validated = snapshot.itch.filter(g => g.covered).length;
  console.log(
    `\nDone. ${games.length} games · ${climbing} climbing · ${fresh} new · ` +
    `${snapshot.itch.length} on itch, ${validated} of them already on YouTube`
  );
}

main().catch(e => { console.error(e); process.exit(1); });

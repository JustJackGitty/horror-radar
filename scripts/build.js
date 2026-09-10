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
const today = new Date().toISOString().slice(0, 10);

const readJson = async p => {
  try { return JSON.parse(await fs.readFile(p, "utf8")); }
  catch { return null; }
};

/** Yesterday's file, or the most recent one we have. */
async function previousSnapshot() {
  try {
    const files = (await fs.readdir(HIST))
      .filter(f => f.endsWith(".json") && f.slice(0, 10) < today)
      .sort();
    if (!files.length) return null;
    return readJson(path.join(HIST, files[files.length - 1]));
  } catch { return null; }
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

function markNewItch(games, prev) {
  const before = new Set((prev?.itch || []).map(g => g.id || g.url));
  return games.map(g => ({ ...g, isNew: !before.has(g.id || g.url) }));
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
  const prev = await previousSnapshot();
  console.log(prev ? `Comparing against ${prev.date}` : "No previous run — first snapshot.");

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
    youtube: {
      games,
      videoCount: yt.videoCount,
      topVideos: yt.topVideos,
      lookbackDays: config.youtube.lookbackDays
    },
    itch: markNewItch(itch, prev),
    steam
  };

  await fs.writeFile(path.join(OUT, "latest.json"), JSON.stringify(snapshot, null, 2));
  await fs.writeFile(path.join(HIST, `${today}.json`), JSON.stringify(snapshot));
  await pruneHistory();

  const climbing = games.filter(g => g.status === "climbing").length;
  const fresh = games.filter(g => g.status === "new").length;
  console.log(
    `\nDone. ${games.length} games · ${climbing} climbing · ${fresh} new · ` +
    `${snapshot.itch.filter(g => g.isNew).length} new on itch`
  );
}

main().catch(e => { console.error(e); process.exit(1); });

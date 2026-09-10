// Pulls recent horror-game videos and their view counts, then rolls them up
// into per-game totals.
//
// Quota: search.list costs 100 units per call, videos.list costs 1 per call
// (up to 50 video IDs each). Free tier is 10,000 units/day.

import { config } from "../config.js";

const API = "https://www.googleapis.com/youtube/v3";

async function get(path, params, key) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("key", key);

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // 403 here is almost always quota exhausted or a key restricted to the
    // wrong referrer. Say which so you're not guessing at 6am.
    throw new Error(`YouTube ${path} -> ${res.status}: ${body.slice(0, 400)}`);
  }
  return res.json();
}

/** One search query -> up to 50 video IDs. Costs 100 quota units. */
async function searchIds(query, key) {
  const publishedAfter = new Date(
    Date.now() - config.youtube.lookbackDays * 864e5
  ).toISOString();

  const data = await get("/search", {
    part: "snippet",
    q: query,
    type: "video",
    order: "viewCount",
    maxResults: 50,
    publishedAfter,
    regionCode: config.youtube.regionCode,
    relevanceLanguage: config.youtube.relevanceLanguage,
    videoEmbeddable: "true"
  }, key);

  return (data.items || []).map(i => i.id.videoId).filter(Boolean);
}

/** Up to 50 IDs -> full stats. Costs 1 quota unit. */
async function stats(ids, key) {
  if (!ids.length) return [];
  const data = await get("/videos", {
    part: "snippet,statistics",
    id: ids.join(","),
    maxResults: 50
  }, key);

  return (data.items || []).map(v => ({
    id: v.id,
    title: v.snippet.title,
    channel: v.snippet.channelTitle,
    channelId: v.snippet.channelId,
    published: v.snippet.publishedAt,
    views: Number(v.statistics.viewCount || 0),
    likes: Number(v.statistics.likeCount || 0),
    comments: Number(v.statistics.commentCount || 0),
    thumb: v.snippet.thumbnails?.medium?.url || ""
  }));
}

// ---------- turning video titles into game names ----------

const norm = s =>
  s.toLowerCase()
    .replace(/[''`]/g, "'")
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Does this title contain a game we already know about? */
export function matchKnown(title) {
  const n = norm(title);
  let best = null;
  for (const g of config.knownGames) {
    const gn = norm(g);
    if (gn.length < 4) continue;
    if (n.includes(gn) && (!best || gn.length > norm(best).length)) best = g;
  }
  return best;
}

// Words that can never carry a game name on their own.
const COMMON = new Set(`a an the and or but of in on at to for with from into
about my your his her its our their this that these those it he she they we you i
is are was were be been being do does did done have has had will would can could
so if then than as by out up down off over under again very just too also more most
reacting react watching watched trying tried made makes making got get gets went
was actually literally finally almost never always really me us them what when where
why how who all some any every no not now still even ever back one two three
gave gives giving broke breaks broken ruined scared scares terrified destroyed
killed beat beats played plays playing finished survived escaped found saw felt
thought wish hate hates love loves need needs left right first last only
gone came come goes going says said tells told makes make made`.split(/\s+/));

/**
 * Guess a game name from a title we don't recognise.
 * Most horror-gaming titles look like:
 *   "GAME NAME | this game broke me"
 *   "I Played GAME NAME and Regretted It"
 *   "GAME NAME - Full Playthrough"
 * so the chunk before the first separator is usually right.
 */
export function guessName(title) {
  let t = title
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    // Note: no colon here. "Anomaly: Night Bus" splits on ':' into a wrong
    // answer, and subtitles are part of a game's name far more often than
    // they're clickbait.
    .split(/[|\u2013\u2014\u2022]|\s-\s/)[0];

  const words = t.split(/\s+/).filter(Boolean);
  const kept = [];
  for (const w of words) {
    const bare = w.replace(/[^A-Za-z0-9']/g, "");
    if (!bare) continue;
    const low = bare.toLowerCase();
    if (config.noiseWords.includes(low)) continue;
    if (/^\d+$/.test(bare)) continue;
    // Once the proper noun has started, a common word ends it:
    // "Silent Hollow Motel is a nightmare" -> "Silent Hollow Motel".
    if (COMMON.has(low)) {
      if (kept.length) break;                       // ends the name
      if (low === "the" || low === "a" || low === "an") { kept.push(bare); continue; }
      continue;                                     // leading filler, skip
    }
    kept.push(bare);
  }
  if (kept.length < 1 || kept.length > 6) return null;

  const name = kept.join(" ").trim();
  if (name.length < 3 || name.length > 48) return null;
  // Needs at least one capitalised word to look like a proper noun.
  if (!/[A-Z]/.test(name)) return null;
  // "REACTING TO", "THIS ONE" etc. are all function words — not a game.
  if (kept.every(w => COMMON.has(w.toLowerCase()))) return null;
  return name;
}

export async function collectYouTube(key) {
  const seen = new Set();
  const ids = [];

  for (const q of config.youtube.queries) {
    try {
      const found = await searchIds(q, key);
      for (const id of found) {
        if (!seen.has(id)) { seen.add(id); ids.push(id); }
      }
      console.log(`  search "${q}" -> ${found.length}`);
    } catch (e) {
      console.warn(`  search "${q}" failed: ${e.message}`);
      // A quota error will hit every subsequent query too — bail early
      // rather than burning through the list.
      if (/quota/i.test(e.message)) break;
    }
  }

  const videos = [];
  for (let i = 0; i < ids.length; i += 50) {
    try {
      videos.push(...await stats(ids.slice(i, i + 50), key));
    } catch (e) {
      console.warn(`  stats batch failed: ${e.message}`);
    }
  }

  const kept = videos.filter(v => v.views >= config.youtube.minViews);
  console.log(`  ${videos.length} videos, ${kept.length} above the view floor`);

  // Roll up by game.
  const byGame = new Map();
  const bump = (name, v, known) => {
    const k = norm(name);
    if (!byGame.has(k)) {
      byGame.set(k, {
        name, known, videos: 0, views: 0, likes: 0,
        channels: new Set(), top: null, newest: null
      });
    }
    const g = byGame.get(k);
    g.videos++;
    g.views += v.views;
    g.likes += v.likes;
    g.channels.add(v.channelId);
    if (!g.top || v.views > g.top.views) {
      g.top = { title: v.title, id: v.id, views: v.views, channel: v.channel, thumb: v.thumb };
    }
    if (!g.newest || v.published > g.newest) g.newest = v.published;
    if (known) g.known = true;
  };

  for (const v of kept) {
    const hit = matchKnown(v.title);
    if (hit) { bump(hit, v, true); continue; }
    const guess = guessName(v.title);
    if (guess) bump(guess, v, false);
  }

  const d = config.discovery;
  const games = [...byGame.values()]
    .map(g => ({ ...g, channels: g.channels.size }))
    .filter(g =>
      g.known ||
      (g.videos >= d.minVideos &&
       g.channels >= d.minChannels &&
       g.views >= d.minTotalViews))
    .sort((a, b) => b.views - a.views);

  return {
    games,
    videoCount: kept.length,
    topVideos: kept.sort((a, b) => b.views - a.views).slice(0, 30)
  };
}

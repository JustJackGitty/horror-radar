// Steam's store search returns JSON when you pass &infinite=1 — you get
// { results_html, total_count } and parse the fragment. This is undocumented
// but long-stable. If it ever stops answering, we fall back to fetching the
// normal search page and parsing that instead.
//
// Best-effort throughout: a Steam failure logs and returns [], it never takes
// down the rest of the run.

import * as cheerio from "cheerio";
import { config } from "../config.js";

const UA = "Mozilla/5.0 (compatible; horror-radar/1.0; personal stream-scouting tool)";
const BASE = "https://store.steampowered.com/search/results/";
const PAGE = "https://store.steampowered.com/search/";

// 1667 = Horror tag. 998 = Games only, so no DLC or soundtracks.
function url(base, filter, extra = {}) {
  const u = new URL(base);
  u.searchParams.set("query", "");
  u.searchParams.set("tags", "1667");
  u.searchParams.set("category1", "998");
  u.searchParams.set("ndl", "1");
  if (filter) u.searchParams.set("filter", filter);
  for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
  return u.toString();
}

function parseRows(html, limit) {
  const $ = cheerio.load(html || "");
  const out = [];

  $("a.search_result_row").each((_, el) => {
    if (out.length >= limit) return;
    const $el = $(el);
    const name = $el.find(".title").first().text().trim();
    if (!name) return;

    const tip = $el.find(".search_review_summary").first().attr("data-tooltip-html");

    out.push({
      appid: $el.attr("data-ds-appid") || "",
      name,
      url: ($el.attr("href") || "").split("?")[0],
      released: $el.find(".search_released").first().text().trim(),
      price: $el.find(".discount_final_price, .search_price")
               .first().text().replace(/\s+/g, " ").trim(),
      reviews: tip ? tip.split("<br>")[0].trim() : ""
    });
  });

  return out;
}

async function fetchList(label, filter, limit) {
  // First choice: the JSON mode.
  try {
    const u = url(BASE, filter, { infinite: "1", start: "0", count: String(Math.min(limit, 50)) });
    const res = await fetch(u, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (res.ok) {
      const data = await res.json();
      const rows = parseRows(data.results_html, limit);
      if (rows.length) {
        console.log(`  steam ${label} -> ${rows.length} (json)`);
        return rows;
      }
      console.warn(`  steam ${label}: json mode returned 0 rows, trying the page`);
    } else {
      console.warn(`  steam ${label}: json mode HTTP ${res.status}, trying the page`);
    }
  } catch (e) {
    console.warn(`  steam ${label}: json mode failed (${e.message}), trying the page`);
  }

  // Fallback: the normal search page.
  try {
    const res = await fetch(url(PAGE, filter), { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = parseRows(await res.text(), limit);
    console.log(`  steam ${label} -> ${rows.length} (page)`);
    return rows;
  } catch (e) {
    console.warn(`  steam ${label} failed entirely: ${e.message}`);
    return [];
  }
}

export async function collectSteam() {
  const limit = config.steam?.limit ?? 40;
  return {
    // Unreleased, with a date or a window attached.
    upcoming: await fetchList("upcoming", "comingsoon", limit),
    // Steam's own "popular new releases" list.
    newReleases: await fetchList("new releases", "popularnew", limit)
  };
}

// Steam's store search has an undocumented but long-stable JSON mode:
// append &json=1 and you get { results_html, total_count }. We parse the
// HTML fragment out of it. Best-effort — if Steam changes the markup this
// returns an empty list rather than breaking the whole run.

import * as cheerio from "cheerio";
import { config } from "../config.js";

const UA = "horror-radar/1.0 (personal stream-scouting tool)";

async function search(url, limit) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`steam -> ${res.status}`);

  const data = await res.json();
  const $ = cheerio.load(data.results_html || "");
  const out = [];

  $("a.search_result_row").each((_, el) => {
    if (out.length >= limit) return;
    const $el = $(el);
    const name = $el.find(".title").first().text().trim();
    if (!name) return;

    const released = $el.find(".search_released").first().text().trim();
    const priceEl = $el.find(".discount_final_price, .search_price").first();

    out.push({
      appid: $el.attr("data-ds-appid") || "",
      name,
      url: ($el.attr("href") || "").split("?")[0],
      released,
      price: priceEl.text().replace(/\s+/g, " ").trim(),
      thumb: $el.find(".search_capsule img").first().attr("src") || ""
    });
  });

  return out;
}

export async function collectSteam() {
  const result = { upcoming: [], newReleases: [] };

  try {
    result.upcoming = await search(config.steam.upcomingUrl, config.steam.limit);
    console.log(`  steam upcoming -> ${result.upcoming.length}`);
  } catch (e) {
    console.warn(`  steam upcoming failed: ${e.message}`);
  }

  try {
    result.newReleases = await search(config.steam.newReleasesUrl, config.steam.limit);
    console.log(`  steam new -> ${result.newReleases.length}`);
  } catch (e) {
    console.warn(`  steam new failed: ${e.message}`);
  }

  return result;
}

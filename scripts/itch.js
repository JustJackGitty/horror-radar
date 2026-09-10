// Walks itch.io's horror browse pages and pulls out the game cells.
//
// itch.io has no public API for browse, so this parses the HTML. Their
// infinite scroll also serves JSON at ?page=N&format=json with the same
// markup inside a `content` field — we try that first because it's lighter,
// and fall back to the full page if the shape ever changes.

import * as cheerio from "cheerio";
import { config } from "../config.js";

const UA = "horror-radar/1.0 (personal stream-scouting tool)";
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchPage(baseUrl, page) {
  const url = new URL(baseUrl);
  if (page > 1) url.searchParams.set("page", page);
  url.searchParams.set("format", "json");

  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json, text/html" } });
  if (!res.ok) throw new Error(`itch ${url.pathname} page ${page} -> ${res.status}`);

  const type = res.headers.get("content-type") || "";
  if (type.includes("json")) {
    const j = await res.json();
    return j.content || "";
  }
  return res.text();
}

function parse(html, feedName) {
  const $ = cheerio.load(html);
  const out = [];

  $(".game_cell").each((_, el) => {
    const $el = $(el);
    const id = $el.attr("data-game_id") || "";
    const $link = $el.find(".game_title .title, .title.game_link").first();
    const name = $link.text().trim();
    const url = $link.attr("href") || "";
    if (!name || !url) return;

    // Price shows as "$4.99", "Free", or a sale badge.
    let price = $el.find(".price_value").first().text().trim();
    if (!price) price = $el.find(".sale_tag").length ? "On sale" : "Free";

    out.push({
      id,
      name,
      url,
      author: $el.find(".game_author").first().text().trim(),
      blurb: $el.find(".game_text").first().text().trim(),
      price,
      thumb: $el.find(".game_thumb img").first().attr("data-lazy_src")
           || $el.find(".game_thumb img").first().attr("src") || "",
      platforms: $el.find(".web_flag").length ? ["web"] : [],
      feed: feedName
    });
  });

  return out;
}

export async function collectItch() {
  const byId = new Map();

  for (const feed of config.itch.feeds) {
    for (let p = 1; p <= feed.pages; p++) {
      try {
        const html = await fetchPage(feed.url, p);
        const games = parse(html, feed.name);
        console.log(`  itch ${feed.name} p${p} -> ${games.length}`);
        if (!games.length) break; // ran out of pages

        for (const g of games) {
          const key = g.id || g.url;
          if (byId.has(key)) {
            // Appearing in more than one feed is itself a signal.
            const prev = byId.get(key);
            if (!prev.feeds.includes(g.feed)) prev.feeds.push(g.feed);
          } else {
            byId.set(key, { ...g, feeds: [g.feed] });
          }
        }
      } catch (e) {
        console.warn(`  itch ${feed.name} p${p} failed: ${e.message}`);
        break;
      }
      await sleep(config.itch.delayMs);
    }
  }

  const games = [...byId.values()].map(g => {
    const { feed, ...rest } = g;
    return rest;
  });

  console.log(`  itch total unique: ${games.length}`);
  return games;
}

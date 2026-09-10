// Everything you'd want to tune lives here.

export const config = {
  // ---- YouTube ----
  youtube: {
    // Each query costs 100 quota units. Free tier is 10,000/day, so you can
    // run ~90 queries a day. You're using far less than that.
    queries: [
      "indie horror game",
      "puppet combo",
      "chilla's art",
      "anomaly horror game",
      "spot the difference horror game",
      "observation duty",
      "itch io horror game",
      "vhs horror game",
      "ps1 horror game",
      "analog horror game",
      "short horror game",
      "free horror game",
      "scary indie game reaction",
      "new horror game 2026",
      "backrooms horror game",
      "japanese horror game indie",
      "roblox anomaly horror",
      "liminal horror game"
    ],

    // Only look at videos published in this window. This is what turns the
    // tool from "what's popular" into "what's breaking out right now".
    lookbackDays: 14,

    // Videos below this get dropped as noise.
    minViews: 2000,

    regionCode: "US",
    relevanceLanguage: "en"
  },

  // ---- itch.io ----
  itch: {
    // Which browse pages to walk. `pages` is how many pages deep to go
    // (30 games per page). Keep it modest — be a polite scraper.
    feeds: [
      { name: "newest",    url: "https://itch.io/games/newest/tag-horror",    pages: 3 },
      { name: "popular",   url: "https://itch.io/games/tag-horror",           pages: 2 },
      { name: "free",      url: "https://itch.io/games/free/tag-horror",      pages: 2 },
      { name: "top-rated", url: "https://itch.io/games/top-rated/tag-horror", pages: 1 }
    ],
    delayMs: 1200 // pause between requests
  },

  // ---- Steam ----
  steam: {
    // 1667 = Horror tag, 998 = Games (not DLC/soundtracks)
    upcomingUrl: "https://store.steampowered.com/search/results/?query&tags=1667&category1=998&sort_by=Released_ASC&untags=&hidef2p=0&ndl=1&json=1",
    newReleasesUrl: "https://store.steampowered.com/search/results/?query&tags=1667&category1=998&sort_by=Released_DESC&ndl=1&json=1",
    limit: 40
  },

  // ---- Game-name detection ----
  // Titles matching these get counted toward a known game. Add yours here;
  // anything not listed still gets picked up by the discovery pass, it just
  // needs to appear in 2+ videos from 2+ channels first.
  knownGames: [
    "Murder House", "Power Drill Massacre", "Nun Massacre", "Babysitter Bloodbath",
    "Stay Out of the House", "Bloodwash", "Christmas Massacre", "Feed Me Billy",
    "The Backrooms", "Ratshaker", "From Devil's Womb", "Scrutinized", "Dead Signal",
    "Parasocial", "Cursed Digicam", "Shinkansen 0", "The Bathhouse", "Umigari",
    "Snowed Under", "The Convenience Store", "The Closing Shift", "The Karaoke",
    "Night Security", "Stigmatized Property", "The Kidnap",
    "I'm on Observation Duty", "The Exit 8", "Platform 8", "That's Not My Neighbor",
    "Alternate Watch", "Captured", "Caught on Camera", "Silver Pines",
    "Tenebris Somnia", "Hellraiser Revival", "DreadOut 3", "Paranormal Tales",
    "darkwebSTREAMER", "Deathground", "Fearwoods", "Phasmophobia", "Content Warning",
    "Lethal Company", "R.E.P.O.", "Demonologist", "Signalis", "Mouthwashing",
    "Crow Country", "Buckshot Roulette", "Amanda the Adventurer", "Poppy Playtime",
    "Fears to Fathom", "No, I'm not a Human", "Home Safety Hotline", "Mandela Catalogue"
  ],

  // Stripped out before trying to guess a game name from a video title.
  noiseWords: [
    "gameplay","full game","no commentary","walkthrough","playthrough","part",
    "ending","all endings","scary","horror","game","games","indie","reaction",
    "funny","moments","best","worst","new","free","update","review","first",
    "playing","tried","insane","crazy","terrifying","scariest","creepy",
    "let's play","lets play","stream","highlights","compilation","shorts",
    "i played","this is","the most","you need","must play","top","must","play"
  ],

  // Discovery pass thresholds — how much evidence before a guessed name counts.
  discovery: {
    minVideos: 2,
    minChannels: 2,
    minTotalViews: 20000
  },

  outDir: "docs/data",
  keepHistoryDays: 90
};

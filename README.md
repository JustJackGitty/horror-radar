# Horror Radar

Scrapes YouTube view counts, itch.io horror releases, and Steam's horror calendar
once a day. Compares each run against the previous one so you see what's *moving*,
not just what's big. Runs free on GitHub Actions — no server, no card on file.

## Setup, about ten minutes

**1. Get a YouTube API key**

Go to [console.cloud.google.com](https://console.cloud.google.com), make a new
project, then:

- APIs & Services → Library → search "YouTube Data API v3" → Enable
- APIs & Services → Credentials → Create credentials → API key
- Copy it. Leave it unrestricted for now; if you restrict it later, pick
  "API restrictions → YouTube Data API v3" and *not* an HTTP referrer restriction,
  since this calls from a server.

Free tier is 10,000 quota units a day. This uses about 1,900, so you have room to
roughly quadruple the query list in `config.js` before you'd need to care.

**2. Push this to a GitHub repo**

```bash
git init
git add .
git commit -m "first"
git branch -M main
git remote add origin https://github.com/YOURNAME/horror-radar.git
git push -u origin main
```

**3. Add the key as a secret**

Repo → Settings → Secrets and variables → Actions → New repository secret.
Name it exactly `YOUTUBE_API_KEY`, paste the key.

**4. Turn on Pages**

Repo → Settings → Pages → Source: *Deploy from a branch* → branch `main`,
folder `/docs`. Your dashboard lands at
`https://YOURNAME.github.io/horror-radar/` in a minute or two.

**5. Run it once by hand**

Repo → Actions → "Daily scrape" → Run workflow. The first run has nothing to
compare against, so everything shows as NEW. The second run is where it gets
useful.

After that it runs itself at 13:00 UTC (6am Pacific) daily.

## Running locally

```bash
npm install
YOUTUBE_API_KEY=your_key npm run scrape
npm run serve      # dashboard at localhost:3000
```

## How the ranking works

Raw view counts mostly tell you what's already huge, which is exactly what you
can't compete for. So each game gets a score out of 100 weighted:

- **55%** day-over-day view growth
- **25%** how many distinct channels are covering it
- **20%** raw size

A game three mid-size channels picked up yesterday scores higher than one
everybody has already covered for a month. That's the window you actually have.

Statuses: `NEW` (not in yesterday's data), `CLIMBING` (+40% or more),
`COOLING` (−25% or worse), `STEADY` (everything else).

## Tuning it

Everything's in `config.js`.

- `youtube.queries` — add searches. Each costs 100 quota units.
- `youtube.lookbackDays` — 14 by default. Drop to 7 for a sharper signal and
  fewer results; raise to 30 for a broader picture.
- `youtube.minViews` — the noise floor.
- `knownGames` — names here get matched exactly. Anything not listed still gets
  found by the discovery pass, it just has to clear `discovery` thresholds first
  (2+ videos, 2+ channels, 20K+ views) to prove it isn't a parsing accident.
- `itch.feeds` — which browse pages to walk and how deep.

## Things that will eventually break

**Steam.** `scripts/steam.js` parses an HTML fragment out of Steam's search
endpoint. It's been stable for years but it's not a documented API. If the Steam
tab goes empty, the selectors in that file are what moved. Nothing else breaks
when it does — it's wrapped so a Steam failure doesn't take down the run.

**itch.io.** Same deal, `.game_cell` markup. Also not an API. Be polite with
`itch.delayMs` — 1200ms between requests is deliberate, don't lower it.

**Name detection.** Guessing a game name out of a YouTube title is a heuristic,
not a solved problem. You'll occasionally see a garbage entry. The fix is
usually to add the real name to `knownGames` so it matches exactly next time.
Ten minutes of that once a month and it gets noticeably sharper.

**GitHub Actions on a schedule.** Cron jobs on free runners can fire up to an
hour late under load, and GitHub disables scheduled workflows in repos with no
activity for 60 days. If it goes quiet, push any commit to wake it up.

// Controlled Chromium synthetic API fixtures: NOT live API/R2 performance or authenticated E2E.
const { chromium } = require("playwright");
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  http = require("node:http");
const root = process.cwd(),
  out = path.join(root, ".hermes/qa/loading-transitions/phase1/rework");
fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const track = {
  id: "feed-track",
  resourceOwnerId: "A",
  title: "Synthetic feed",
  description: "",
  color: "indigo",
  icon: "Heart",
  tags: [],
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  accessRole: "owner",
};
function data(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `feed-${i}`,
    resourceOwnerId: "A",
    eventId: track.id,
    version: 1,
    title: `Memory ${String(i).padStart(5, "0")}`,
    description: "Synthetic metadata " + "example ".repeat(30),
    date: i < 400 ? "2026-10-15" : i < 800 ? "2026-09-15" : "2025-01-15",
    tags: ["fixture"],
    images: [],
    isMilestone: i % 10 === 0,
    createdAt: "2026-10-15",
    updatedAt: "2026-10-15",
    reactions: [],
  }));
}
function overview(ms) {
  return {
    total: ms.length,
    milestones: ms.filter((m) => m.isMilestone).length,
    photos: 0,
    places: 0,
    earliest: "2026-10-15",
    latest: "2026-10-15",
    tracks: [
      {
        trackOwnerId: "A",
        trackId: track.id,
        count: ms.length,
        milestones: Math.ceil(ms.length / 10),
        photos: 0,
        minDate: "2026-10-15",
        maxDate: "2026-10-15",
      },
    ],
    tags: [{ name: "fixture", count: ms.length }],
    years: ["2026"],
  };
}
async function setup(browser, base, n, variants = false) {
  const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      reducedMotion: "reduce",
    }),
    page = await context.newPage();
  const state = { requests: [], errors: [], failed: [], held: null };
  const ms = data(n);
  if (variants) {
    for (let i = 0; i < 120; i++) {
      ms[i].date = "";
      ms[i].id = `undated-${Math.floor(i / 2)}`;
      ms[i].resourceOwnerId = i % 2 ? "B" : "A";
      ms[i].title = `Undated ${i} tiếng Việt rất dài`;
    }
  }
  page.on("pageerror", (e) => state.errors.push(e.message));
  page.on("requestfailed", (r) =>
    state.failed.push({ url: r.url(), error: r.failure() }),
  );
  await context.route("**/*", async (route) => {
    const req = route.request(),
      u = new URL(req.url());
    if (u.origin !== base) return route.abort();
    if (!u.pathname.startsWith("/api/")) return route.continue();
    const q = req.method() === "POST" ? req.postDataJSON() : {};
    state.requests.push({
      method: req.method(),
      path: u.pathname,
      q,
      url: u.pathname + u.search,
    });
    let body = {};
    const ordered = q.sortDirection === "oldest" ? [...ms].reverse() : ms;
    if (u.pathname.startsWith("/api/images/variant-")) {
      assert.equal(u.searchParams.get("variant"), "thumb");
      return route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="orange"/></svg>',
      });
    }
    if (u.pathname === "/api/images/fixture-photo") {
      assert.equal(u.searchParams.get("variant"), "thumb");
      return route.fulfill({ status: 503, body: "" });
    }
    if (u.pathname === "/api/auth/me")
      body = { user: { id: "A", username: "synthetic-A" } };
    else if (u.pathname === "/api/tracks") body = { tracks: [track] };
    else if (u.pathname === "/api/tags") body = { tags: [] };
    else if (u.pathname === "/api/moments/overview")
      body = { overview: overview(ms) };
    else if (u.pathname === "/api/moments") {
      state.errors.push("Forbidden legacy full fetch");
      return route.fulfill({
        status: 500,
        json: { error: "Forbidden legacy full fetch" },
      });
    } else if (u.pathname === "/api/moments/browse/months") {
      if (state.failMetadata && q.cursor) {
        state.failMetadata = false;
        return route.fulfill({
          status: 503,
          json: { error: "Synthetic metadata cursor failure" },
        });
      }
      let months = [
        { key: "2026-10", count: variants ? 280 : 400 },
        { key: "2026-09", count: 400 },
        { key: "2025-01", count: 4200 },
      ];
      if (q.sortDirection === "oldest") months.reverse();
      if (variants && q.cursor === "metadata-next")
        months = [{ key: "2025-01", count: 4200 }];
      body = {
        scope: "fixture",
        years: [
          { year: "2026", count: 800 },
          { year: "2025", count: 4200 },
        ],
        months,
        undatedCount: variants ? 120 : 0,
        nextCursor: variants && !q.cursor ? "metadata-next" : null,
        previousCursor: variants && q.cursor ? "metadata-previous" : null,
      };
    } else if (u.pathname === "/api/moments/browse/preview") {
      const filtered = ordered.filter((m) =>
          q.month === "undated" ? !m.date : m.date.slice(0, 7) === q.month,
        ),
        start = Number(q.cursor || 0);
      body = {
        scope: "fixture",
        month: q.month,
        total: filtered.length,
        items: filtered
          .slice(start, start + 24)
          .map((m) => ({
            ownerId: m.resourceOwnerId,
            id: m.id,
            eventId: m.eventId,
            date: m.date,
            title: m.title,
            excerpt: m.description.slice(0, 200),
            thumbUrl: variants
              ? `/api/images/variant-${m.resourceOwnerId}-${m.id}?variant=thumb`
              : Number(m.id.split("-")[1]) % 3 === 0
                ? "/api/images/fixture-photo?variant=thumb"
                : null,
          })),
        nextCursor: start + 24 < filtered.length ? String(start + 24) : null,
        previousCursor: start > 0 ? String(Math.max(0, start - 24)) : null,
      };
    } else if (u.pathname === "/api/moments/seek") {
      if (state.failSeek) {
        state.failSeek = false;
        return route.fulfill({
          status: 503,
          json: { error: "Synthetic seek unavailable" },
        });
      }
      if (state.holdSeek) {
        state.holdSeek = false;
        state.seekHeld = true;
        await new Promise((r) => (state.releaseSeek = r));
      }
      const start = q.target.month
        ? ordered.findIndex((m) =>
            q.target.month === "undated"
              ? !m.date
              : m.date.slice(0, 7) === q.target.month,
          )
        : ordered.findIndex(
            (m) =>
              m.id === q.target.id && m.resourceOwnerId === q.target.ownerId,
          );
      body = {
        moments: ordered.slice(start, start + 40),
        nextCursor: String(start + 40),
        previousCursor: start > 0 ? String(Math.max(0, start - 40)) : null,
        total: 5000,
        target: {
          ownerId: ordered[start].resourceOwnerId,
          id: ordered[start].id,
        },
      };
    } else if (u.pathname === "/api/moments/query") {
      let filtered = ordered;
      if (q.search === "slow") {
        state.held = true;
        await new Promise((r) => (state.release = r));
        filtered = [{ ...ms[0], id: "stale-result", title: "Stale result" }];
      } else if (q.search)
        filtered = ms.filter((m) => m.title.includes(q.search));
      const start = Number(q.cursor || 0),
        limit = q.limit || 40;
      body = {
        moments: filtered.slice(start, start + limit),
        nextCursor:
          start + limit < filtered.length ? String(start + limit) : null,
        total: filtered.length,
      };
    } else if (u.pathname === "/api/moments/resurfacing")
      body = { moments: [] };
    else if (u.pathname === "/api/track-visits") body = { visits: [] };
    else if (u.pathname.endsWith("/visit"))
      body = {
        visit: {
          trackOwnerId: "A",
          trackId: track.id,
          lastOpenedAt: new Date().toISOString(),
        },
      };
    else if (u.pathname.endsWith("/perspectives"))
      body = {
        perspectives: [],
        nextCursor: null,
        capabilities: { canRead: true, canCreate: true, canModerate: true },
      };
    else if (u.pathname === "/api/saved") body = { saved: [], count: 0 };
    else if (u.pathname === "/api/collaboration-invitations")
      body = { invitations: [] };
    else {
      state.errors.push(`Unexpected ${req.method()} ${u.pathname}`);
      return route.fulfill({
        status: 500,
        json: { error: "Unexpected fixture request" },
      });
    }
    await route
      .fulfill({ json: body, headers: { "Cache-Control": "no-store" } })
      .catch(() => {});
  });
  return { context, page, state };
}
(async () => {
  const server = http.createServer((req, res) => {
    let f = path.join(root, "dist", decodeURIComponent(req.url.split("?")[0]));
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory())
      f = path.join(root, "dist/index.html");
    res.setHeader(
      "Content-Type",
      f.endsWith(".js")
        ? "text/javascript"
        : f.endsWith(".css")
          ? "text/css"
          : "text/html",
    );
    res.end(fs.readFileSync(f));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({
    executablePath:
      "/home/ubuntu/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux-arm64/chrome-headless-shell",
    args: ["--no-sandbox"],
  });
  const report = { synthetic: true, checks: [], geometry: [], passed: false };
  try {
    const { context, page, state } = await setup(browser, base, 5000);
    await page.goto(base);
    await page.locator('[id^="event-card-"]').first().waitFor();
    await page.evaluate(async () => {
      await document.fonts.ready;
      scrollTo(0, 500);
    });
    await page.waitForFunction(() => Boolean(document.querySelector('#month-edge-rail[data-month="2026-10"]')));
    await page.waitForTimeout(700);
    assert.equal(state.requests.filter((r) => r.path === "/api/moments/browse/preview").length, 1, "eligible idle rail warms one bounded preview page");
    assert.equal(state.requests.filter((r) => r.path === "/api/moments/browse/months").length, 1, "idle rail loads bounded month metadata once");
    assert.equal(state.requests.filter((r) => r.path.startsWith("/api/images/")).length, 0, "warming metadata never requests a thumb");
    const card = await page.locator('[id^="event-card-"]').first().boundingBox();
    assert(card && card.width > 700, `timeline card width restored: ${card?.width}`);
    await page.locator("#month-edge-rail").hover();
    await page.locator('[data-testid="edge-film-preview"]').waitFor();
    assert.equal(await page.locator('#month-browse-open,[data-testid="month-browse-panel"]').count(), 0, "obsolete browse menu is absent");
    await page.waitForTimeout(700);
    await page.getByRole("button",{name:/Go to memory:/}).focus();
    await page.waitForTimeout(700);
    const expectedId="feed-"+Number((await page.getByRole("button",{name:/Go to memory:/}).innerText()).match(/Memory (\d+)/)[1]);
    state.failSeek=true;
    await page.getByRole('button', { name: /Go to memory:/ }).focus();await page.keyboard.press('Enter');
    await page.getByRole('button',{name:'Retry requested results',exact:true}).waitFor();
    const failed=state.requests.filter(r=>r.path==='/api/moments/seek').at(-1);
    // Independently expected first warmed October preview, not response.target.
    assert.equal(failed.q.target.id,expectedId);
    state.holdSeek=true;
    await page.getByRole('button',{name:'Retry requested results',exact:true}).click();
    await page.waitForTimeout(100);
    assert(state.seekHeld,'retry reached held seek');
    assert.deepEqual(state.requests.filter(r=>r.path==='/api/moments/seek').at(-1),failed);
    await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));
    state.releaseSeek();
    await page.waitForFunction(id=>document.activeElement?.id==='event-card-A:'+id,expectedId);
    const landingBox=await page.locator('[id="event-card-A:'+expectedId+'"]').boundingBox();
    assert(landingBox.y<900&&landingBox.y+landingBox.height>0,'expected target visible');
    assert.equal(await page.getByRole('dialog').count(),0,'no automatic detail');
    assert.deepEqual(state.errors,[]);
    assert.equal(state.requests.filter(r=>r.path==='/api/moments').length,0);
    report.checks.push('503 seek -> held exact retry -> App landBrowse independently selected preview visible/focused; no detail');
    report.passed = true;
  } catch (e) {
    report.error = e.stack;
    process.exitCode = 1;
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
    report.cleanup={browser:true,server:true};
    fs.writeFileSync(
      path.join(out, "month-ui-results.json"),
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report, null, 2));
  }
})();
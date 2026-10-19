// Controlled Chromium synthetic API fixtures: NOT live API/R2 performance or authenticated E2E.
const { chromium } = require("playwright");
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  http = require("node:http");
const root = process.cwd(),
  out = path.join(root, ".hermes/evidence/month-quick-browse");
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
    await page.waitForFunction(() =>
      document
        .querySelector("#month-browse-open")
        ?.textContent.includes("2026-10"),
    );
    assert.equal(
      state.requests.filter((r) => r.path === "/api/moments/browse/preview").length,
      1,
      "eligible idle rail warms one bounded preview page",
    );
    assert.equal(
      state.requests.filter((r) => r.path === "/api/moments/browse/months").length,
      1,
      "idle rail loads bounded month metadata once",
    );
    assert.equal(
      state.requests.filter((r) => r.path.startsWith("/api/images/")).length,
      0,
      "warming metadata never requests a thumb",
    );
    report.checks.push(
      "Idle rail warms one bounded preview page without image bytes",
    );
    const ids = await page
      .locator('[id^="event-card-"]')
      .evaluateAll((es) => es.map((e) => e.id));
    const y = await page.evaluate(() => scrollY);
    await page.locator("#month-edge-rail").hover();
    await page.locator('[data-testid="edge-film-preview"]').waitFor();
    assert.equal(state.requests.filter((r) => r.path === "/api/moments/browse/preview").length, 1, "hover reuses the warmed bounded preview page");
    await page.getByRole("button", { name: "Browse this memory", exact: true }).click();
    await page.locator('[data-testid="sun-preview"]').first().waitFor();
    assert.equal(await page.locator('[data-testid="sun-preview"]').count(), 1);
    assert.equal(await page.getByRole("button", { name: /Memory \d+ of \d+:/ }).count(), 0, "dialog has no radial ray controls");
    assert((await page.locator('[data-testid="browse-grid"] > div > button').count()) >= 24, "conventional bounded grid");
    await page.getByRole("button", { name: "2026-09", exact: false }).click();
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="sun-preview"] time')
          ?.textContent === "2026-09-15",
    );
    for (let i = 0; i < 4; i++) {
      await page
        .getByRole("button", { name: "Next previews", exact: true })
        .click();
      await page.waitForFunction(
        (n) =>
          document
            .querySelector('[data-testid="browse-grid"]')
            ?.textContent.includes(`${n}–`),
        25 + i * 24,
      );
    }
    for (let i = 0; i < 4; i++) {
      await page
        .getByRole("button", { name: "Previous previews", exact: true })
        .click();
      await page.waitForFunction(
        (n) =>
          document
            .querySelector('[data-testid="browse-grid"]')
            ?.textContent.includes(`${n}–`),
        73 - i * 24,
      );
    }
    await page.getByRole("navigation", { name: "Month navigator" }).focus();
    await page.keyboard.press("Home");
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="browse-month-label"]')
          ?.textContent === "2026-10",
    );
    await page.keyboard.press("ArrowDown");
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="browse-month-label"]')
          ?.textContent === "2026-09",
    );
    const selected = await page
      .locator('[data-testid="browse-month-label"]')
      .innerText();
    await page.locator('[data-testid="browse-grid"]').hover();
    await page.mouse.wheel(0, 500);
    assert.equal(
      await page.locator('[data-testid="browse-month-label"]').innerText(),
      selected,
    );
    await page.getByRole("navigation", { name: "Month navigator" }).hover();
    await page.mouse.wheel(0, 100);
    await page.mouse.wheel(0, 100);
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="browse-month-label"]')
          ?.textContent === "2025-01",
    );
    const range = page.getByRole("slider", { name: "Scrub months" });
    await range.focus();
    await page.keyboard.press("Home");
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="browse-month-label"]')
          ?.textContent === "2026-10",
    );
    await page
      .getByRole("combobox", { name: "Browse year" })
      .selectOption("2025");
    await page.waitForFunction(
      () =>
        document.querySelector('select[aria-label="Browse year"]').value ===
        "2025",
    );
    report.checks.push(
      "Navigator keyboard, scrub and wheel burst; grid wheel isolated; year request",
    );
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "detached" });
    assert.deepEqual(
      await page
        .locator('[id^="event-card-"]')
        .evaluateAll((es) => es.map((e) => e.id)),
      ids,
    );
    assert(Math.abs((await page.evaluate(() => scrollY)) - y) <= 2);
    report.checks.push(
      "Preview four pages and month selection leave feed identities and scroll unchanged; Escape restores",
    );
    for (const size of [
      { width: 1024, height: 768 },
      { width: 1280, height: 720 },
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
      { width: 1280, height: 600 },
    ]) {
      await page.setViewportSize(size);
      for (const dark of [false, true]) {
        await page.evaluate(
          (d) => document.documentElement.classList.toggle("dark", d),
          dark,
        );
        assert(
          await page.locator("#month-browse-open").evaluate((el) => {
            const r = el.getBoundingClientRect();
            return [0.2, 0.5, 0.8].every((x) =>
              [0.2, 0.5, 0.8].every((y) => {
                const hit = document.elementFromPoint(
                  r.x + r.width * x,
                  r.y + r.height * y,
                );
                return hit === el || el.contains(hit);
              }),
            );
          }),
        );
        await page.locator("#month-browse-open").click();
        await page.locator('[data-testid="sun-preview"]').first().waitFor();
        const geometry = await page
          .locator('[data-testid="month-browse-panel"]')
          .evaluate((el) => {
            const r = el.getBoundingClientRect();
            return {
              x: r.x,
              y: r.y,
              width: r.width,
              height: r.height,
              clientHeight: el.clientHeight,
              scrollHeight: el.scrollHeight,
            };
          });
        assert(geometry.x >= 23 && geometry.y >= 23);
        assert(
          geometry.width <= size.width - 47 &&
            geometry.height <= size.height - 47,
        );
        assert(geometry.scrollHeight <= geometry.clientHeight);
        report.geometry.push({ ...size, dark, ...geometry });
        await page.screenshot({
          path: path.join(
            out,
            `month-${size.width}x${size.height}-${dark ? "dark" : "light"}.png`,
          ),
        });
        const fixed = await page
          .locator(
            '[data-testid="month-browse-panel"] header,[data-testid="month-browse-panel"] footer',
          )
          .evaluateAll((es) => es.map((e) => e.getBoundingClientRect().y));
        await page
          .locator('[data-testid="browse-grid"]')
          .evaluate((el) => (el.scrollTop = el.scrollHeight));
        assert.deepEqual(
          await page
            .locator(
              '[data-testid="month-browse-panel"] header,[data-testid="month-browse-panel"] footer',
            )
            .evaluateAll((es) => es.map((e) => e.getBoundingClientRect().y)),
          fixed,
        );
        assert(
          await page
            .getByRole("button", { name: "Next previews", exact: true })
            .isVisible(),
        );
        await page.keyboard.press("Escape");
        await page.getByRole("dialog").waitFor({ state: "detached" });
      }
    }
    report.checks.push(
      "Five desktop viewports × light/dark bounded panel and fixed header/footer screenshots",
    );
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.locator("#month-browse-open").click();
    await page.locator('[data-testid="sun-preview"]').first().waitFor();
    await page.getByRole("button", { name: "2026-09", exact: false }).click();
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="sun-preview"] time')
          ?.textContent === "2026-09-15",
    );
    const requests = state.requests.filter(
      (r) => r.path === "/api/moments/query",
    ).length;
    const beforeFail = await page
      .locator('[id^="event-card-"]')
      .evaluateAll((es) => es.map((e) => e.id));
    state.failSeek = true;
    await page
      .locator('[data-testid="sun-preview"] button')
      .filter({ hasText: "Go to memory" })
      .first()
      .click();
    await page
      .getByText(
        "Memory unavailable within current filters. Retry or choose another memory.",
        { exact: true },
      )
      .waitFor();
    assert.deepEqual(
      await page
        .locator('[id^="event-card-"]')
        .evaluateAll((es) => es.map((e) => e.id)),
      beforeFail,
    );
    report.checks.push(
      "Failed seek retains old feed and browser with actionable retry",
    );
    await page
      .locator('[data-testid="sun-preview"] button')
      .filter({ hasText: "Go to memory" })
      .first()
      .click();
    await page.getByRole("dialog").waitFor({ state: "detached" });
    await page.waitForFunction(
      () => document.activeElement?.id === "event-card-A:feed-400",
    );
    assert.equal(
      state.requests.filter((r) => r.path === "/api/moments/query").length,
      requests,
    );
    assert.equal(
      state.requests.filter((r) => r.path === "/api/moments/seek").length,
      2,
    );
    assert(await page.locator("#feed-load-previous").isVisible());
    report.checks.push(
      "Direct specific-item seek outside retained window; no intermediate query; focused exact card and previous paging",
    );
    await page.locator("#month-browse-open").click();
    await page.locator('[data-testid="sun-preview"]').first().waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("dialog").waitFor({ state: "detached" });
    report.checks.push("Desktop overlay closes on resize below1024");
    for (const width of [390, 768]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(await page.locator("#month-browse-open").count(), 0);
      assert.equal(await page.locator("#month-browse-open").isVisible(), false);
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
    }
    report.checks.push("Mobile/tablet no rail or horizontal overflow");
    assert.equal(
      state.requests.filter((r) => r.path === "/api/moments").length,
      0,
    );
    assert.deepEqual(state.errors, []);
    report.checks.push("No pageerrors");
    report.requests = state.requests;
    await context.close();
    const v = await setup(browser, base, 5000, true),
      vp = v.page,
      vs = v.state;
    await vp.goto(base);
    await vp.locator('[id^="event-card-"]').first().waitFor();
    await vp.evaluate(async () => { await document.fonts.ready; scrollTo(0, 500); });
    await vp.waitForFunction(() => Boolean(document.querySelector("#month-browse-open")));
    await vp.locator("#month-browse-open").click();
    await vp.locator('[data-testid="sun-preview"]').first().waitFor();
    // Real pointer events on the native range, not keyboard or dispatched change events.
    const slider = vp.getByRole("slider", { name: "Scrub months" }),
      box = await slider.boundingBox();
    const beforeDrag = vs.requests.filter((r) =>
      r.path.endsWith("/browse/preview"),
    ).length;
    await vp.mouse.move(box.x + 8, box.y + box.height / 2);
    await vp.mouse.down();
    await vp.mouse.move(box.x + box.width - 8, box.y + box.height / 2, {
      steps: 12,
    });
    await vp.mouse.up();
    await vp.waitForFunction(
      () =>
        document.querySelector('[data-testid="sun-preview"] time')
          ?.textContent === "2025-01-15",
    );
    const dragCalls =
      vs.requests.filter((r) => r.path.endsWith("/browse/preview")).length -
      beforeDrag;
    assert(dragCalls >= 1 && dragCalls <= 2, `drag previews ${dragCalls}`);
    report.checks.push(
      "Actual pointer-down/move/up scrub reaches last month with <=2 preview calls",
    );
    vs.failMetadata = true;
    await vp.getByRole("button", { name: "Later page", exact: true }).click();
    await vp.getByRole("alert").waitFor();
    const failedOp = vs.requests
      .filter((r) => r.path.endsWith("/browse/months"))
      .at(-1).q;
    await vp.getByRole("button", { name: "Retry", exact: true }).click();
    await vp.getByRole("alert").waitFor({ state: "detached" });
    assert.deepEqual(
      vs.requests.filter((r) => r.path.endsWith("/browse/months")).at(-1).q,
      failedOp,
    );
    assert.equal(failedOp.cursor, "metadata-next");
    assert.equal(failedOp.navigation, "next");
    vs.failMetadata = true;
    await vp.getByRole("button", { name: "Earlier page", exact: true }).click();
    await vp.getByRole("alert").waitFor();
    const failedPrevious = vs.requests
      .filter((r) => r.path.endsWith("/browse/months"))
      .at(-1).q;
    await vp.getByRole("button", { name: "Retry", exact: true }).click();
    await vp.getByRole("alert").waitFor({ state: "detached" });
    assert.deepEqual(
      vs.requests.filter((r) => r.path.endsWith("/browse/months")).at(-1).q,
      failedPrevious,
    );
    assert.equal(failedPrevious.navigation, "previous");
    report.checks.push(
      "Metadata Retry replays exact next and previous failed cursor operations rather than year start",
    );
    await vp.keyboard.press("Escape");
    await vp.getByRole("dialog").waitFor({ state: "detached" });
    await vp.locator("#toggle-sort-direction").click();
    await vp.waitForFunction(() =>
      document
        .querySelector("#toggle-sort-direction")
        ?.getAttribute("aria-label")
        ?.includes("Sorted oldest first"),
    );
    await vp.locator("#month-browse-open").click();
    await vp.locator('[data-testid="sun-preview"]').first().waitFor();
    const imageRequestStart = vs.requests.length;
    await vp
      .getByRole("navigation", { name: "Month navigator" })
      .getByRole("button", { name: "Undated", exact: false })
      .click();
    await vp.waitForFunction(() =>
      document
        .querySelector('[data-testid="browse-grid"]')
        ?.textContent.includes("1–24 of 120"),
    );
    const rays = vp.getByRole("button", { name: /Memory \d+ of 24:/ });
    assert.equal(await rays.count(), 0, "dialog has no radial ray controls");
    const beforePreview = await vp
      .locator('[data-testid="sun-preview"] h3')
      .innerText();
    await vp.getByRole("dialog").press("End");
    await vp.waitForFunction(
      (before) =>
        document.querySelector('[data-testid="sun-preview"] h3')
          ?.textContent !== before,
      beforePreview,
    );
    assert.equal(await rays.count(), 0);
    const rayImages = vp.locator('[aria-label^="Memory "] img');
    assert.equal(await rayImages.count(), 0);
    for (const image of await rayImages.all()) {
      await image.scrollIntoViewIfNeeded();
      await image.evaluate((el) => el.decode());
    }
    const thumbs = vs.requests.slice(imageRequestStart).filter((r) =>
      r.path.startsWith("/api/images/variant-"),
    );
    assert(thumbs.length <= 10, `bounded thumb requests ${thumbs.length}`);
    assert.equal(new Set(thumbs.map((r) => r.url)).size, thumbs.length);
    assert(
      thumbs.every(
        (r) =>
          new URL(`http://fixture${r.url}`).searchParams.get("variant") ===
          "thumb",
      ),
    );
    report.measurements = {
      pointerDragPreviewCalls: dragCalls,
      undatedTotal: 120,
      renderedRays: await rays.count(),
      thumbRequests: thumbs.length,
    };
    for (let i = 0; i < 4; i++) {
      await vp
        .getByRole("button", { name: "Next previews", exact: true })
        .click();
      await vp.waitForFunction(
        (n) =>
          document
            .querySelector('[data-testid="browse-grid"]')
            ?.textContent.includes(`${n}–`),
        25 + i * 24,
      );
      assert.equal(await vp.locator('[data-testid="sun-preview"]').count(), 1);
      assert(
        (await vp
          .getByRole("button", { name: /Memory \d+ of 24:/ })
          .count()) === 0,
      );
    }
    report.checks.push(
      "Oldest UI sort; keyboard selection changes the single preview; dense Undated previews page through <=10 rays and make bounded thumb-variant requests",
    );
    // Duplicate activation while a genuine fixture response is held must not submit another seek.
    vs.holdSeek = true;
    const seekCount = vs.requests.filter((r) =>
      r.path.endsWith("/seek"),
    ).length;
    await vp
      .getByRole("button", { name: "Go to this month", exact: true })
      .click();
    await vp.waitForFunction(() =>
      document
        .querySelector('[data-testid="month-browse-panel"] footer')
        ?.textContent.includes("Going to memory"),
    );
    await vp
      .locator('[data-testid="month-browse-panel"] footer button')
      .evaluate((el) => {
        el.click();
        el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    assert.equal(
      vs.requests.filter((r) => r.path.endsWith("/seek")).length,
      seekCount + 1,
    );
    assert(vs.seekHeld);
    vs.releaseSeek();
    await vp.getByRole("dialog").waitFor({ state: "detached" });
    await vp.waitForFunction(
      () => document.activeElement?.id === "event-card-B:undated-59",
    );
    await vp
      .getByRole("button", { name: "Back to start", exact: true })
      .waitFor();
    report.checks.push(
      "Oldest Undated month commit lands first canonical item; duplicate commit injection sends exactly one seek; Back to start visible",
    );
    assert.deepEqual(vs.errors, []);
    assert.equal(
      vs.requests.filter((r) => r.path === "/api/moments").length,
      0,
    );
    report.variantRequests = vs.requests;
    await v.context.close();
    report.passed = true;
  } catch (e) {
    report.error = e.stack;
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(
      path.join(out, "month-ui-results.json"),
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report, null, 2));
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})();
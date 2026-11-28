// Tirekick's workbench on a phone (tirekick.app/app/): the flip check with a sold price you type, questions for the
// seller and a safety checklist, and your finds from Weighing up to Sold. It runs the extension's own rules
// (lib/sites.js, rules.js and shared.js are copies, see scripts/phone-sync.mjs) and keeps everything in this browser's
// storage. Nothing is fetched or sent: the only way out is a file you save. Plan: docs/ROADMAP.md, Brief 9, "Phones".
(() => {
  const S = self.TKShared;
  const R = self.TKRules;
  const TK = self.Tirekick; // lib/adapters.js: only its text checks are used here (off-site contact, title codes)
  const $ = (s) => document.querySelector(s);
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (v != null && v !== false) el.setAttribute(k, v === true ? "" : v);
    }
    kids.flat().forEach((k) => k != null && k !== false && el.append(k instanceof Node ? k : document.createTextNode(String(k))));
    return el;
  };
  const money = (n) => `$${Math.round(n)}`;
  const num = (el) => (el.value.trim() === "" ? null : Math.max(0, parseFloat(el.value)) || 0);

  // ---------- what's kept on this phone ----------
  // localStorage, which every browser here has. Reads and writes are wrapped: a private window or a full disk
  // still shows the page, it just can't keep anything (and says so).
  const KEY = { finds: "tirekick.finds", settings: "tirekick.settings" };
  const read = (k) => {
    try {
      return JSON.parse(localStorage.getItem(k) || "null");
    } catch {
      return null;
    }
  };
  let canKeep = true;
  const write = (k, v) => {
    try {
      localStorage.setItem(k, JSON.stringify(v));
      canKeep = true;
    } catch {
      canKeep = false;
      note("This browser isn't letting Tirekick keep anything (a private window, or storage is full). Save a copy so nothing is lost.");
    }
  };
  // Every find through the extension's own shape (TKShared.cleanFind), newest FIND_MAX kept.
  const cleanAll = (all) => {
    const out = {};
    for (const [k, r] of Object.entries(all && typeof all === "object" ? all : {})) {
      const c = S.FIND_KEY.test(k) ? S.cleanFind(r) : undefined;
      if (c) out[k] = c;
    }
    return S.applyEdit(out, { cap: { max: S.FIND_MAX, by: "a0" } });
  };
  let finds = cleanAll(read(KEY.finds));
  const edit = (e) => {
    finds = cleanAll(S.applyEdit(cleanAll(read(KEY.finds) || finds), e)); // another tab's change isn't undone
    write(KEY.finds, finds);
    drawBench();
  };
  const settings = (() => {
    const s = read(KEY.settings) || {};
    const ok = (v, max) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max ? v : null);
    return { profit: ok(s.profit, 100000) ?? 20, fee: ok(s.fee, 50) ?? 13.6 };
  })();
  const saveSettings = () => write(KEY.settings, settings);
  // Ask the browser not to clear this site's storage on its own (iPhone clears a site after a week unvisited).
  navigator.storage?.persist?.().catch(() => {});

  // ---------- the flip check ----------
  const qEl = $("#q"), askEl = $("#ask"), soldEl = $("#sold"), shipEl = $("#ship"), partsEl = $("#parts"), profitEl = $("#profit"), feeEl = $("#fee");
  const out = $("#out");
  profitEl.value = String(settings.profit);
  feeEl.value = String(settings.fee);
  const soldUrl = (q) => {
    const u = new URL("https://www.ebay.com/sch/i.html");
    if (q) u.searchParams.set("_nkw", q);
    u.searchParams.set("LH_Sold", "1");
    u.searchParams.set("LH_Complete", "1");
    return u.href;
  };
  // A sold price you typed: one number, not a summary of sales, so it reads as "about" (rough).
  const typedMarket = () => {
    const sold = num(soldEl);
    return sold > 0 ? { median: sold, ship: num(shipEl) || 0, n: 0, confidence: "rough" } : null;
  };
  const drawCheck = () => {
    const q = qEl.value.trim();
    $("#sold-link").href = soldUrl(q);
    $("#tpl-q").textContent = R.sellerQuestions(q);
    const market = typedMarket();
    if (!market) return out.replaceChildren(q || num(askEl) != null ? h("p", { class: "basis" }, "Type what it sells for (its typical eBay sale) to see the most to pay.") : "");
    const f = R.flipCall(num(askEl), market, { title: q, feePct: settings.fee, profit: settings.profit, parts: num(partsEl) || 0 });
    out.dataset.call = f.call || "";
    out.replaceChildren(
      f.call ? h("div", { class: "verdict" }, f.word) : null,
      h("p", { class: "max" }, f.maxPay > 0 ? `Pay at most ${money(f.maxPay)}` : `No price leaves your ${money(settings.profit)}`),
      f.why ? h("p", {}, f.why) : null,
      h("p", { class: "basis" }, f.basis, " The sells-for price is the one you typed."),
      h("button", { type: "button", class: "primary", onclick: addFind }, "Add to workbench")
    );
  };
  const addFind = () => {
    const q = qEl.value.trim() || "Something I found";
    const market = typedMarket();
    const r = { t: q, a0: Date.now(), ...(num(askEl) != null && { ask: num(askEl) }), ...(market && { sold: market.median, ship: market.ship, sa: Date.now(), r: true }), ...(num(partsEl) > 0 && { parts: num(partsEl) }), ...(sharedLink && { note: sharedLink.slice(0, S.NOTE_MAX) }) };
    edit({ set: { [S.newFindKey()]: r } });
    sharedLink = "";
    $("#shared").textContent = "";
    note(`Added “${q.slice(0, 60)}” to your finds.`);
    $("#bench-h").scrollIntoView({ behavior: "smooth", block: "start" });
  };
  for (const el of [qEl, askEl, soldEl, shipEl, partsEl]) el.addEventListener("input", () => (drawCheck(), drawSigns()));
  for (const [el, k, max] of [[profitEl, "profit", 100000], [feeEl, "fee", 50]])
    el.addEventListener("input", () => {
      const v = num(el);
      if (v == null || v > max) return;
      settings[k] = v;
      saveSettings();
      drawCheck();
      drawSell();
      drawBench();
    });
  $("#check").addEventListener("submit", (e) => e.preventDefault());

  // ---------- sell something ----------
  // The sell helper from Tirekick's page (TKRules.sellAsks, sellPrices, sellWhere, sellTitle, sellTips), from a sold
  // price you type: the details that move the price as you type, then list, sell-fast and lowest prices with what
  // each leaves you. Add to workbench keeps it as Listed, as on the computer.
  const sellQ = $("#sell-q"), sellSold = $("#sell-sold"), sellPaid = $("#sell-paid"), sellLocal = $("#sell-local");
  const sellAsks = $("#sell-asks"), sellOut = $("#sell-out");
  const drawSell = () => {
    const q = sellQ.value.trim();
    $("#sell-link").href = soldUrl(q);
    const sold = num(sellSold);
    sellAsks.replaceChildren(...(q && !(sold > 0) ? [h("span", {}, "Put these in the words if they apply, as the price depends on them:"), h("ul", {}, R.sellAsks(q).map((a) => h("li", {}, a)))] : []));
    if (!q || !(sold > 0)) return sellOut.replaceChildren();
    const paid = num(sellPaid);
    const market = { median: sold, n: 0, confidence: "rough", query: q };
    const p = R.sellPrices(market, { title: q, feePct: settings.fee, paid, profit: settings.profit, local: sellLocal.checked || null });
    const keepLine = (x) => (x.keep >= 0 ? `you keep ~${money(x.keep)}` : `a ~${money(-x.keep)} loss`);
    const cellOf = (label, x) => h("div", { class: "mcell" }, h("span", {}, label), h("b", {}, money(x.price)), h("span", {}, keepLine(x)));
    const where = R.sellWhere(q, p.typical, { local: p.local });
    const title = R.sellTitle(q);
    const add = h("button", { type: "button", class: "primary" }, "Add to workbench");
    add.addEventListener("click", () => {
      const was = Object.entries(finds).find(([, r]) => r.t.toLowerCase() === q.toLowerCase());
      const find = { ...(was ? was[1] : {}), t: q, st: "listed", paid: paid ?? was?.[1].paid ?? null, lt: was?.[1].lt || Date.now(), lp: p.listAt.price, fp: p.fast.price, lo: p.floor?.price ?? null, lc: p.local, sold, sa: Date.now(), r: true, a0: was?.[1].a0 || Date.now() };
      edit({ set: { [was ? was[0] : S.newFindKey()]: find } });
      add.textContent = was ? "Updated on the workbench" : "Added, as Listed";
    });
    sellOut.replaceChildren(
      ...[
        h("div", { class: "mgrid" }, cellOf("List at", p.listAt), cellOf("Sell fast", p.fast), p.floor ? cellOf("Your lowest", p.floor) : h("div", { class: "mcell" }, h("span", {}, "Your lowest"), h("span", {}, "Bought it to resell? Type what you paid."))),
        p.under ? h("p", { class: "warn" }, `To keep your ${money(settings.profit)} you'd need ${money(p.floor.price)}, more than it usually sells for.`) : null,
        h("p", { class: "basis" }, `From the ${money(sold)} you typed.${p.basis.replace(/^From [^.]*\./, "")} List at leaves room for offers.`),
        h("p", {}, h("b", {}, "Where: "), where.why),
        h("div", {}, h("b", {}, "Title"), h("code", {}, title), h("button", { type: "button", onclick: (e) => copyText(e.currentTarget, title, "Title copied") }, "Copy the title")),
        h("div", {}, h("b", {}, "Photos and what to say"), h("ul", {}, R.sellTips(q).map((t) => h("li", {}, t)))),
        add,
      ].filter(Boolean)
    );
  };
  for (const el of [sellQ, sellSold, sellPaid]) el.addEventListener("input", drawSell);
  sellLocal.addEventListener("change", drawSell);
  $("#sell-form").addEventListener("submit", (e) => e.preventDefault());

  // ---------- scam signs in pasted listing text ----------
  // The extension's own checks on text you paste: taking the deal off the site (TK.offSite, Craigslist's own rules
  // when ticked), a random code at the end of the title (TK.titleCode, Facebook's bulk scams), and an asking price far
  // under what you typed it sells for, with the reason the listing gives if it gives one (TKRules.cheapReason).
  const paste = $("#paste"), pasteCl = $("#paste-cl"), signs = $("#signs");
  const drawSigns = () => {
    const text = paste.value.trim();
    if (!text) return signs.replaceChildren();
    const cl = pasteCl.checked;
    const title = text.split(/\n/).map((l) => l.trim()).find(Boolean) || "";
    const off = TK.offSite(text, cl ? "craigslist" : undefined);
    const code = cl ? "" : TK.titleCode(title);
    const why = [...(off?.why || [])];
    if (code) why.push(`the title ends with a code (“${code}”), like Facebook's bulk-posted fakes, unless it's the real model number`);
    const ask = num(askEl), sold = num(soldEl);
    // A pickup seller keeps the whole price, so it's compared with what an eBay seller keeps (R.LOCAL_NET).
    if (ask > 0 && sold > 0 && ask < sold * R.LOCAL_NET * R.TOO_CHEAP.low) {
      const said = R.cheapReason(title, text);
      why.push(`the asking price is ${Math.round((ask / sold) * 100)}% of what it sells for${said ? `; it says why (“${said}”), so ask about it` : ", with no reason given"}`);
    }
    const sure = !!off?.sure || (ask > 0 && sold > 0 && ask < sold * R.TOO_CHEAP.far && why.length > 1);
    signs.dataset.v = sure ? "suspicious" : why.length ? "fair" : "great";
    signs.replaceChildren(
      ...[h("p", { class: "head" }, sure ? "Likely a scam" : why.length ? "Check first" : "No scam signs found"),
      why.length ? h("ul", {}, why.map((w) => h("li", {}, w.charAt(0).toUpperCase() + w.slice(1)))) : h("p", {}, "That isn't a promise: still see it working before you pay."),
      sure ? h("p", {}, "Don't pay ahead or move to text or another app. Report the listing in the app.") : null].filter(Boolean)
    );
  };
  paste.addEventListener("input", drawSigns);
  pasteCl.addEventListener("change", drawSigns);

  // ---------- shared into it (Android) ----------
  // Installed on Android, Tirekick shows in the share sheet (manifest share_target): what the app shares arrives as
  // ?title=&text=&url= here. Facebook and eBay share a link with no price, so the link is kept on the next find you
  // add, and any text goes to the scam check. Nothing is opened or fetched.
  let sharedLink = "";
  {
    const sp = new URLSearchParams(location.search);
    const title = (sp.get("title") || "").trim(), text = (sp.get("text") || "").trim();
    const link = ((sp.get("url") || "").trim() || text.match(/https?:\/\/\S+/)?.[0] || "").slice(0, 300);
    if (title || text || link) {
      const words = [title, text.replace(link, "").trim()].filter(Boolean).join("\n");
      if (words) paste.value = words;
      if (title && !qEl.value) qEl.value = title.slice(0, 200);
      if (/^https:\/\//.test(link)) sharedLink = link;
      history.replaceState(null, "", location.pathname);
      $("#shared").textContent = (sharedLink ? "Link kept: it's saved with the next find you add. Type what it sells for and the asking price." : "Shared text is in the scam check below.");
    }
  }

  // ---------- questions for the seller and the safety checklist ----------
  $("#safety").replaceChildren(...R.SAFETY.map((s) => h("li", {}, s)));
  const copyText = async (btn, text, done) => {
    const was = btn.textContent;
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = done;
    } catch {
      btn.textContent = "Couldn't copy: press and hold the text below";
    }
    setTimeout(() => (btn.textContent = was), 1800);
  };
  $("#copy-q").addEventListener("click", (e) => copyText(e.currentTarget, R.sellerQuestions(qEl.value.trim()), "Questions copied"));
  $("#copy-s").addEventListener("click", (e) => copyText(e.currentTarget, R.safetyText(), "Checklist copied"));

  // ---------- your finds ----------
  // Weighing up (with its call against the typical price kept on it), Bought, Listed and Sold, as on Tirekick's page.
  const STATES = [["", "Weighing up"], ["bought", "Bought"], ["listed", "Listed"], ["sold", "Sold"]];
  const STATE_WORD = { bought: "Bought", listed: "Listed", sold: "Sold" };
  const rows = $("#rows");
  const findRow = (k, r) => {
    const fee = settings.fee;
    const st = STATE_WORD[r.st] ? r.st : "";
    const name = r.t.slice(0, 60);
    const f = st ? null : R.flipCall(r.ask ?? null, S.findMarket(r), { title: "", feePct: fee, profit: settings.profit, parts: r.parts || 0 });
    const numIn = (label, v) => h("input", { type: "number", min: "0", step: "any", inputmode: "decimal", value: Number.isFinite(v) ? String(v) : null, "aria-label": `${label} for ${name}` });
    const boxes = { ask: numIn("Asking price", r.ask), paid: numIn("Price paid", r.paid), lp: numIn("Listed at", r.lp), out: numIn("Sold for", r.out), parts: numIn("Parts cost", r.parts) };
    const keep = () => {
      const patch = {};
      for (const [fld, el] of Object.entries(boxes)) if (el.isConnected && num(el) !== (r[fld] ?? null)) patch[fld] = num(el);
      if (Object.keys(patch).length) edit({ patch: { [k]: patch } });
    };
    for (const el of Object.values(boxes)) {
      el.addEventListener("change", keep);
      el.addEventListener("keydown", (e) => e.key === "Enter" && el.blur());
    }
    const stateIn = h("select", { "aria-label": `Where ${name} stands` }, STATES.map(([v, label]) => h("option", { value: v, ...(v === st && { selected: true }) }, label)));
    stateIn.addEventListener("change", () => {
      const to = stateIn.value;
      const when = { bought: { bt: r.bt || Date.now() }, listed: { lt: r.lt || Date.now() }, sold: { bt: r.bt || Date.now(), so: Date.now() } };
      edit({ patch: { [k]: to === "" ? { st: null } : { st: to, paid: r.paid ?? r.ask ?? null, ...when[to] } } });
    });
    const typical = r.sold > 0 ? `sells for ${r.r ? "~" : ""}${money(r.sold)}` : "";
    const made = S.findProfit(r, fee);
    const net = S.findNet(r, fee);
    const costs = r.lc ? " (local pickup, no fees)" : ` after ${fee}% fees${r.ship ? `, ~${money(r.ship)} shipping` : ""}${r.parts ? ` and ${money(r.parts)} parts` : ""}`;
    const line = st === "sold"
      ? made != null ? `${money(Math.abs(made))} ${made >= 0 ? "profit" : "loss"}${costs}` : net != null ? `~${money(net)} to you${costs}` : "Type what it sold for to see what it made."
      : st === "listed"
        ? made != null ? `Should leave ~${money(Math.abs(made))} ${made >= 0 ? "profit" : "loss"} at ${r.lp > 0 ? money(r.lp) : `the typical ${money(r.sold || 0)}`}` : net != null ? `~${money(net)} to you after fees` : "Type the price it's listed at."
        : st === "bought"
          ? made == null ? (r.sold > 0 ? "Type what you paid to see what it should leave." : "No sells-for price kept for it.") : `Should leave ~${money(Math.abs(made))} ${made >= 0 ? "profit" : "loss"}, ${typical}`
          : f ? `${f.maxPay > 0 ? `Pay up to ${money(f.maxPay)}` : `No price leaves ${money(settings.profit)}`} · ${typical}` : "No sells-for price kept for it.";
    let armed = false;
    const remove = h("button", { type: "button", class: "link" }, "Remove");
    remove.addEventListener("click", () => {
      if (armed) return edit({ set: { [k]: null } });
      armed = true;
      remove.textContent = "Tap again to remove";
      setTimeout(() => ((armed = false), remove.isConnected && (remove.textContent = "Remove")), 3000);
    });
    return h(
      "div",
      { class: "find", "data-call": st || f?.call || "" },
      h("div", { class: "top" }, h("span", { class: "call" }, st ? STATE_WORD[st] : f?.call ? f.word : "No price"), h("div", { class: "ft" }, r.t, h("small", {}, line), r.note ? h("span", { class: "nt" }, r.note) : null)),
      h(
        "div",
        { class: "fx" },
        h("label", {}, "Where it stands", stateIn),
        st ? h("label", {}, "Paid $", boxes.paid) : h("label", {}, "Asking $", boxes.ask),
        st === "listed" ? h("label", {}, "Listed at $", boxes.lp) : null,
        st === "sold" ? h("label", {}, "Sold for $", boxes.out) : null,
        h("label", {}, "Parts $", boxes.parts)
      ),
      h("div", { class: "acts" }, st ? h("span") : h("button", { type: "button", class: "link", onclick: (e) => copyText(e.currentTarget, R.sellerQuestions(r.t), "Questions copied") }, "Copy questions"), remove)
    );
  };
  const drawBench = () => {
    const list = Object.entries(finds).sort((a, b) => (b[1].a0 || 0) - (a[1].a0 || 0));
    $("#empty").hidden = !!list.length;
    const t = S.benchTotals(finds, settings.fee);
    const waiting = t.held + t.listed;
    const soldBits = [t.sold > t.own ? `${money(Math.abs(t.profit))} ${t.profit >= 0 ? "profit" : "loss"}` : null, t.own ? `${money(t.got)} after fees from your own things` : null].filter(Boolean);
    $("#sum").textContent = [
      t.sold ? `${t.sold} sold, ${soldBits.join(" and ")}` : null,
      waiting ? `${waiting} not sold yet${t.inHeld ? `, ${money(t.inHeld)} in ${waiting === 1 ? "it" : "them"}` : ""}` : null,
      t.weighing ? `${t.weighing} you're weighing up` : null,
    ].filter(Boolean).join(" · ");
    rows.replaceChildren(...list.map(([k, r]) => findRow(k, r)));
  };
  // A box you're typing in isn't redrawn under you (another tab's change, or a setting): it redraws when you leave.
  addEventListener("storage", (e) => {
    if (e.key !== KEY.finds) return;
    finds = cleanAll(read(KEY.finds));
    if (!rows.contains(document.activeElement)) drawBench();
  });

  // ---------- keep a copy ----------
  // The same file as a backup from Tirekick's settings (app "tirekick", finds), so the computer restores it (merged:
  // what's there wins) and this page opens one from the computer. Only finds: nothing else is kept here.
  function note(text) {
    $("#note").textContent = text;
  }
  $("#export").addEventListener("click", async () => {
    const n = Object.keys(finds).length;
    if (!n) return note("Nothing to save yet.");
    const name = `tirekick-phone-${S.localDay()}.json`;
    const file = new File([JSON.stringify({ app: "tirekick", version: "phone", at: new Date().toISOString(), settings: {}, finds })], name, { type: "application/json" });
    // On a phone the share sheet is the way to put a file somewhere (Files, Drive, a message to yourself).
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name });
        return note(`Copy of ${n} find${n === 1 ? "" : "s"} ready.`);
      } catch (e) {
        if (e?.name === "AbortError") return;
      }
    }
    const a = h("a", { href: URL.createObjectURL(file), download: name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    note(`Saved a copy of ${n} find${n === 1 ? "" : "s"}. Restore it in Tirekick's settings on your computer, or open it here.`);
  });
  $("#import").addEventListener("click", () => $("#import-file").click());
  $("#import-file").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) return note("That file is too big to be a Tirekick backup.");
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      return note("That file isn't a Tirekick backup.");
    }
    if (!["tirekick", "second-look"].includes(data?.app)) return note("That file isn't a Tirekick backup.");
    const got = S.cleanBackup(data).sets.finds || {};
    const before = Object.keys(finds).length;
    edit({ add: got }); // what's here wins where both have it
    const added = Object.keys(finds).length - before;
    note(Object.keys(got).length ? `Added ${added} find${added === 1 ? "" : "s"}${added < Object.keys(got).length ? ` (${Object.keys(got).length - added} were here already)` : ""}.` : "That backup has no finds on the workbench. Saved listings and searches stay on your computer.");
  });

  // ---------- install ----------
  // Installed, it opens like an app and works offline. On iPhone it also keeps the finds safer: Safari can clear a
  // site that isn't on the Home Screen. Android's browsers offer their own Install button.
  const installEl = $("#install");
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const iOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (!standalone && iOS) {
    installEl.textContent = "Add it to your Home Screen (Share, then Add to Home Screen) so it opens like an app and your finds are kept.";
    installEl.hidden = false;
  }
  let prompt = null;
  addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    prompt = e;
    installEl.replaceChildren("Install it so it opens like an app and works offline. ", h("button", { type: "button", onclick: async () => (await prompt.prompt(), (installEl.hidden = true)) }, "Install"));
    installEl.hidden = false;
  });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

  drawCheck();
  drawSell();
  drawSigns();
  drawBench();
})();

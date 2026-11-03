/* Installable app: service worker, install prompt, mobile tab bar. */
(() => {
  if ("serviceWorker" in navigator) addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  document.documentElement.classList.toggle("is-app", standalone);

  // install button (Android/desktop Chrome) or "Add to Home Screen" hint (iPhone)
  let deferred = null;
  const canInstall = () => !standalone && (deferred || ios);
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  function showInstall() {
    if (standalone || document.getElementById("install-bar") || localStorage.getItem("installDismissed") === "1") return;
    if (!deferred && !ios) return;
    const bar = document.createElement("div");
    bar.id = "install-bar"; bar.className = "install-bar"; bar.setAttribute("role", "region"); bar.setAttribute("aria-label", "Install app");
    bar.innerHTML = `<img src="/icon-192.png" alt="" width="36" height="36"><div><b>Get the David Trading app</b><small>${deferred ? "Free, opens full screen from your home screen." : 'Tap <span class="ios-share" aria-label="Share">⎋</span> Share, then <b>Add to Home Screen</b>.'}</small></div>
      ${deferred ? '<button class="btn-primary" id="install-go">Install</button>' : ""}<button class="install-x" id="install-x" aria-label="Dismiss">×</button>`;
    document.body.append(bar);
    document.getElementById("install-x").onclick = () => { localStorage.setItem("installDismissed", "1"); bar.remove(); };
    const go = document.getElementById("install-go");
    if (go) go.onclick = async () => { deferred.prompt(); await deferred.userChoice; deferred = null; bar.remove(); };
  }
  addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; showInstall(); });
  addEventListener("appinstalled", () => { const b = document.getElementById("install-bar"); if (b) b.remove(); });
  if (ios && matchMedia("(max-width: 760px)").matches) setTimeout(showInstall, 4000);

  // keep layout heights in sync with the (wrapping) top bar on phones
  const top = document.querySelector(".topbar");
  if (top) new ResizeObserver(() => document.documentElement.style.setProperty("--toph", top.offsetHeight + "px")).observe(top);

  // mobile tab bar (main page only)
  const tabbar = document.getElementById("tabbar");
  const mobile = matchMedia("(max-width: 760px)");
  const PANEL = { markets: ".watchlist", chart: ".chart-area", david: ".david" };
  function setTab(t) {
    if (t === "portfolio") { document.getElementById("acct-btn").click(); return; }
    document.body.dataset.tab = t;
    tabbar.querySelectorAll("[data-tab]").forEach((b) => {
      b.classList.toggle("active", b.dataset.tab === t);
      if (b.dataset.tab === t) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    if (mobile.matches) scrollTo(0, 0);
    else if (PANEL[t]) document.querySelector(PANEL[t]).scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  function go(t) {
    if (!tabbar) { location.href = "/?tab=" + t; return; }
    setTab(t);
    if (t === "david" && !mobile.matches) document.getElementById("chat-input").focus();
  }

  // ☰ menu (top left on every page)
  const top0 = document.querySelector(".topbar");
  if (top0) {
    const btn = document.createElement("button");
    btn.className = "menu-btn"; btn.id = "menu-btn"; btn.type = "button";
    btn.setAttribute("aria-label", "Open menu"); btn.setAttribute("aria-expanded", "false"); btn.setAttribute("aria-controls", "drawer");
    btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
    top0.prepend(btn);
    const bg = document.createElement("div"); bg.className = "drawer-bg"; bg.hidden = true;
    const dr = document.createElement("div");
    dr.id = "drawer"; dr.className = "drawer"; dr.hidden = true;
    dr.setAttribute("role", "dialog"); dr.setAttribute("aria-modal", "true"); dr.setAttribute("aria-label", "Menu");
    document.body.append(bg, dr);
    const I = {
      markets: '<path d="M4 6h16M4 12h16M4 18h10"/>', chart: '<path d="M3 17l6-6 4 4 8-8"/>',
      david: '<path d="M4 5h16v11H9l-5 4z"/>', portfolio: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5h8v2"/>',
      autopilot: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>', login: '<path d="M15 4h4v16h-4M10 8l4 4-4 4M14 12H3"/>',
      logout: '<path d="M9 4H5v16h4M14 8l4 4-4 4M18 12H8"/>', install: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    };
    const ic = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${I[k]}</svg>`;
    let user = null;
    function render() {
      const here = location.pathname.startsWith("/david") ? "autopilot" : tabbar ? document.body.dataset.tab : "";
      const item = (k, label, sub, attrs) => `<li><${attrs.href ? "a" : "button type=\"button\""} class="dr-item${here === k ? " current" : ""}" ${attrs.href ? `href="${attrs.href}"` : `data-go="${k}"`}${here === k ? ' aria-current="page"' : ""}>${ic(k)}<span>${label}${sub ? `<small>${sub}</small>` : ""}</span></${attrs.href ? "a" : "button"}></li>`;
      const next = encodeURIComponent(location.pathname + location.search);
      dr.innerHTML = `<div class="dr-head"><span class="brand"><svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#2962ff"/><path d="M6 22l6-7 5 4 9-11" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg><span>David<b>Trading</b></span></span>
        <button type="button" class="dr-close" id="dr-close" aria-label="Close menu">×</button></div>
        <div class="dr-user${user ? " in" : ""}">${user ? `<span class="dr-av" aria-hidden="true">${user.email[0].toUpperCase()}</span><span><small>Logged in as</small><b>${user.email.replace(/[<>&"]/g, "")}</b></span>`
          : `<a class="btn-primary dr-login" href="/login.html?next=${next}">${ic("login")}Log in / Sign up</a><small>Save your demo money and use David Autopilot on any device.</small>`}</div>
        <ul class="dr-list">
          ${item("david", "Chat with David", "Ask about any stock", {})}
          ${item("autopilot", "David Autopilot", !user ? "Log in required" : user.owner ? "Let David invest your demo money" : "Owner only · password needed", { href: "/david" })}
          ${item("portfolio", "My portfolio", "Demo money, positions, trades", {})}
          ${item("chart", "Chart", "", {})}
          ${item("markets", "Markets & watchlist", "", {})}
          ${canInstall() ? `<li><button type="button" class="dr-item" data-go="install">${ic("install")}<span>Install the app<small>Opens full screen from your home screen</small></span></button></li>` : ""}
          ${user ? `<li><button type="button" class="dr-item" data-go="logout">${ic("logout")}<span>Log out</span></button></li>` : ""}
        </ul>
        <p class="dr-foot">Play money only. Not financial advice.</p>`;
    }
    function open() {
      render(); bg.hidden = dr.hidden = false;
      requestAnimationFrame(() => document.body.classList.add("drawer-open"));
      btn.setAttribute("aria-expanded", "true");
      document.getElementById("dr-close").focus();
    }
    function close(focusBtn = true) {
      document.body.classList.remove("drawer-open"); btn.setAttribute("aria-expanded", "false");
      bg.hidden = dr.hidden = true;
      if (focusBtn) btn.focus(); else document.activeElement.blur();
    }
    btn.addEventListener("click", open);
    bg.addEventListener("click", () => close());
    dr.addEventListener("keydown", (e) => {
      if (e.key === "Escape") return close();
      if (e.key !== "Tab") return;
      const f = [...dr.querySelectorAll("a,button")], first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    dr.addEventListener("click", async (e) => {
      if (e.target.closest("#dr-close")) return close();
      const b = e.target.closest("[data-go]");
      if (!b) return;
      const k = b.dataset.go;
      close(false);
      if (k === "install") {
        if (deferred) { deferred.prompt(); await deferred.userChoice; deferred = null; }
        else { localStorage.removeItem("installDismissed"); showInstall(); }
      } else if (k === "logout") {
        await fetch("/api/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        localStorage.removeItem("davidDemoBroker"); localStorage.removeItem("davidAutopilot");
        location.href = "/";
      } else go(k);
    });
    fetch("/api/me").then((r) => r.json()).then((m) => { user = m.user && { ...m.user, owner: m.owner }; }).catch(() => {});
  }

  if (!tabbar) return;
  tabbar.addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) setTab(b.dataset.tab); });
  // picking a stock anywhere jumps to its chart
  document.addEventListener("click", (e) => {
    if (mobile.matches && e.target.closest("#watchlist li, #search-results li, #tape .tick, #spx, .hb-item")) setTimeout(() => setTab("chart"), 0);
  });
  // David tab shows the current verdict colour
  new MutationObserver(() => {
    const badge = document.querySelector("#verdict .badge"), dot = document.getElementById("tab-verdict");
    dot.className = "tab-dot " + (badge ? [...badge.classList].find((c) => c.startsWith("b-")) || "" : "");
  }).observe(document.getElementById("verdict"), { childList: true });
  const startTab = new URLSearchParams(location.search).get("tab") || "chart";
  setTab(startTab === "portfolio" ? "chart" : startTab);
  if (startTab === "portfolio") setTimeout(() => setTab("portfolio"), 300);
})();

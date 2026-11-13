// Bottom status bar: LLM subscription usage, like Orca's bottom line. One item
// per signed-in service — Claude (keychain/credentials file), Codex (~/.codex),
// GLM Coding Plan (opencodex or ZCode CLI store), Antigravity (agy CLI `/usage`,
// one item per model group: Gemini models and Claude/GPT models) — each showing
// the worst window's percent and the time left before it resets. A service with no
// usable sign-in shows nothing, so the bar stays quiet. Usage data only:
// tokens are read per fetch and never logged. Fetch method per provider is
// the one Orca uses (api.anthropic.com/api/oauth/usage, chatgpt.com
// /backend-api/wham/usage, api.z.ai /api/monitor/usage/quota/limit). A leading
// `Host` row shows the local machine's load — CPU, disk, memory and swap,
// percentages only — refreshed every minute.
import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { exec, theme } from "herdr";

const READ = 15_000; // one usage fetch round-trip at most
const EVERY = 5 * 60_000; // usage changes slowly; poll it here
const TICK = 60_000; // the countdown text is minute-grained

// "(d h|m) left", Orca-style: hours under a day, minutes under an hour.
function left(ms) {
  if (!Number.isFinite(ms)) return "";
  const mins = Math.round((ms - Date.now()) / 60_000);
  if (mins <= 0) return "";
  const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function pick(windows) {
  // The window closest to exhausted is the one that will interrupt you.
  const ok = windows.filter((w) => w && Number.isFinite(w.pct));
  if (ok.length === 0) return null;
  return ok.reduce((a, b) => (b.pct > a.pct ? b : a));
}

function jsonOf(stdout) {
  if (typeof stdout !== "string") return null;
  const start = stdout.indexOf("{");
  if (start < 0) return null;
  try { return JSON.parse(stdout.slice(start)); } catch { return null; }
}

function semverAtLeast(v, min) {
  const a = v.split(".").map(Number), b = min.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  return true;
}

async function readJson(cx, path) {
  const r = await exec("sh", ["-c", `cat "${path}" 2>/dev/null || true`]).catch(() => null);
  if (!r || r.code !== 0) return null;
  return jsonOf(r.stdout);
}

async function fetchJson(url, headers) {
  const r = await fetch(url, { headers: { ...headers, Accept: "application/json" } });
  if (!r.ok) return null;
  return /** @type {any} */ (await r.json());
}

// Claude Code keeps its OAuth token in the login keychain; the credentials
// file is the non-macOS fallback. Reading the keychain may ask once — allow
// it and the item stays.
async function claude() {
  const r = await exec("sh", ["-c",
    "security find-generic-password -s 'Claude Code-credentials' -w 2>/dev/null || cat \"$HOME/.claude/.credentials.json\" 2>/dev/null || true",
  ]).catch(() => null);
  const token = jsonOf(r?.stdout)?.claudeAiOauth?.accessToken;
  if (!token) return null;
  const d = await fetchJson("https://api.anthropic.com/api/oauth/usage", {
    Authorization: `Bearer ${token}`,
    "anthropic-beta": "oauth-2025-04-20",
    "User-Agent": "claude-code/2.1.0",
  });
  const w = pick([
    d?.five_hour && { pct: d.five_hour.used_percentage, at: Date.parse(d.five_hour.resets_at) },
    d?.seven_day && { pct: d.seven_day.used_percentage, at: Date.parse(d.seven_day.resets_at) },
  ]);
  return w ? { name: "Claude", pct: w.pct, resetsAt: w.at } : null;
}

async function codex() {
  const auth = await readJson(null, "$HOME/.codex/auth.json");
  const tok = auth?.tokens?.access_token, acct = auth?.tokens?.account_id;
  if (!tok || !acct) return null;
  const d = await fetchJson("https://chatgpt.com/backend-api/wham/usage", {
    Authorization: `Bearer ${tok}`,
    "chatgpt-account-id": acct,
  });
  const wins = [d?.rate_limit?.primary_window, d?.rate_limit?.secondary_window]
    .map((w) => (Number.isFinite(w?.used_percent) ? { pct: w.used_percent, at: Number.isFinite(w.reset_at) ? w.reset_at * 1000 : NaN } : null));
  const w = pick(wins);
  return w ? { name: `Codex${d?.plan_type ? ` ${d.plan_type}` : ""}`, pct: w.pct, resetsAt: w.at } : null;
}

// GLM Coding Plan: the provisioned z.ai/org API key, from the opencodex
// credential store first, the ZCode CLI config second. Sites: z.ai or
// BigModel; both answer /api/monitor/usage/quota/limit.
async function glm() {
  const ocx = await readJson(null, "$HOME/.opencodex/auth.json");
  const accounts = ocx?.["glm-zcode"]?.accounts;
  const active = ocx?.["glm-zcode"]?.activeAccountId;
  const cred = accounts?.find((a) => a.id === active)?.credential ?? accounts?.[0]?.credential;
  let key = typeof cred?.access === "string" ? cred.access.trim() : "";
  let origin = "https://api.z.ai";
  if (!key) {
    const cfg = await readJson(null, "$HOME/.zcode/cli/config.json");
    const opts = cfg?.provider?.[cfg?.main?.split("/")[0]]?.options ?? Object.values(cfg?.provider ?? {})[0]?.options;
    if (typeof opts?.apiKey === "string" && opts.apiKey.trim()) key = opts.apiKey.trim();
    if (typeof opts?.baseURL === "string" && opts.baseURL.startsWith("https://")) {
      const host = opts.baseURL.match(/^https:\/\/[^/]+/);
      if (host) origin = host[0];
    }
  }
  if (!key) return null;
  const d = await fetchJson(`${origin}/api/monitor/usage/quota/limit`, { Authorization: `Bearer ${key}` });
  const limits = Array.isArray(d?.data?.limits) ? d.data.limits : [];
  const w = pick(limits.map((l) => ({ pct: l?.percentage, at: Number.isFinite(l?.nextResetTime) ? l.nextResetTime : NaN })));
  const level = typeof d?.data?.level === "string" ? d.data.level : "";
  return w ? { name: `GLM${level ? ` ${level}` : ""}`, pct: w.pct, resetsAt: w.at } : null;
}

// Antigravity (agy CLI): `agy -p /usage --output-format json` is a local command
// (no quota spent) reporting per-group limits — Gemini Models (Gemini/Argon) and
// Claude and GPT models (Opus/Sonnet/GPT-OSS) — each with weekly and 5-hour
// windows. Same method Orca uses. The version gate is required: agy < 1.1.11
// answers /usage as a prompt and spends quota, so bail out on older CLIs.
const AGY_SH = 'export AGY_CLI_DISABLE_AUTO_UPDATE=true; A="$(command -v agy || echo "$HOME/.local/bin/agy")"; exec "$A"';
async function antigravity() {
  const vr = await exec("sh", ["-c", `${AGY_SH} --version < /dev/null`]).catch(() => null);
  const ver = String(vr?.stdout || "").trim().match(/\d+\.\d+\.\d+/)?.[0];
  if (!ver || !semverAtLeast(ver, "1.1.11")) return [];
  const r = await exec("sh", ["-c", `${AGY_SH} -p '/usage' --output-format json --print-timeout 12s < /dev/null`]).catch(() => null);
  const d = jsonOf(r?.stdout);
  const groups = d?.command?.data?.groups;
  if (!Array.isArray(groups)) return [];
  const out = [];
  for (const g of groups) {
    const w = pick((g.buckets ?? []).map((b) => ({
      pct: (1 - b.remaining_fraction) * 100,
      at: Date.parse(b.reset_time),
    })));
    if (!w) continue;
    out.push({
      name: /gemini/i.test(g.name) ? "Antigravity Gemini" : "Antigravity Claude·GPT",
      pct: w.pct,
      resetsAt: w.at,
    });
  }
  return out;
}

// Local host load: CPU (user+sys from one `top` sample),
// disk (APFS Data volume — the one that fills up), memory (actual use:
// app+wired+compressed over total RAM — Activity-Monitor basis, cached files
// excluded) and swap (used/total percent plus total size).
// One cheap sh call, so it refreshes every minute instead of every five.
const HOST_SH = "top -l 1 -n 0 2>/dev/null | grep -E '^(CPU usage|PhysMem)'; vm_stat 2>/dev/null | grep -E 'page size of|^Pages (active|inactive|wired down)|^Pages occupied by compressor|^File-backed pages'; df -k /System/Volumes/Data 2>/dev/null | awk 'NR==2{print \"DISK \"$5}'; sysctl -n hw.memsize 2>/dev/null; sysctl -n vm.swapusage 2>/dev/null";
function toMB(v, u) { return v * { K: 1 / 1024, M: 1, G: 1024, T: 1024 * 1024 }[u]; }
async function host() {
  const r = await exec("sh", ["-c", HOST_SH]).catch(() => null);
  const s = String(r?.stdout || "");
  const cpu = s.match(/CPU usage:\s*([\d.]+)% user,\s*([\d.]+)% sys/);
  const disk = s.match(/DISK (\d+)%/);
  const mem = s.match(/PhysMem:\s*([\d.]+)([KMGT]) used .*,\s*([\d.]+)([KMGT]) unused/);
  const sw = s.match(/total = ([\d.]+)([KMGT])\s+used = ([\d.]+)([KMGT])/);
  const out = {};
  if (cpu) out.cpu = Number(cpu[1]) + Number(cpu[2]);
  if (disk) out.disk = Number(disk[1]);
  if (s.includes("Pages active")) {
    // Memory, Activity-Monitor style: app(anonymous ≈ active+inactive−file-
    // backed) + wired + compressed over total physical RAM — cached-file pages
    // don't count as in use. Falls back to the top occupancy ratio when
    // vm_stat fields are unavailable.
    const pg = (re) => Number((s.match(re) || [])[1]);
    const ps = pg(/page size of (\d+) bytes/);
    const act = pg(/^Pages active:\s+(\d+)/m);
    const inact = pg(/^Pages inactive:\s+(\d+)/m);
    const wiredP = pg(/^Pages wired down:\s+(\d+)/m);
    const comp = pg(/^Pages occupied by compressor:\s+(\d+)/m);
    const fileB = pg(/^File-backed pages:\s+(\d+)/m);
    const totalB = pg(/^(\d{9,})$/m);
    const anon = act + inact - fileB;
    if (Number.isFinite(ps) && totalB > 0 && [act, inact, wiredP, comp, fileB].every(Number.isFinite) && anon > 0) {
      out.mem = Math.min(100, (anon + wiredP + comp) * ps / totalB * 100);
    } else if (mem) {
      const used = toMB(Number(mem[1]), mem[2]), free = toMB(Number(mem[3]), mem[4]);
      if (used + free > 0) out.mem = (used / (used + free)) * 100;
    }
  }
  if (sw) {
    const tot = toMB(Number(sw[1]), sw[2]);
    if (tot > 0) {
      out.swap = (toMB(Number(sw[3]), sw[4]) / tot) * 100;
      out.swapTotalMB = tot;
    }
  }
  return Object.keys(out).length ? out : null;
}

function pctColor(pct, t) {
  return pct >= 95 ? t.blocked : pct >= 75 ? t.working : t.foreground;
}

function itemRow(it) {
  const t = /** @type {any} */ (theme());
  const pct = Math.round(it.pct);
  const left_ = left(it.resetsAt);
  return h_flex().flex_none().gap(6).items_center().text_size(12)
    .child(div().text_color(t.dim).child(it.name))
    .child(div().font_semibold().text_color(pctColor(pct, t)).child(`${pct}%`))
    .child(div().text_color(t.dim).child(left_ ? `— ${left_} 후 초기화` : "—"));
}

function hostRow(h) {
  const t = /** @type {any} */ (theme());
  const seg = (label, pct, suffix) => {
    const row = h_flex().flex_none().gap(4).items_center()
      .child(div().text_color(t.dim).child(label))
      .child(div().font_semibold().text_color(pctColor(pct, t)).child(`${Math.round(pct)}%`));
    return suffix ? row.child(div().text_color(t.dim).child(suffix)) : row;
  };
  const parts = [];
  if (Number.isFinite(h.cpu)) parts.push(seg("CPU", h.cpu));
  if (Number.isFinite(h.disk)) parts.push(seg("디스크", h.disk));
  if (Number.isFinite(h.mem)) parts.push(seg("메모리", h.mem));
  if (Number.isFinite(h.swap)) parts.push(seg("스왑", h.swap,
    Number.isFinite(h.swapTotalMB) ? `(${(h.swapTotalMB / 1024).toFixed(1)}G)` : null));
  return h_flex().flex_none().gap(6).items_center().text_size(12)
    .child(div().text_color(t.dim).child("Host"))
    .children(parts.flatMap((p, i) => (i ? [div().text_color(t.dim).child("·"), p] : [p])));
}

export default class extends View {
  async init(_props, cx) {
    this.items = [];
    this.first = true;
    this.host = null;
    cx.spawn(async (cx) => {
      for (;;) {
        const h = await Promise.race([
          host(),
          new Promise((res) => cx.timer.after(READ, () => res(null))),
        ]);
        if (h) { this.host = h; cx.notify(); }
        await new Promise((res) => cx.timer.after(60_000, () => res()));
      }
    });
    cx.spawn(async (cx) => {
      for (;;) {
        // Apply whenever the round settles — a hung read (e.g. the keychain
        // asking once for permission) must not discard the other results.
        const work = Promise.allSettled([claude(), codex(), glm(), antigravity()]);
        work.then((all) => {
          this.items = all.flatMap((r) => {
            if (r.status !== "fulfilled" || !r.value) return [];
            return Array.isArray(r.value) ? r.value : [r.value];
          });
          this.first = false;
          cx.notify();
        }).catch(() => {});
        const beat = new Promise((res) => cx.timer.after(READ, () => res(null)));
        await Promise.race([work, beat]);
        await new Promise((res) => cx.timer.after(EVERY, () => res()));
      }
    });
    cx.timer.every(TICK, (cx) => cx.notify());
  }

  render() {
    const t = /** @type {any} */ (theme());
    const items = this.items ?? [];
    return h_flex().id("status-root").size_full().px(8).gap(12).items_center()
      .bg(t.chrome)
      .border_1().border_color(t.border)
      .when(this.host, (el) => el.child(hostRow(this.host)))
      .when(items.length === 0, (el) => el.child(div().text_size(12).text_color(this.first ? t.accent : t.dim)
        .child(this.first ? "usage: first refresh…" : "usage: no subscription found")))
      .children(items.map(itemRow));
  }
}

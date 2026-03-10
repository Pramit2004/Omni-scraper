import { useState, useEffect, useRef, useCallback } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// OMNI-SCRAPER — Terminal Interface
// Aesthetic: Cyberpunk terminal / NASA mission control hybrid
// Font: JetBrains Mono + Syne display
// ─────────────────────────────────────────────────────────────────────────────

// ── Auto-detect Codespaces vs local ──────────────────────────────────────────
// Codespaces hostname format: {name}-{port}.app.github.dev
// e.g. friendly-journey-4j67v647wj5cjprp-5173.app.github.dev
// We replace the LAST -PORT segment before .app.github.dev with -8000
const swapPort = (host, newPort) => {
  // Replace the last hyphen-separated port number before .app.github.dev
  return host.replace(/(-\d+)(\.app\.github\.dev)$/, `-${newPort}$2`);
};
const getAPIBase = () => {
  const host = window.location.hostname;
  if (host.includes(".app.github.dev")) {
    return `https://${swapPort(host, 8000)}`;
  }
  return "http://localhost:8000";
};
const getWSBase = () => {
  const host = window.location.hostname;
  if (host.includes(".app.github.dev")) {
    return `wss://${swapPort(host, 8000)}`;
  }
  return "ws://localhost:8000";
};
const API = getAPIBase();
const WS  = getWSBase();

const PROVIDERS = [
  { id: "claude",  label: "Claude 3.5 Sonnet",       tag: "CLOSED",  color: "#FF6B35", model: "claude-sonnet-4-5",          vendor: "Anthropic" },
  { id: "openai",  label: "GPT-4o",                  tag: "CLOSED",  color: "#10A37F", model: "gpt-4o",                     vendor: "OpenAI" },
  { id: "kimi",    label: "Kimi K2.5",                tag: "OPEN",    color: "#7C6CF8", model: "moonshotai/kimi-k2.5",       vendor: "Moonshot" },
  { id: "qwen",    label: "Qwen 3.5 397B",            tag: "OPEN",    color: "#F59E0B", model: "qwen/qwen3.5-397b-a17b",    vendor: "Alibaba" },
];

const EXPORT_FMTS = [
  { id: "json", label: "JSON",      icon: "{ }" },
  { id: "csv",  label: "CSV",       icon: "," },
  { id: "tsv",  label: "TSV",       icon: "⇥" },
];

// ── Spinner frames ────────────────────────────────────────────────────────────
const SPINNER = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"];

function useSpinner() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setFrame(f => (f + 1) % SPINNER.length), 80);
    return () => clearInterval(t);
  }, []);
  return SPINNER[frame];
}

// ── Blink hook ────────────────────────────────────────────────────────────────
function useBlink(ms = 600) {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const t = setInterval(() => setOn(v => !v), ms);
    return () => clearInterval(t);
  }, [ms]);
  return on;
}

// ── Format event for display ──────────────────────────────────────────────────
function eventLabel(ev) {
  switch (ev.type) {
    case "job_start":     return `INIT → Target: ${ev.url}`;
    case "navigate":      return `NAVIGATE → ${ev.url}`;
    case "perceive":      return `PERCEIVE → DOM parsed + screenshot captured`;
    case "reason":        return `REASON[${ev.action?.toUpperCase()}] → ${ev.reasoning?.slice(0,80) || "Deciding next action"}`;
    case "act":           return `ACT[${ev.action?.toUpperCase()}] → ${ev.target?.slice(0,60) || ""}`;
    case "extract":       return `EXTRACT → ${ev.records ?? 0} record(s) collected`;
    case "ratelimit":     return `RATE_LIMIT → Cooling down ${ev.delay_s}s (AIMD)`;
    case "job_complete":  return `MISSION COMPLETE → ${ev.records} records in ${ev.steps} steps`;
    case "job_error":     return `FATAL ERROR → ${ev.error?.slice(0,100)}`;
    default:              return JSON.stringify(ev).slice(0,100);
  }
}

function eventStatus(ev) {
  if (ev.type === "job_complete")  return "done";
  if (ev.type === "job_error")     return "error";
  if (ev.type === "act" && ev.success === false) return "error";
  if (ev.type === "ratelimit")     return "warn";
  return "ok";
}

// ── Log Line ──────────────────────────────────────────────────────────────────
function LogLine({ ev, isLast }) {
  const spinner   = useSpinner();
  const blink     = useBlink(400);
  const status    = eventStatus(ev);
  const isRunning = isLast && status === "ok" && ev.type !== "job_complete";

  const icon = isRunning
    ? <span style={{ color: "#00D4FF", fontWeight: 700 }}>{spinner}</span>
    : status === "done"
      ? <span style={{ color: "#00FF88" }}>✓</span>
      : status === "error"
        ? <span style={{ color: "#FF3D5A" }}>✗</span>
        : status === "warn"
          ? <span style={{ color: "#F59E0B" }}>⚠</span>
          : <span style={{ color: "#00FF88" }}>✓</span>;

  const textColor = status === "error" ? "#FF6B6B"
    : status === "warn"  ? "#F59E0B"
    : status === "done"  ? "#00FF88"
    : "#C8D6E5";

  const ts = ev.timestamp
    ? new Date(ev.timestamp).toISOString().split("T")[1].slice(0,12)
    : "";

  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 12,
      padding: "5px 0",
      borderBottom: "1px solid rgba(255,255,255,0.03)",
      animation: "fadeIn 0.2s ease",
    }}>
      {/* Timestamp */}
      <span style={{ color: "#3D5A6E", fontSize: 11, fontFamily: "JetBrains Mono, monospace", minWidth: 90, marginTop: 1 }}>
        {ts}
      </span>
      {/* Icon */}
      <span style={{ fontSize: 14, minWidth: 16, textAlign: "center", marginTop: 1 }}>
        {icon}
      </span>
      {/* Tag */}
      <span style={{
        fontSize: 10, fontFamily: "JetBrains Mono, monospace",
        color: "#0A0E1A", background: tagColor(ev.type),
        padding: "1px 6px", borderRadius: 3, fontWeight: 700,
        minWidth: 80, textAlign: "center", marginTop: 2, lineHeight: "16px",
      }}>
        {ev.type?.toUpperCase().slice(0,8)}
      </span>
      {/* Message */}
      <span style={{ color: textColor, fontSize: 12.5, fontFamily: "JetBrains Mono, monospace", lineHeight: 1.6, flex: 1 }}>
        {eventLabel(ev)}
        {isRunning && <span style={{ opacity: blink ? 1 : 0, color: "#00D4FF" }}>█</span>}
      </span>
      {/* Latency */}
      {ev.ms && (
        <span style={{ color: "#3D5A6E", fontSize: 10, fontFamily: "JetBrains Mono, monospace", minWidth: 48, textAlign: "right", marginTop: 2 }}>
          {ev.ms}ms
        </span>
      )}
    </div>
  );
}

function tagColor(type) {
  const map = {
    job_start: "#00D4FF", navigate: "#7C6CF8", perceive: "#10A37F",
    reason: "#F59E0B", act: "#FF6B35", extract: "#00FF88",
    ratelimit: "#F59E0B", job_complete: "#00FF88", job_error: "#FF3D5A",
  };
  return map[type] || "#3D5A6E";
}

// ── Provider Card ──────────────────────────────────────────────────────────────
function ProviderCard({ p, selected, onSelect }) {
  return (
    <button onClick={() => onSelect(p.id)} style={{
      background: selected ? `${p.color}18` : "transparent",
      border: `1px solid ${selected ? p.color : "#1A2535"}`,
      borderRadius: 8, padding: "10px 14px", cursor: "pointer",
      display: "flex", flexDirection: "column", gap: 4, textAlign: "left",
      transition: "all 0.15s ease",
      flex: 1, minWidth: 160,
      boxShadow: selected ? `0 0 16px ${p.color}30` : "none",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ color: selected ? p.color : "#8899AA", fontSize: 13, fontWeight: 700, fontFamily: "JetBrains Mono, monospace" }}>
          {p.vendor}
        </span>
        <span style={{
          fontSize: 9, fontFamily: "JetBrains Mono, monospace", fontWeight: 700,
          background: p.tag === "OPEN" ? "#7C6CF820" : "#FF6B3520",
          color: p.tag === "OPEN" ? "#7C6CF8" : "#FF6B35",
          padding: "1px 6px", borderRadius: 3,
        }}>
          {p.tag}
        </span>
      </div>
      <span style={{ color: selected ? "#E2EAF4" : "#4A6278", fontSize: 11.5, fontFamily: "JetBrains Mono, monospace" }}>
        {p.label}
      </span>
      <span style={{ color: "#3D5A6E", fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}>
        {p.model}
      </span>
    </button>
  );
}

// ── Export Bar ─────────────────────────────────────────────────────────────────
function ExportBar({ jobId, records, selectedFmt, onFmtChange }) {
  const [downloading, setDownloading] = useState(null);

  const download = async (fmt) => {
    setDownloading(fmt);
    try {
      const res = await fetch(`${API}/api/jobs/${jobId}/export?fmt=${fmt}`);
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href = url; a.download = `omni_${jobId}.${fmt}`; a.click();
      URL.revokeObjectURL(url);
    } catch {}
    setDownloading(null);
  };

  return (
    <div style={{
      background: "#070C15", border: "1px solid #1A2535", borderRadius: 10,
      padding: "16px 20px",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <span style={{ color: "#8899AA", fontSize: 11, fontFamily: "JetBrains Mono, monospace", letterSpacing: 2 }}>
          EXPORT DATA — {records} RECORDS
        </span>
        <span style={{ color: "#00FF88", fontSize: 11, fontFamily: "JetBrains Mono, monospace" }}>
          ● READY
        </span>
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        {EXPORT_FMTS.map(f => (
          <button key={f.id} onClick={() => download(f.id)} style={{
            flex: 1, background: downloading === f.id ? "#00FF8820" : "#0A1525",
            border: `1px solid ${downloading === f.id ? "#00FF88" : "#1A2535"}`,
            borderRadius: 8, padding: "12px 8px", cursor: "pointer",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
            transition: "all 0.15s",
          }}>
            <span style={{ fontSize: 18, color: downloading === f.id ? "#00FF88" : "#3D5A6E" }}>
              {f.icon}
            </span>
            <span style={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace",
              color: downloading === f.id ? "#00FF88" : "#8899AA", fontWeight: 700 }}>
              {downloading === f.id ? "DOWNLOADING..." : `↓ ${f.label}`}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── AIMD Gauge ─────────────────────────────────────────────────────────────────
function AIMDGauge({ metrics }) {
  if (!metrics) return null;
  const errorPct = Math.round((metrics.error_rate || 0) * 100);
  const stateColors = { cruising: "#00FF88", probing: "#00D4FF", backing: "#F59E0B", paused: "#FF3D5A" };
  const col = stateColors[metrics.state] || "#8899AA";

  return (
    <div style={{
      background: "#070C15", border: "1px solid #1A2535", borderRadius: 10,
      padding: "14px 18px", display: "flex", gap: 20,
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ color: "#3D5A6E", fontSize: 10, fontFamily: "JetBrains Mono, monospace", marginBottom: 4, letterSpacing: 1 }}>AIMD STATE</div>
        <div style={{ color: col, fontSize: 13, fontFamily: "JetBrains Mono, monospace", fontWeight: 700 }}>
          ● {metrics.state?.toUpperCase()}
        </div>
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ color: "#3D5A6E", fontSize: 10, fontFamily: "JetBrains Mono, monospace", marginBottom: 4, letterSpacing: 1 }}>CONCURRENCY</div>
        <div style={{ color: "#00D4FF", fontSize: 13, fontFamily: "JetBrains Mono, monospace", fontWeight: 700 }}>
          {metrics.concurrency ?? 1}× workers
        </div>
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ color: "#3D5A6E", fontSize: 10, fontFamily: "JetBrains Mono, monospace", marginBottom: 4, letterSpacing: 1 }}>DELAY</div>
        <div style={{ color: "#F59E0B", fontSize: 13, fontFamily: "JetBrains Mono, monospace", fontWeight: 700 }}>
          {metrics.delay_ms ?? 2000}ms
        </div>
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ color: "#3D5A6E", fontSize: 10, fontFamily: "JetBrains Mono, monospace", marginBottom: 4, letterSpacing: 1 }}>ERROR RATE</div>
        <div style={{ color: errorPct > 5 ? "#FF3D5A" : "#00FF88", fontSize: 13, fontFamily: "JetBrains Mono, monospace", fontWeight: 700 }}>
          {errorPct}%
        </div>
      </div>
    </div>
  );
}

// ── Main App ───────────────────────────────────────────────────────────────────
export default function App() {
  const [url,        setUrl]        = useState("https://books.toscrape.com");
  const [goal,       setGoal]       = useState("Extract all book titles and prices from this page");
  const [provider,   setProvider]   = useState("claude");
  const [exportFmt,  setExportFmt]  = useState("json");
  const [maxSteps,   setMaxSteps]   = useState(25);

  const [jobId,      setJobId]      = useState(null);
  const [status,     setStatus]     = useState("idle");  // idle | running | done | error
  const [events,     setEvents]     = useState([]);
  const [records,    setRecords]    = useState(0);
  const [steps,      setSteps]      = useState(0);
  const [aimdMeta,   setAimdMeta]   = useState(null);
  const [error,      setError]      = useState(null);

  const logRef  = useRef(null);
  const wsRef   = useRef(null);
  const blink   = useBlink(500);
  const spinner = useSpinner();

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [events]);

  // WebSocket connection
  const connectWS = useCallback((jid) => {
    if (wsRef.current) wsRef.current.close();
    const ws = new WebSocket(`${WS}/ws/${jid}`);
    wsRef.current = ws;

    ws.onmessage = (msg) => {
      const ev = JSON.parse(msg.data);
      setEvents(prev => [...prev, ev]);

      if (ev.type === "extract")      setRecords(ev.records ?? 0);
      if (ev.type === "act")          setSteps(s => s + 1);
      if (ev.type === "job_complete") { setStatus("done");  setRecords(ev.records); }
      if (ev.type === "job_error")    { setStatus("error"); setError(ev.error); }
    };

    // Poll AIMD metrics
    const poll = setInterval(async () => {
      try {
        const r = await fetch(`${API}/api/metrics`);
        const d = await r.json();
        if (d.domains?.[0]) setAimdMeta(d.domains[0]);
      } catch {}
    }, 2000);

    ws.onclose = () => clearInterval(poll);
    return () => { ws.close(); clearInterval(poll); };
  }, []);

  const handleStart = async () => {
    setEvents([]);
    setRecords(0);
    setSteps(0);
    setStatus("running");
    setError(null);
    setAimdMeta(null);

    try {
      const res = await fetch(`${API}/api/scrape`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url, goal, llm_provider: provider,
          export_format: exportFmt, max_steps: maxSteps, headless: true,
        }),
      });
      const job = await res.json();
      setJobId(job.job_id);
      connectWS(job.job_id);
    } catch (e) {
      setStatus("error");
      setError(`Backend offline at ${API} — see instructions below`);
      setEvents([{
        type: "job_error",
        error: `BACKEND NOT RUNNING. In Codespaces terminal:\n1. cd /workspaces/OMNI-SCRAPER/omni-scraper\n2. uvicorn backend.api.server:app --host 0.0.0.0 --port 8000 --reload\n3. In PORTS tab → right-click port 8000 → Set Port Visibility → PUBLIC`,
        timestamp: new Date().toISOString(),
      }]);
    }
  };

  const handleStop = () => {
    wsRef.current?.close();
    setStatus("idle");
  };

  const isRunning = status === "running";

  return (
    <div style={{
      minHeight: "100vh",
      background: "#050912",
      fontFamily: "JetBrains Mono, 'Fira Code', monospace",
      color: "#C8D6E5",
      display: "flex",
      flexDirection: "column",
    }}>
      {/* Google Fonts */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;700&family=Syne:wght@400;700;800&display=swap');

        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::selection { background: #00D4FF30; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #070C15; }
        ::-webkit-scrollbar-thumb { background: #1A2535; border-radius: 2px; }

        @keyframes fadeIn { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:translateY(0); } }
        @keyframes scanline {
          0%   { transform: translateY(-100%); }
          100% { transform: translateY(100vh); }
        }
        @keyframes pulse { 0%,100% { opacity:0.6; } 50% { opacity:1; } }

        input, textarea { outline: none !important; }
        button:hover { opacity: 0.85; }
      `}</style>

      {/* Scanline overlay */}
      <div style={{
        position: "fixed", top: 0, left: 0, width: "100%", height: "100%",
        pointerEvents: "none", zIndex: 999, overflow: "hidden",
      }}>
        <div style={{
          position: "absolute", width: "100%", height: 2,
          background: "linear-gradient(transparent, rgba(0,212,255,0.04), transparent)",
          animation: "scanline 8s linear infinite",
        }} />
      </div>

      {/* ── HEADER ── */}
      <header style={{
        padding: "18px 32px",
        borderBottom: "1px solid #0D1828",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: "rgba(5,9,18,0.95)", backdropFilter: "blur(12px)",
        position: "sticky", top: 0, zIndex: 100,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ position: "relative" }}>
            <div style={{
              width: 36, height: 36, borderRadius: "50%",
              border: "2px solid #00D4FF", display: "flex", alignItems: "center", justifyContent: "center",
              animation: "pulse 2s ease infinite",
            }}>
              <span style={{ fontSize: 16 }}>⬡</span>
            </div>
          </div>
          <div>
            <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 800, fontSize: 20, letterSpacing: 4, color: "#E2EAF4" }}>
              OMNI<span style={{ color: "#00D4FF" }}>·</span>SCRAPER
            </div>
            <div style={{ fontSize: 9, letterSpacing: 3, color: "#3D5A6E", marginTop: -1 }}>
              DISTRIBUTED AI WEB INTELLIGENCE SYSTEM
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          {isRunning && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#00FF88",
                animation: "pulse 1s ease infinite" }} />
              <span style={{ fontSize: 11, color: "#00FF88", letterSpacing: 2 }}>LIVE</span>
            </div>
          )}
          <div style={{ fontSize: 10, color: "#3D5A6E", letterSpacing: 1 }}>
            {steps > 0 && `STEP ${steps}`}
            {records > 0 && ` · ${records} RECORDS`}
          </div>
        </div>
      </header>

      {/* ── MAIN LAYOUT ── */}
      <div style={{ display: "flex", flex: 1, gap: 0, maxWidth: 1400, margin: "0 auto", width: "100%", padding: "24px 24px" }}>

        {/* ── LEFT PANEL: Controls ── */}
        <div style={{ width: 380, flexShrink: 0, display: "flex", flexDirection: "column", gap: 16, marginRight: 20 }}>

          {/* URL */}
          <div style={{ background: "#070C15", border: "1px solid #1A2535", borderRadius: 10, padding: "16px 18px" }}>
            <label style={{ fontSize: 10, color: "#3D5A6E", letterSpacing: 2, display: "block", marginBottom: 8 }}>
              TARGET URL
            </label>
            <input
              value={url} onChange={e => setUrl(e.target.value)}
              disabled={isRunning}
              placeholder="https://example.com"
              style={{
                width: "100%", background: "#0A1525", border: "1px solid #1A2535",
                borderRadius: 6, padding: "9px 12px", color: "#00D4FF",
                fontSize: 12, fontFamily: "JetBrains Mono, monospace",
              }}
            />
          </div>

          {/* Goal */}
          <div style={{ background: "#070C15", border: "1px solid #1A2535", borderRadius: 10, padding: "16px 18px" }}>
            <label style={{ fontSize: 10, color: "#3D5A6E", letterSpacing: 2, display: "block", marginBottom: 8 }}>
              SCRAPING GOAL
            </label>
            <textarea
              value={goal} onChange={e => setGoal(e.target.value)}
              disabled={isRunning}
              rows={3}
              placeholder="What data should the AI extract?"
              style={{
                width: "100%", background: "#0A1525", border: "1px solid #1A2535",
                borderRadius: 6, padding: "9px 12px", color: "#C8D6E5",
                fontSize: 12, fontFamily: "JetBrains Mono, monospace",
                resize: "vertical", lineHeight: 1.6,
              }}
            />
          </div>

          {/* LLM Provider */}
          <div style={{ background: "#070C15", border: "1px solid #1A2535", borderRadius: 10, padding: "16px 18px" }}>
            <label style={{ fontSize: 10, color: "#3D5A6E", letterSpacing: 2, display: "block", marginBottom: 12 }}>
              LLM ENGINE — SELECT ONE
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {PROVIDERS.map(p => (
                <ProviderCard key={p.id} p={p} selected={provider === p.id} onSelect={setProvider} />
              ))}
            </div>
          </div>

          {/* Export Format */}
          <div style={{ background: "#070C15", border: "1px solid #1A2535", borderRadius: 10, padding: "16px 18px" }}>
            <label style={{ fontSize: 10, color: "#3D5A6E", letterSpacing: 2, display: "block", marginBottom: 12 }}>
              EXPORT FORMAT
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              {EXPORT_FMTS.map(f => (
                <button key={f.id} onClick={() => setExportFmt(f.id)} style={{
                  flex: 1, background: exportFmt === f.id ? "#00D4FF15" : "#0A1525",
                  border: `1px solid ${exportFmt === f.id ? "#00D4FF" : "#1A2535"}`,
                  borderRadius: 6, padding: "10px 8px", cursor: "pointer",
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
                }}>
                  <span style={{ fontSize: 15, color: exportFmt === f.id ? "#00D4FF" : "#3D5A6E" }}>
                    {f.icon}
                  </span>
                  <span style={{ fontSize: 10, fontFamily: "JetBrains Mono, monospace",
                    color: exportFmt === f.id ? "#00D4FF" : "#8899AA", fontWeight: 700 }}>
                    {f.label}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Max Steps */}
          <div style={{ background: "#070C15", border: "1px solid #1A2535", borderRadius: 10, padding: "14px 18px",
            display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 10, color: "#3D5A6E", letterSpacing: 2, marginBottom: 2 }}>MAX STEPS</div>
              <div style={{ fontSize: 11, color: "#8899AA" }}>Agent iteration limit</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button onClick={() => setMaxSteps(s => Math.max(5, s - 5))} style={{
                background: "#0A1525", border: "1px solid #1A2535", borderRadius: 4,
                width: 28, height: 28, cursor: "pointer", color: "#8899AA", fontSize: 16,
              }}>−</button>
              <span style={{ fontSize: 16, fontWeight: 700, color: "#00D4FF", minWidth: 30, textAlign: "center" }}>
                {maxSteps}
              </span>
              <button onClick={() => setMaxSteps(s => Math.min(100, s + 5))} style={{
                background: "#0A1525", border: "1px solid #1A2535", borderRadius: 4,
                width: 28, height: 28, cursor: "pointer", color: "#8899AA", fontSize: 16,
              }}>+</button>
            </div>
          </div>

          {/* Launch Button */}
          <button
            onClick={isRunning ? handleStop : handleStart}
            style={{
              width: "100%", padding: "16px",
              background: isRunning
                ? "linear-gradient(135deg, #FF3D5A15, #FF3D5A20)"
                : "linear-gradient(135deg, #00D4FF20, #7C6CF820)",
              border: `1px solid ${isRunning ? "#FF3D5A" : "#00D4FF"}`,
              borderRadius: 10, cursor: "pointer",
              fontFamily: "Syne, sans-serif", fontWeight: 800,
              fontSize: 14, letterSpacing: 4,
              color: isRunning ? "#FF3D5A" : "#00D4FF",
              transition: "all 0.2s ease",
              boxShadow: isRunning
                ? "0 0 30px #FF3D5A30"
                : "0 0 30px #00D4FF20",
            }}
          >
            {isRunning ? `${spinner}  ABORT MISSION` : "▶  LAUNCH MISSION"}
          </button>

          {/* AIMD metrics */}
          {aimdMeta && <AIMDGauge metrics={aimdMeta} />}

          {/* Download panel */}
          {(status === "done" || records > 0) && jobId && (
            <ExportBar jobId={jobId} records={records} selectedFmt={exportFmt} onFmtChange={setExportFmt} />
          )}
        </div>

        {/* ── RIGHT PANEL: Terminal Log ── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>

          {/* Terminal header */}
          <div style={{
            background: "#070C15", border: "1px solid #1A2535", borderTopLeftRadius: 10,
            borderTopRightRadius: 10, padding: "12px 18px",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#FF3D5A" }} />
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#F59E0B" }} />
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#00FF88" }} />
              <span style={{ color: "#3D5A6E", fontSize: 11, marginLeft: 8, letterSpacing: 1 }}>
                omni-scraper — mission log
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              {isRunning && (
                <span style={{ color: "#F59E0B", fontSize: 10, letterSpacing: 1 }}>
                  {spinner} EXECUTING — STEP {steps}
                </span>
              )}
              {status === "done" && (
                <span style={{ color: "#00FF88", fontSize: 10, letterSpacing: 1 }}>
                  ✓ MISSION COMPLETE — {records} RECORDS
                </span>
              )}
              {status === "error" && (
                <span style={{ color: "#FF3D5A", fontSize: 10, letterSpacing: 1 }}>
                  ✗ MISSION FAILED
                </span>
              )}
              <span style={{ color: "#3D5A6E", fontSize: 10 }}>
                {events.length} events
              </span>
            </div>
          </div>

          {/* Log body */}
          <div
            ref={logRef}
            style={{
              flex: 1, overflowY: "auto",
              background: "#05090E",
              border: "1px solid #1A2535", borderTop: "none", borderBottomLeftRadius: 10,
              borderBottomRightRadius: 10,
              padding: "12px 18px",
              minHeight: 500, maxHeight: "calc(100vh - 200px)",
            }}
          >
            {events.length === 0 ? (
              <div style={{
                display: "flex", flexDirection: "column", alignItems: "center",
                justifyContent: "center", height: 300, gap: 16,
              }}>
                <div style={{ fontSize: 48, opacity: 0.15 }}>⬡</div>
                <div style={{ color: "#3D5A6E", fontSize: 11, letterSpacing: 3, textAlign: "center" }}>
                  AWAITING MISSION PARAMETERS<br/>
                  <span style={{ fontSize: 9, opacity: 0.6 }}>Configure URL, goal, and LLM engine — then launch</span>
                </div>
              </div>
            ) : (
              events.map((ev, i) => (
                <LogLine key={i} ev={ev} isLast={i === events.length - 1} />
              ))
            )}

            {status === "done" && (
              <div style={{
                marginTop: 16, padding: "14px 18px",
                background: "#00FF8808", border: "1px solid #00FF8830",
                borderRadius: 8, display: "flex", alignItems: "center", gap: 12,
              }}>
                <span style={{ fontSize: 22 }}>✓</span>
                <div>
                  <div style={{ color: "#00FF88", fontWeight: 700, fontSize: 13, letterSpacing: 1 }}>
                    MISSION ACCOMPLISHED
                  </div>
                  <div style={{ color: "#8899AA", fontSize: 11, marginTop: 2 }}>
                    {records} records extracted in {steps} steps · Select format and download above
                  </div>
                </div>
              </div>
            )}

            {status === "error" && (
              <div style={{
                marginTop: 16, padding: "14px 18px",
                background: "#FF3D5A08", border: "1px solid #FF3D5A30",
                borderRadius: 8,
              }}>
                <div style={{ color: "#FF3D5A", fontWeight: 700, fontSize: 13, letterSpacing: 1, marginBottom: 4 }}>
                  ✗ MISSION FAILED
                </div>
                <div style={{ color: "#8899AA", fontSize: 11 }}>{error}</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
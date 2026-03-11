import { useState, useEffect, useRef, useCallback } from "react";

// ═══════════════════════════════════════════════════════════════════
//  OMNI-SCRAPER v2 — Mission Control UI
//  Aesthetic: Deep-space observatory / satellite ground station
//  Fonts: Space Grotesk (display) + IBM Plex Mono (data)
//  Color: Near-black navy · Amber gold · Ice blue · Signal green
// ═══════════════════════════════════════════════════════════════════

// ── Codespaces URL detection ──────────────────────────────────────
const swapPort = (host, p) => host.replace(/(-\d+)(\.app\.github\.dev)$/, `-${p}$2`);
const getAPI = () => window.location.hostname.includes(".app.github.dev")
  ? `https://${swapPort(window.location.hostname, 8000)}` : "http://localhost:8000";
const getWS = () => window.location.hostname.includes(".app.github.dev")
  ? `wss://${swapPort(window.location.hostname, 8000)}` : "ws://localhost:8000";
const API = getAPI();
const WS  = getWS();

// ── Constants ─────────────────────────────────────────────────────
const PROVIDERS = [
  { id:"claude", label:"Claude 3.5",    vendor:"Anthropic", tag:"CLOSED", hex:"#E8622A" },
  { id:"openai", label:"GPT-4o",        vendor:"OpenAI",    tag:"CLOSED", hex:"#19C37D" },
  { id:"kimi",   label:"Kimi K2.5",     vendor:"Moonshot",  tag:"OPEN",   hex:"#6C8EF5" },
  { id:"qwen",   label:"Qwen 3.5 397B", vendor:"Alibaba",   tag:"OPEN",   hex:"#F0B429" },
];

const TARGET_PRESETS = [
  { label:"1K",   value:1000 },
  { label:"10K",  value:10000 },
  { label:"100K", value:100000 },
  { label:"1M",   value:1000000 },
  { label:"Custom", value:0 },
];

const EXPORT_FMTS = ["json","csv","tsv"];

// ── Hooks ─────────────────────────────────────────────────────────
function useSpinner() {
  const frames = ["◐","◓","◑","◒"];
  const [i, setI] = useState(0);
  useEffect(() => { const t = setInterval(()=>setI(x=>(x+1)%4),120); return()=>clearInterval(t); },[]);
  return frames[i];
}
function useBlink(ms=500) {
  const [on,setOn]=useState(true);
  useEffect(()=>{const t=setInterval(()=>setOn(v=>!v),ms);return()=>clearInterval(t);},[ms]);
  return on;
}
function usePulse(ms=2000) {
  const [v,setV]=useState(0);
  useEffect(()=>{const t=setInterval(()=>setV(x=>(x+1)%100),ms/100);return()=>clearInterval(t);},[ms]);
  return Math.sin(v*Math.PI/50);
}

// ── Circular Progress Ring ─────────────────────────────────────────
function RingProgress({ pct=0, size=120, stroke=8, color="#F0B429", label, sublabel }) {
  const r   = (size-stroke*2)/2;
  const circ = 2*Math.PI*r;
  const dash  = (pct/100)*circ;
  return (
    <div style={{position:"relative",width:size,height:size,flexShrink:0}}>
      <svg width={size} height={size} style={{transform:"rotate(-90deg)"}}>
        <circle cx={size/2} cy={size/2} r={r} fill="none"
          stroke="rgba(255,255,255,0.06)" strokeWidth={stroke}/>
        <circle cx={size/2} cy={size/2} r={r} fill="none"
          stroke={color} strokeWidth={stroke}
          strokeDasharray={`${dash} ${circ-dash}`}
          strokeLinecap="round"
          style={{transition:"stroke-dasharray 0.4s ease"}}/>
      </svg>
      <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",
        alignItems:"center",justifyContent:"center",gap:2}}>
        <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:size>100?22:14,
          fontWeight:700,color:"#F5F0E8",lineHeight:1}}>{label}</span>
        {sublabel&&<span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,
          color:"rgba(245,240,232,0.4)",letterSpacing:1}}>{sublabel}</span>}
      </div>
    </div>
  );
}

// ── Radar sweep animation (decorative) ────────────────────────────
function RadarDot({ active }) {
  const pulse = usePulse(3000);
  return (
    <div style={{position:"relative",width:48,height:48}}>
      <div style={{
        position:"absolute",inset:0,borderRadius:"50%",
        border:"1px solid rgba(240,180,41,0.3)",
        transform:`scale(${1+pulse*0.15})`,
        opacity:0.4+pulse*0.3,
        transition:"all 0.05s",
      }}/>
      <div style={{
        position:"absolute",inset:6,borderRadius:"50%",
        background:active?"#F0B429":"rgba(240,180,41,0.2)",
        boxShadow:active?"0 0 20px #F0B42980":"none",
        transition:"all 0.3s",
      }}/>
    </div>
  );
}

// ── Log event row ─────────────────────────────────────────────────
const EVENT_META = {
  job_start:    { icon:"⬡", color:"#6C8EF5", tag:"INIT"     },
  navigate:     { icon:"→", color:"#6C8EF5", tag:"NAV"      },
  perceive:     { icon:"◎", color:"#19C37D", tag:"SCAN"     },
  reason:       { icon:"◈", color:"#F0B429", tag:"THINK"    },
  act:          { icon:"▶", color:"#E8622A", tag:"ACT"      },
  extract:      { icon:"⬇", color:"#19C37D", tag:"EXTRACT"  },
  ratelimit:    { icon:"⏸", color:"#F0B429", tag:"LIMIT"    },
  scale_info:   { icon:"⤴", color:"#6C8EF5", tag:"SCALE"    },
  job_complete: { icon:"✓", color:"#19C37D", tag:"DONE"     },
  job_error:    { icon:"✗", color:"#E8622A", tag:"ERROR"    },
};

function evtText(ev) {
  switch(ev.type) {
    case "job_start":    return `Mission start → ${ev.url}`;
    case "navigate":     return `Navigating → ${ev.url}`;
    case "perceive":     return `Page scanned (${ev.ms}ms)`;
    case "reason":       return `[${ev.action?.toUpperCase()}] ${ev.reasoning||""}`.slice(0,90);
    case "act":          return `${ev.action?.toUpperCase()} → ${ev.target||""}`.slice(0,80);
    case "extract":      return `Extracted ${ev.new_records} records — total ${ev.total}/${ev.target} (${ev.progress_pct}%)`;
    case "ratelimit":    return `Rate limit — cooling ${ev.delay_s}s`;
    case "scale_info":   return `Workers: ${ev.workers} — target: ${ev.target?.toLocaleString()} records`;
    case "job_complete": return `Mission complete — ${ev.records?.toLocaleString()} records, ${ev.steps} steps, ${ev.pages} pages`;
    case "job_error":    return `Fatal: ${ev.error}`.slice(0,120);
    default:             return JSON.stringify(ev).slice(0,80);
  }
}

function LogRow({ ev, isLast }) {
  const sp   = useSpinner();
  const blink = useBlink(400);
  const meta  = EVENT_META[ev.type] || {icon:"·",color:"#888",tag:"EVT"};
  const isRunning = isLast && !["job_complete","job_error"].includes(ev.type);
  const isErr = ev.type==="job_error" || ev.success===false;
  const isDone = ev.type==="job_complete";

  return (
    <div style={{
      display:"flex",alignItems:"center",gap:10,
      padding:"5px 0",borderBottom:"1px solid rgba(255,255,255,0.03)",
      animation:"rowIn 0.18s ease",
    }}>
      <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,
        color:"rgba(245,240,232,0.25)",minWidth:84,flexShrink:0}}>
        {ev.timestamp?.split("T")[1]?.slice(0,12)||""}
      </span>
      <span style={{
        fontSize:11,fontFamily:"'IBM Plex Mono',monospace",fontWeight:700,
        background:`${meta.color}22`,color:meta.color,
        padding:"1px 6px",borderRadius:3,minWidth:64,textAlign:"center",flexShrink:0,
      }}>{meta.tag}</span>
      <span style={{fontSize:14,color:isRunning?meta.color:isDone?"#19C37D":isErr?"#E8622A":meta.color,flexShrink:0}}>
        {isRunning ? sp : meta.icon}
      </span>
      <span style={{
        fontFamily:"'IBM Plex Mono',monospace",fontSize:12,
        color:isErr?"#E8622A80":isDone?"#19C37D":"rgba(245,240,232,0.7)",
        flex:1,lineHeight:1.5,
      }}>
        {evtText(ev)}
        {isRunning&&<span style={{opacity:blink?1:0,color:meta.color}}> ▌</span>}
      </span>
      {ev.ms&&<span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,
        color:"rgba(245,240,232,0.2)",minWidth:44,textAlign:"right",flexShrink:0}}>
        {ev.ms}ms</span>}
    </div>
  );
}

// ── Sample data preview ────────────────────────────────────────────
function SamplePanel({ samples }) {
  const [open, setOpen] = useState(true);
  if (!samples?.length) return null;
  const keys = Object.keys(samples[0]||{}).slice(0,6);
  return (
    <div style={{background:"#0C111D",border:"1px solid rgba(108,142,245,0.2)",
      borderRadius:10,overflow:"hidden",marginTop:12}}>
      <div onClick={()=>setOpen(v=>!v)} style={{
        padding:"10px 16px",display:"flex",alignItems:"center",
        justifyContent:"space-between",cursor:"pointer",
        background:"rgba(108,142,245,0.06)",
      }}>
        <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:11,
          color:"#6C8EF5",letterSpacing:2}}>
          LIVE SAMPLE — {samples.length} RECORDS
        </span>
        <span style={{color:"rgba(245,240,232,0.3)",fontSize:12}}>{open?"▲":"▼"}</span>
      </div>
      {open&&(
        <div style={{overflowX:"auto",padding:"0 0 8px"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,
            fontFamily:"'IBM Plex Mono',monospace"}}>
            <thead>
              <tr>{keys.map(k=>(
                <th key={k} style={{padding:"6px 12px",textAlign:"left",
                  color:"rgba(240,180,41,0.7)",fontWeight:700,letterSpacing:1,
                  borderBottom:"1px solid rgba(255,255,255,0.06)",whiteSpace:"nowrap"}}>
                  {k.toUpperCase().slice(0,16)}
                </th>
              ))}</tr>
            </thead>
            <tbody>
              {samples.slice(-5).map((row,i)=>(
                <tr key={i} style={{background:i%2?"transparent":"rgba(255,255,255,0.015)"}}>
                  {keys.map(k=>(
                    <td key={k} style={{padding:"5px 12px",color:"rgba(245,240,232,0.65)",
                      maxWidth:180,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",
                      borderBottom:"1px solid rgba(255,255,255,0.03)"}}>
                      {String(row[k]||"—").slice(0,50)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Export strip ───────────────────────────────────────────────────
function ExportStrip({ jobId, records }) {
  const [busy,setBusy] = useState(null);
  const dl = async (fmt) => {
    setBusy(fmt);
    try {
      const r = await fetch(`${API}/api/jobs/${jobId}/export?fmt=${fmt}`);
      const b = await r.blob();
      const u = URL.createObjectURL(b);
      const a = document.createElement("a");
      a.href=u; a.download=`omni_${jobId}.${fmt}`; a.click();
      URL.revokeObjectURL(u);
    } catch{}
    setBusy(null);
  };
  return (
    <div style={{display:"flex",gap:8,marginTop:12}}>
      {EXPORT_FMTS.map(f=>(
        <button key={f} onClick={()=>dl(f)} style={{
          flex:1,padding:"11px 6px",cursor:"pointer",borderRadius:8,
          background:busy===f?"rgba(25,195,125,0.15)":"rgba(255,255,255,0.04)",
          border:`1px solid ${busy===f?"#19C37D":"rgba(255,255,255,0.1)"}`,
          color:busy===f?"#19C37D":"rgba(245,240,232,0.6)",
          fontFamily:"'IBM Plex Mono',monospace",fontSize:12,fontWeight:700,
          letterSpacing:1,transition:"all 0.15s",
        }}>
          {busy===f?"⟳ SAVING":f.toUpperCase()+" ↓"}
        </button>
      ))}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────
export default function App() {
  const [url,        setUrl]       = useState("https://books.toscrape.com");
  const [goal,       setGoal]      = useState("Extract all book titles, prices, and ratings");
  const [provider,   setProvider]  = useState("claude");
  const [targetPreset, setPreset]  = useState(1000);
  const [customTarget, setCustom]  = useState(500);
  const [exportFmt,  setFmt]       = useState("json");

  const [jobId,      setJobId]     = useState(null);
  const [status,     setStatus]    = useState("idle");
  const [events,     setEvents]    = useState([]);
  const [records,    setRecords]   = useState(0);
  const [target,     setTarget]    = useState(1000);
  const [pct,        setPct]       = useState(0);
  const [pages,      setPages]     = useState(0);
  const [steps,      setSteps]     = useState(0);
  const [workers,    setWorkers]   = useState(1);
  const [samples,    setSamples]   = useState([]);
  const [aimd,       setAimd]      = useState(null);
  const [error,      setError]     = useState(null);

  const logRef = useRef(null);
  const wsRef  = useRef(null);
  const sp     = useSpinner();
  const blink  = useBlink(600);

  const effectiveTarget = targetPreset === 0 ? customTarget : targetPreset;

  useEffect(()=>{
    if(logRef.current)
      logRef.current.scrollTop = logRef.current.scrollHeight;
  },[events]);

  const connectWS = useCallback((jid) => {
    if(wsRef.current) wsRef.current.close();
    const ws = new WebSocket(`${WS}/ws/${jid}`);
    wsRef.current = ws;
    ws.onmessage = (m) => {
      const ev = JSON.parse(m.data);
      setEvents(p=>[...p,ev]);
      if(ev.type==="extract"){
        setRecords(ev.total??0);
        setPct(ev.progress_pct??0);
        setPages(ev.pages??0);
        if(ev.sample?.length) setSamples(p=>[...p,...ev.sample].slice(-10));
      }
      if(ev.type==="act")         setSteps(s=>s+1);
      if(ev.type==="scale_info")  setWorkers(ev.workers??1);
      if(ev.type==="job_complete"){ setStatus("done"); setRecords(ev.records??0); setPct(100); }
      if(ev.type==="job_error")   { setStatus("error"); setError(ev.error); }
    };
    const poll = setInterval(async()=>{
      try{ const r=await fetch(`${API}/api/metrics`); const d=await r.json();
        if(d.domains?.[0]) setAimd(d.domains[0]); }catch{}
    },2500);
    ws.onclose = ()=>clearInterval(poll);
  },[]);

  const launch = async () => {
    setEvents([]); setRecords(0); setPct(0); setPages(0);
    setSteps(0); setWorkers(1); setSamples([]); setError(null);
    setTarget(effectiveTarget); setStatus("running");
    try {
      const r = await fetch(`${API}/api/scrape`,{
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          url, goal, llm_provider:provider,
          export_format:exportFmt, target_records:effectiveTarget,
          max_steps:200, headless:true,
        }),
      });
      const j = await r.json();
      setJobId(j.job_id);
      connectWS(j.job_id);
    } catch(e) {
      setStatus("error");
      setError("Backend offline");
      setEvents([{type:"job_error",error:`Cannot reach ${API} — start uvicorn and make port 8000 PUBLIC`,timestamp:new Date().toISOString()}]);
    }
  };

  const abort = () => { wsRef.current?.close(); setStatus("idle"); };
  const isRunning = status==="running";
  const stateColor = {idle:"#6C8EF5",running:"#F0B429",done:"#19C37D",error:"#E8622A"}[status];

  const aimdState = aimd?.state||"idle";
  const aimdColors = {cruising:"#19C37D",probing:"#6C8EF5",backing:"#F0B429",paused:"#E8622A"};

  return (
    <div style={{minHeight:"100vh",background:"#070B14",color:"#F5F0E8",
      fontFamily:"'Space Grotesk',sans-serif",display:"flex",flexDirection:"column",
      overflowX:"hidden"}}>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;600;700&family=IBM+Plex+Mono:wght@400;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        ::selection{background:#F0B42930}
        ::-webkit-scrollbar{width:3px}
        ::-webkit-scrollbar-track{background:#070B14}
        ::-webkit-scrollbar-thumb{background:#1A2235;border-radius:2px}
        input,textarea{outline:none!important;caret-color:#F0B429}
        button{cursor:pointer}
        @keyframes rowIn{from{opacity:0;transform:translateX(-6px)}to{opacity:1;transform:translateX(0)}}
        @keyframes gridPulse{0%,100%{opacity:0.03}50%{opacity:0.07}}
        @keyframes scanline{0%{transform:translateY(-100%)}100%{transform:translateY(100vh)}}
        @keyframes orbitSpin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}
      `}</style>

      {/* Grid background */}
      <div style={{position:"fixed",inset:0,pointerEvents:"none",zIndex:0,
        backgroundImage:"linear-gradient(rgba(108,142,245,0.04) 1px,transparent 1px),linear-gradient(90deg,rgba(108,142,245,0.04) 1px,transparent 1px)",
        backgroundSize:"40px 40px",animation:"gridPulse 4s ease infinite"}}/>

      {/* Scanline */}
      <div style={{position:"fixed",top:0,left:0,width:"100%",height:"100%",
        pointerEvents:"none",zIndex:999,overflow:"hidden"}}>
        <div style={{position:"absolute",width:"100%",height:1,
          background:"linear-gradient(transparent,rgba(240,180,41,0.06),transparent)",
          animation:"scanline 10s linear infinite"}}/>
      </div>

      {/* ── HEADER ── */}
      <header style={{padding:"0 32px",height:64,display:"flex",alignItems:"center",
        justifyContent:"space-between",borderBottom:"1px solid rgba(255,255,255,0.06)",
        background:"rgba(7,11,20,0.92)",backdropFilter:"blur(16px)",
        position:"sticky",top:0,zIndex:100}}>
        <div style={{display:"flex",alignItems:"center",gap:20}}>
          <RadarDot active={isRunning}/>
          <div>
            <div style={{fontFamily:"'Space Grotesk',sans-serif",fontWeight:700,
              fontSize:18,letterSpacing:3,color:"#F5F0E8"}}>
              OMNI<span style={{color:"#F0B429"}}>·</span>SCRAPER
            </div>
            <div style={{fontSize:9,letterSpacing:3,color:"rgba(245,240,232,0.25)",marginTop:-1}}>
              AUTONOMOUS WEB INTELLIGENCE  v2.0
            </div>
          </div>
        </div>

        {/* Live status bar */}
        <div style={{display:"flex",alignItems:"center",gap:24}}>
          {isRunning&&(
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:12,color:"#F0B429"}}>
                {sp}
              </span>
              <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:11,
                color:"rgba(245,240,232,0.5)",letterSpacing:1}}>
                STEP {steps} · PAGE {pages} · {workers}W
              </span>
            </div>
          )}
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <div style={{width:7,height:7,borderRadius:"50%",background:stateColor,
              boxShadow:`0 0 8px ${stateColor}`}}/>
            <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:11,
              color:stateColor,letterSpacing:2}}>
              {status.toUpperCase()}
            </span>
          </div>
        </div>
      </header>

      {/* ── MAIN 3-COLUMN LAYOUT ── */}
      <div style={{display:"flex",flex:1,gap:0,position:"relative",zIndex:1}}>

        {/* ── COL 1: Config ── */}
        <div style={{width:300,flexShrink:0,borderRight:"1px solid rgba(255,255,255,0.06)",
          padding:"24px 20px",display:"flex",flexDirection:"column",gap:16,
          overflowY:"auto",maxHeight:"calc(100vh - 64px)"}}>

          <div style={{fontSize:9,letterSpacing:3,color:"rgba(245,240,232,0.25)",marginBottom:4}}>
            MISSION PARAMETERS
          </div>

          {/* URL */}
          <div>
            <label style={{fontSize:10,letterSpacing:2,color:"rgba(245,240,232,0.35)",
              display:"block",marginBottom:6,fontFamily:"'IBM Plex Mono',monospace"}}>
              TARGET URL
            </label>
            <input value={url} onChange={e=>setUrl(e.target.value)} disabled={isRunning}
              placeholder="https://..." style={{
                width:"100%",background:"rgba(255,255,255,0.03)",
                border:"1px solid rgba(108,142,245,0.25)",borderRadius:6,
                padding:"9px 12px",color:"#6C8EF5",fontSize:12,
                fontFamily:"'IBM Plex Mono',monospace",
              }}/>
          </div>

          {/* Goal */}
          <div>
            <label style={{fontSize:10,letterSpacing:2,color:"rgba(245,240,232,0.35)",
              display:"block",marginBottom:6,fontFamily:"'IBM Plex Mono',monospace"}}>
              EXTRACTION GOAL
            </label>
            <textarea value={goal} onChange={e=>setGoal(e.target.value)}
              disabled={isRunning} rows={3} style={{
                width:"100%",background:"rgba(255,255,255,0.03)",
                border:"1px solid rgba(255,255,255,0.1)",borderRadius:6,
                padding:"9px 12px",color:"rgba(245,240,232,0.8)",fontSize:12,
                fontFamily:"'Space Grotesk',sans-serif",resize:"vertical",lineHeight:1.5,
              }}/>
          </div>

          {/* LLM Provider */}
          <div>
            <label style={{fontSize:10,letterSpacing:2,color:"rgba(245,240,232,0.35)",
              display:"block",marginBottom:8,fontFamily:"'IBM Plex Mono',monospace"}}>
              LLM ENGINE
            </label>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {PROVIDERS.map(p=>(
                <button key={p.id} onClick={()=>!isRunning&&setProvider(p.id)} style={{
                  display:"flex",alignItems:"center",justifyContent:"space-between",
                  padding:"9px 12px",borderRadius:7,
                  background:provider===p.id?`${p.hex}12`:"rgba(255,255,255,0.02)",
                  border:`1px solid ${provider===p.id?p.hex:"rgba(255,255,255,0.07)"}`,
                  color:provider===p.id?"#F5F0E8":"rgba(245,240,232,0.45)",
                  transition:"all 0.15s",boxShadow:provider===p.id?`0 0 16px ${p.hex}20`:"none",
                }}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <div style={{width:8,height:8,borderRadius:"50%",background:p.hex,
                      opacity:provider===p.id?1:0.3}}/>
                    <div style={{textAlign:"left"}}>
                      <div style={{fontSize:12,fontWeight:600,fontFamily:"'Space Grotesk',sans-serif"}}>
                        {p.label}
                      </div>
                      <div style={{fontSize:10,fontFamily:"'IBM Plex Mono',monospace",
                        color:"rgba(245,240,232,0.3)",marginTop:1}}>{p.vendor}</div>
                    </div>
                  </div>
                  <span style={{fontSize:9,fontFamily:"'IBM Plex Mono',monospace",
                    fontWeight:700,letterSpacing:1,
                    color:p.tag==="OPEN"?"#19C37D":"rgba(232,98,42,0.7)"}}>
                    {p.tag}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Target records */}
          <div>
            <label style={{fontSize:10,letterSpacing:2,color:"rgba(245,240,232,0.35)",
              display:"block",marginBottom:8,fontFamily:"'IBM Plex Mono',monospace"}}>
              TARGET RECORDS
            </label>
            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
              {TARGET_PRESETS.map(p=>(
                <button key={p.value} onClick={()=>!isRunning&&setPreset(p.value)} style={{
                  flex:"1 1 calc(33% - 4px)",padding:"8px 4px",borderRadius:6,
                  background:targetPreset===p.value?"rgba(240,180,41,0.12)":"rgba(255,255,255,0.03)",
                  border:`1px solid ${targetPreset===p.value?"#F0B429":"rgba(255,255,255,0.07)"}`,
                  color:targetPreset===p.value?"#F0B429":"rgba(245,240,232,0.4)",
                  fontSize:11,fontWeight:700,fontFamily:"'IBM Plex Mono',monospace",letterSpacing:1,
                  transition:"all 0.12s",
                }}>{p.label}</button>
              ))}
            </div>
            {targetPreset===0&&(
              <input type="number" value={customTarget}
                onChange={e=>setCustom(Math.max(1,parseInt(e.target.value)||1))}
                placeholder="Enter count" style={{
                  marginTop:8,width:"100%",background:"rgba(255,255,255,0.03)",
                  border:"1px solid rgba(240,180,41,0.3)",borderRadius:6,
                  padding:"8px 12px",color:"#F0B429",fontSize:12,
                  fontFamily:"'IBM Plex Mono',monospace",
                }}/>
            )}
          </div>

          {/* Export format */}
          <div>
            <label style={{fontSize:10,letterSpacing:2,color:"rgba(245,240,232,0.35)",
              display:"block",marginBottom:8,fontFamily:"'IBM Plex Mono',monospace"}}>
              EXPORT FORMAT
            </label>
            <div style={{display:"flex",gap:6}}>
              {EXPORT_FMTS.map(f=>(
                <button key={f} onClick={()=>setFmt(f)} style={{
                  flex:1,padding:"8px 4px",borderRadius:6,
                  background:exportFmt===f?"rgba(25,195,125,0.1)":"rgba(255,255,255,0.03)",
                  border:`1px solid ${exportFmt===f?"#19C37D":"rgba(255,255,255,0.07)"}`,
                  color:exportFmt===f?"#19C37D":"rgba(245,240,232,0.4)",
                  fontSize:11,fontWeight:700,fontFamily:"'IBM Plex Mono',monospace",
                  letterSpacing:1,transition:"all 0.12s",
                }}>{f.toUpperCase()}</button>
              ))}
            </div>
          </div>

          {/* Launch */}
          <button onClick={isRunning?abort:launch} style={{
            width:"100%",padding:"14px",borderRadius:9,marginTop:4,
            background:isRunning
              ?"rgba(232,98,42,0.12)"
              :"linear-gradient(135deg,rgba(240,180,41,0.15),rgba(108,142,245,0.1))",
            border:`1px solid ${isRunning?"#E8622A":"#F0B429"}`,
            color:isRunning?"#E8622A":"#F0B429",
            fontFamily:"'Space Grotesk',sans-serif",fontWeight:700,
            fontSize:13,letterSpacing:3,
            boxShadow:isRunning?"0 0 24px #E8622A20":"0 0 24px #F0B42920",
            transition:"all 0.2s",
          }}>
            {isRunning?`${sp}  ABORT MISSION`:"▶  LAUNCH MISSION"}
          </button>

          {/* AIMD status */}
          {aimd&&(
            <div style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.06)",
              borderRadius:8,padding:"12px 14px"}}>
              <div style={{fontSize:9,letterSpacing:2,color:"rgba(245,240,232,0.25)",
                marginBottom:10,fontFamily:"'IBM Plex Mono',monospace"}}>AIMD · RATE CONTROL</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                {[
                  ["STATE",   aimdState.toUpperCase(), aimdColors[aimdState]||"#888"],
                  ["CONC",    `${aimd.concurrency||1}×`,  "#6C8EF5"],
                  ["DELAY",   `${aimd.delay_ms||2000}ms`, "#F0B429"],
                  ["ERR",     `${Math.round((aimd.error_rate||0)*100)}%`,
                              (aimd.error_rate||0)>0.05?"#E8622A":"#19C37D"],
                ].map(([k,v,c])=>(
                  <div key={k}>
                    <div style={{fontSize:9,letterSpacing:1,color:"rgba(245,240,232,0.25)",
                      fontFamily:"'IBM Plex Mono',monospace"}}>{k}</div>
                    <div style={{fontSize:13,fontWeight:700,color:c,
                      fontFamily:"'IBM Plex Mono',monospace"}}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── COL 2: Mission log ── */}
        <div style={{flex:1,display:"flex",flexDirection:"column",
          borderRight:"1px solid rgba(255,255,255,0.06)",
          maxHeight:"calc(100vh - 64px)"}}>

          <div style={{padding:"14px 20px",borderBottom:"1px solid rgba(255,255,255,0.06)",
            display:"flex",alignItems:"center",justifyContent:"space-between",
            background:"rgba(7,11,20,0.6)",flexShrink:0}}>
            <span style={{fontSize:10,letterSpacing:3,color:"rgba(245,240,232,0.3)",
              fontFamily:"'IBM Plex Mono',monospace"}}>MISSION LOG</span>
            <span style={{fontSize:10,letterSpacing:1,color:"rgba(245,240,232,0.2)",
              fontFamily:"'IBM Plex Mono',monospace"}}>{events.length} events</span>
          </div>

          <div ref={logRef} style={{flex:1,overflowY:"auto",padding:"10px 20px"}}>
            {events.length===0?(
              <div style={{display:"flex",flexDirection:"column",alignItems:"center",
                justifyContent:"center",height:300,gap:16,opacity:0.3}}>
                <div style={{fontSize:56,fontFamily:"'IBM Plex Mono',monospace",
                  color:"#F0B429",lineHeight:1}}>◎</div>
                <div style={{fontSize:11,letterSpacing:3,textAlign:"center",
                  fontFamily:"'IBM Plex Mono',monospace"}}>
                  AWAITING MISSION LAUNCH
                </div>
              </div>
            ):(
              events.map((ev,i)=>(
                <LogRow key={i} ev={ev} isLast={i===events.length-1}/>
              ))
            )}
          </div>
        </div>

        {/* ── COL 3: Telemetry + Data ── */}
        <div style={{width:320,flexShrink:0,padding:"24px 20px",
          display:"flex",flexDirection:"column",gap:16,
          overflowY:"auto",maxHeight:"calc(100vh - 64px)"}}>

          <div style={{fontSize:9,letterSpacing:3,color:"rgba(245,240,232,0.25)",marginBottom:4,
            fontFamily:"'IBM Plex Mono',monospace"}}>TELEMETRY</div>

          {/* Progress rings */}
          <div style={{display:"flex",justifyContent:"space-around",
            background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.06)",
            borderRadius:10,padding:"20px 12px"}}>
            <RingProgress
              pct={pct} size={110} color="#F0B429"
              label={`${Math.round(pct)}%`} sublabel="PROGRESS"
            />
            <RingProgress
              pct={target>0?Math.min(100,(records/target)*100):0}
              size={110} color="#19C37D"
              label={records>=1000?`${(records/1000).toFixed(1)}K`:records}
              sublabel={`/ ${target>=1000?(target/1000).toFixed(0)+"K":target}`}
            />
          </div>

          {/* Stats grid */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            {[
              ["RECORDS",  records.toLocaleString(), "#F0B429"],
              ["TARGET",   effectiveTarget.toLocaleString(), "rgba(245,240,232,0.4)"],
              ["PAGES",    pages, "#6C8EF5"],
              ["STEPS",    steps, "#6C8EF5"],
              ["WORKERS",  `${workers}×`, "#19C37D"],
              ["STATUS",   status.toUpperCase(), stateColor],
            ].map(([k,v,c])=>(
              <div key={k} style={{background:"rgba(255,255,255,0.02)",
                border:"1px solid rgba(255,255,255,0.05)",borderRadius:7,padding:"10px 12px"}}>
                <div style={{fontSize:9,letterSpacing:2,color:"rgba(245,240,232,0.25)",
                  fontFamily:"'IBM Plex Mono',monospace",marginBottom:4}}>{k}</div>
                <div style={{fontSize:16,fontWeight:700,color:c,
                  fontFamily:"'IBM Plex Mono',monospace"}}>{v}</div>
              </div>
            ))}
          </div>

          {/* Progress bar */}
          <div style={{background:"rgba(255,255,255,0.04)",borderRadius:4,height:6,overflow:"hidden"}}>
            <div style={{
              height:"100%",borderRadius:4,
              background:"linear-gradient(90deg,#F0B429,#19C37D)",
              width:`${pct}%`,transition:"width 0.5s ease",
            }}/>
          </div>
          <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,
            color:"rgba(245,240,232,0.3)",textAlign:"right",marginTop:-8}}>
            {records.toLocaleString()} / {effectiveTarget.toLocaleString()} records
          </div>

          {/* Sample data */}
          <SamplePanel samples={samples}/>

          {/* Download */}
          {(status==="done"||records>0)&&jobId&&(
            <div>
              <div style={{fontSize:9,letterSpacing:3,color:"rgba(245,240,232,0.25)",
                marginBottom:6,fontFamily:"'IBM Plex Mono',monospace"}}>EXPORT DATA</div>
              <ExportStrip jobId={jobId} records={records}/>
            </div>
          )}

          {/* Error */}
          {status==="error"&&error&&(
            <div style={{background:"rgba(232,98,42,0.08)",
              border:"1px solid rgba(232,98,42,0.3)",borderRadius:8,padding:"12px 14px"}}>
              <div style={{color:"#E8622A",fontWeight:700,fontSize:12,marginBottom:4,
                fontFamily:"'IBM Plex Mono',monospace"}}>✗ ERROR</div>
              <div style={{color:"rgba(245,240,232,0.5)",fontSize:11,
                fontFamily:"'IBM Plex Mono',monospace",lineHeight:1.6,wordBreak:"break-word"}}>
                {error}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
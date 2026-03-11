import React, { useState, useRef, useCallback } from 'react'
import {
  Zap, Globe, Activity, X, Download,
  CheckCircle2, Clock, AlertCircle, Loader2, Eye,
  BarChart3, Layers, ArrowRight, RefreshCw
} from 'lucide-react'

// ── Constants ─────────────────────────────────────────────
const API = ''
const WS_BASE = window.location.protocol === 'https:'
  ? `wss://${window.location.host}`
  : `ws://${window.location.host}`

const DATA_TYPES = [
  { value: 'auto',   label: 'Auto Detect' },
  { value: 'text',   label: 'Text & Content' },
  { value: 'table',  label: 'Tables & Data' },
  { value: 'links',  label: 'Links' },
  { value: 'images', label: 'Images' },
]

// ── CSS injection ──────────────────────────────────────────
const CSS = `
  :root {
    --bg:#050508; --surface:#0d0d14; --surface2:#13131e;
    --border:rgba(120,100,255,0.15); --border2:rgba(120,100,255,0.28);
    --accent:#7c5cfc; --accent2:#a78bfa;
    --green:#22d3a0; --red:#f43f5e; --yellow:#fbbf24;
    --text:#e8e6ff; --text2:#9991cc;
    --mono:'DM Mono','Space Mono',monospace;
  }
  @keyframes spin   { to { transform:rotate(360deg) } }
  @keyframes pulse  { 0%,100%{opacity:1} 50%{opacity:0.4} }
  @keyframes fadeUp { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:none} }
  @keyframes shimmer{
    0%{background-position:-200% center}
    100%{background-position:200% center}
  }
  @keyframes glow {
    0%,100%{box-shadow:0 0 20px rgba(124,92,252,0.2)}
    50%{box-shadow:0 0 50px rgba(124,92,252,0.45)}
  }
  @keyframes ring {
    0%{transform:scale(0.8);opacity:1} 100%{transform:scale(2.2);opacity:0}
  }
  .fadeUp { animation:fadeUp 0.35s ease both }
  .spin   { animation:spin 1s linear infinite }
  .pulse  { animation:pulse 1.5s ease infinite }
  .glow   { animation:glow 2.5s ease infinite }

  .grad-text {
    background:linear-gradient(135deg,#a78bfa,#7c5cfc,#22d3a0);
    -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text;
  }
  .shimmer-text {
    background:linear-gradient(90deg,#a78bfa,#7c5cfc,#22d3a0,#7c5cfc,#a78bfa);
    background-size:200% auto;
    -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text;
    animation:shimmer 3s linear infinite;
  }
  .glass {
    background:rgba(13,13,20,0.85); backdrop-filter:blur(16px);
    border:1px solid var(--border);
  }
  .card {
    background:var(--surface); border:1px solid var(--border);
    border-radius:16px; padding:18px;
    transition:border-color 0.2s;
  }
  .card:hover { border-color:var(--border2) }
  .btn {
    display:inline-flex; align-items:center; gap:7px;
    font-family:'Syne',sans-serif; font-weight:700;
    cursor:pointer; border-radius:11px; border:none;
    transition:all 0.2s; padding:11px 20px; font-size:13px;
  }
  .btn-primary {
    background:linear-gradient(135deg,#7c5cfc,#5b3fd6); color:#fff;
  }
  .btn-primary:hover { transform:translateY(-1px); box-shadow:0 8px 30px rgba(124,92,252,0.4) }
  .btn-primary:disabled { opacity:0.45; cursor:not-allowed; transform:none }
  .btn-ghost {
    background:transparent; border:1px solid var(--border2); color:var(--text2);
  }
  .btn-ghost:hover { border-color:var(--accent); color:var(--accent2); background:rgba(124,92,252,0.08) }
  .btn-danger {
    background:transparent; border:1px solid rgba(244,63,94,0.3); color:var(--red);
  }
  .btn-danger:hover { background:rgba(244,63,94,0.08) }
  .input {
    background:rgba(13,13,20,0.9); border:1px solid var(--border2);
    color:var(--text); font-family:'Syne',sans-serif; font-size:0.95rem;
    border-radius:11px; padding:13px 16px; width:100%; outline:none;
    transition:border-color 0.2s, box-shadow 0.2s;
  }
  .input::placeholder { color:var(--text2) }
  .input:focus { border-color:var(--accent); box-shadow:0 0 0 3px rgba(124,92,252,0.15) }
  select.input {
    appearance:none; cursor:pointer;
    background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239991cc' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
    background-repeat:no-repeat; background-position:right 13px center; padding-right:36px;
  }
  .tag {
    display:inline-flex; align-items:center; gap:4px;
    padding:3px 9px; border-radius:6px; font-size:10px;
    font-weight:700; letter-spacing:0.5px; text-transform:uppercase;
    font-family:var(--mono);
  }
  .tag-green { background:rgba(34,211,160,0.1);  color:var(--green);  border:1px solid rgba(34,211,160,0.2) }
  .tag-red   { background:rgba(244,63,94,0.1);   color:var(--red);    border:1px solid rgba(244,63,94,0.2) }
  .tag-yellow{ background:rgba(251,191,36,0.1);  color:var(--yellow); border:1px solid rgba(251,191,36,0.2) }
  .tag-purple{ background:rgba(124,92,252,0.1);  color:var(--accent2);border:1px solid rgba(124,92,252,0.2) }
  .sb::-webkit-scrollbar{width:3px}
  .sb::-webkit-scrollbar-thumb{background:var(--border2);border-radius:2px}
  .grid-bg {
    background-image:
      linear-gradient(rgba(120,100,255,0.03) 1px,transparent 1px),
      linear-gradient(90deg,rgba(120,100,255,0.03) 1px,transparent 1px);
    background-size:40px 40px;
  }
  .dot-live {
    width:8px;height:8px;border-radius:50%;background:var(--green);position:relative;
  }
  .dot-live::after {
    content:'';position:absolute;inset:-4px;border-radius:50%;
    background:var(--green);opacity:0.3;animation:ring 1.5s ease-out infinite;
  }
`
function injectCSS() {
  if (!document.getElementById('us-css')) {
    const s = document.createElement('style')
    s.id = 'us-css'; s.textContent = CSS
    document.head.appendChild(s)
  }
}

// ── Small components ───────────────────────────────────────

function Orb({ x, y, size=350, color='#7c5cfc', opacity=0.1 }) {
  return <div style={{
    position:'fixed', left:x, top:y, width:size, height:size,
    borderRadius:'50%', background:`radial-gradient(circle,${color} 0%,transparent 70%)`,
    opacity, pointerEvents:'none', zIndex:0, filter:'blur(70px)',
  }}/>
}

function ProgressRing({ pct=0, size=60, stroke=5 }) {
  const r = (size-stroke)/2
  const circ = 2*Math.PI*r
  const offset = circ - (pct/100)*circ
  return (
    <svg width={size} height={size} style={{transform:'rotate(-90deg)'}}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(124,92,252,0.15)" strokeWidth={stroke}/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#7c5cfc" strokeWidth={stroke}
        strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={offset}
        style={{transition:'stroke-dashoffset 0.5s ease'}}/>
    </svg>
  )
}

function StatusBadge({ status }) {
  const map = {
    queued:    { cls:'tag-yellow', label:'QUEUED' },
    running:   { cls:'tag-purple', label:'RUNNING' },
    done:      { cls:'tag-green',  label:'DONE' },
    cancelled: { cls:'tag-red',    label:'CANCELLED' },
    error:     { cls:'tag-red',    label:'ERROR' },
  }
  const c = map[status] || map.queued
  return <span className={`tag ${c.cls}`}>{c.label}</span>
}

function EventLog({ events }) {
  const ref = useRef(null)
  const prevLen = useRef(0)
  if (events.length !== prevLen.current) {
    prevLen.current = events.length
    setTimeout(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight }, 50)
  }
  return (
    <div ref={ref} className="sb" style={{
      height:220, overflowY:'auto', fontFamily:'var(--mono)',
      fontSize:11, lineHeight:1.9, color:'var(--text2)',
    }}>
      {events.length === 0 && (
        <div style={{color:'rgba(153,145,204,0.35)',paddingTop:8}}>Waiting for activity…</div>
      )}
      {events.map((e,i) => (
        <div key={i} style={{
          display:'flex', gap:8,
          color: e.type==='success' ? 'var(--green)'
               : e.type==='error'   ? 'var(--red)'
               : e.type==='warn'    ? 'var(--yellow)'
               : 'var(--text2)',
          animation: i===events.length-1 ? 'fadeUp 0.25s ease' : 'none',
        }}>
          <span style={{opacity:0.45,minWidth:58}}>{e.time}</span>
          <span>{e.msg}</span>
        </div>
      ))}
    </div>
  )
}

function DataPreview({ results }) {
  const [sel, setSel] = useState(0)
  if (!results || results.length === 0) return (
    <div style={{textAlign:'center',padding:'36px 0',color:'var(--text2)'}}>
      <Eye size={28} style={{opacity:0.25,display:'block',margin:'0 auto 10px'}}/>
      <p style={{fontSize:13}}>Scraped data will appear here as pages complete</p>
    </div>
  )

  const item = results[Math.min(sel, results.length-1)]
  // data is nested: item.data.title, item.data.data.text etc
  const meta   = item?.data || {}
  const inner  = meta?.data || {}
  const title  = meta?.title || ''
  const texts  = inner?.text  || []
  const tables = inner?.tables || []
  const prices = inner?.prices || []
  const attrs  = inner?.attributes || {}
  const links  = meta?.links || []

  return (
    <div>
      {/* Page tabs */}
      <div style={{display:'flex',gap:6,marginBottom:14,flexWrap:'wrap'}}>
        {results.slice(0,5).map((r,i) => {
          let host = ''
          try { host = new URL(r?.url||'http://x').hostname.replace('www.','') } catch{}
          return (
            <button key={i} onClick={() => setSel(i)} className={`btn ${sel===i?'btn-primary':'btn-ghost'}`}
              style={{padding:'5px 12px',fontSize:11,fontFamily:'var(--mono)'}}>
              {i+1}. {host||'page'}
            </button>
          )
        })}
      </div>

      {/* URL */}
      <div style={{fontFamily:'var(--mono)',fontSize:10,color:'var(--text2)',marginBottom:10,wordBreak:'break-all'}}>
        <span style={{color:'var(--accent2)'}}>URL › </span>{item?.url}
      </div>

      {/* Title */}
      {title && (
        <div style={{fontSize:14,fontWeight:700,color:'var(--text)',marginBottom:12,lineHeight:1.4}}>
          {title}
        </div>
      )}

      {/* Text blocks */}
      {texts.slice(0,5).map((block,i) => (
        <div key={i} style={{
          padding:'7px 11px', marginBottom:5,
          background:'rgba(120,100,255,0.04)',
          borderLeft:`2px solid ${block.tag.startsWith('h')?'var(--accent)':'var(--border2)'}`,
          borderRadius:'0 6px 6px 0',
          fontSize: block.tag.startsWith('h') ? 13 : 12,
          fontWeight: block.tag.startsWith('h') ? 700 : 400,
          color: block.tag.startsWith('h') ? 'var(--text)' : 'var(--text2)',
          lineHeight:1.6,
        }}>
          <span style={{fontSize:9,color:'var(--accent2)',fontFamily:'var(--mono)',marginRight:7}}>
            {block.tag.toUpperCase()}
          </span>
          {block.text.substring(0,180)}{block.text.length>180?'…':''}
        </div>
      ))}

      {/* Table */}
      {tables[0] && (
        <div style={{overflowX:'auto',marginTop:10}}>
          <table style={{borderCollapse:'collapse',width:'100%',fontSize:11,fontFamily:'var(--mono)'}}>
            <tbody>
              {tables[0].slice(0,5).map((row,ri) => (
                <tr key={ri}>
                  {row.slice(0,5).map((cell,ci) => (
                    <td key={ci} style={{
                      padding:'4px 8px', border:'1px solid var(--border)',
                      background:ri===0?'rgba(124,92,252,0.1)':'transparent',
                      color:ri===0?'var(--accent2)':'var(--text2)',
                      maxWidth:140, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
                    }}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Prices */}
      {prices.length > 0 && (
        <div style={{marginTop:10,display:'flex',flexWrap:'wrap',gap:6}}>
          {prices.slice(0,6).map((p,i) => (
            <span key={i} className="tag tag-green">{p.values?.[0]}</span>
          ))}
        </div>
      )}

      {/* KV attrs */}
      {Object.keys(attrs).length > 0 && (
        <div style={{marginTop:10,display:'grid',gridTemplateColumns:'1fr 1fr',gap:4}}>
          {Object.entries(attrs).slice(0,6).map(([k,v]) => (
            <div key={k} style={{
              padding:'5px 8px', background:'rgba(120,100,255,0.04)',
              borderRadius:6, fontSize:11, fontFamily:'var(--mono)',
            }}>
              <span style={{color:'var(--accent2)'}}>{k}: </span>
              <span style={{color:'var(--text2)'}}>{String(v).substring(0,60)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Summary */}
      <div style={{marginTop:12,display:'flex',gap:10,flexWrap:'wrap'}}>
        {texts.length>0  && <span className="tag tag-purple">{texts.length} text blocks</span>}
        {tables.length>0 && <span className="tag tag-purple">{tables.length} tables</span>}
        {links.length>0  && <span className="tag tag-purple">{links.length} links</span>}
        {prices.length>0 && <span className="tag tag-green">{prices.length} prices</span>}
      </div>
    </div>
  )
}

function RateGauge({ rateStatus }) {
  if (!rateStatus || Object.keys(rateStatus).length === 0) return (
    <div style={{color:'var(--text2)',fontSize:12,textAlign:'center',padding:'16px 0'}}>
      Activates once scraping begins
    </div>
  )
  return (
    <div style={{display:'flex',flexDirection:'column',gap:10}}>
      {Object.entries(rateStatus).map(([domain, s]) => (
        <div key={domain}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
            <span style={{fontFamily:'var(--mono)',fontSize:11,color:'var(--accent2)'}}>{domain}</span>
            <span className={`tag ${s.error_rate>5?'tag-red':s.error_rate>2?'tag-yellow':'tag-green'}`}>
              {s.error_rate}% err
            </span>
          </div>
          <div style={{display:'flex',gap:20,fontSize:11,fontFamily:'var(--mono)',marginBottom:8}}>
            <div>
              <div style={{color:'var(--text2)',marginBottom:2}}>CONCURRENCY</div>
              <div style={{color:'var(--text)',fontSize:20,fontWeight:700}}>{s.concurrency}</div>
            </div>
            <div>
              <div style={{color:'var(--text2)',marginBottom:2}}>DELAY</div>
              <div style={{color:'var(--text)',fontSize:14,fontWeight:700}}>{s.delay_range?.[0]}s–{s.delay_range?.[1]}s</div>
            </div>
            <div>
              <div style={{color:'var(--text2)',marginBottom:2}}>SAMPLES</div>
              <div style={{color:'var(--text)',fontSize:20,fontWeight:700}}>{s.samples}</div>
            </div>
          </div>
          <div style={{height:3,background:'var(--border)',borderRadius:2}}>
            <div style={{
              height:'100%',
              width:`${Math.min(100,(s.concurrency/20)*100)}%`,
              background:s.error_rate>5?'var(--red)':'linear-gradient(90deg,#7c5cfc,#22d3a0)',
              borderRadius:2, transition:'width 0.5s ease',
            }}/>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Main App ───────────────────────────────────────────────

export default function App() {
  injectCSS()

  const [view,          setView]          = useState('home')
  const [target,        setTarget]        = useState('')
  const [dataType,      setDataType]      = useState('auto')
  const [maxItems,      setMaxItems]      = useState(20)
  const [concurrency,   setConcurrency]   = useState(3)
  const [loading,       setLoading]       = useState(false)
  const [activeJob,     setActiveJob]     = useState(null)
  const [events,        setEvents]        = useState([])
  const [sampleResults, setSampleResults] = useState([])
  const [rateStatus,    setRateStatus]    = useState({})
  const [progress,      setProgress]      = useState({ completed:0, failed:0, total:0 })
  const [urls,          setUrls]          = useState([])
  const [activeTab,     setActiveTab]     = useState('preview')
  const wsRef = useRef(null)

  const addEvent = useCallback((msg, type='info') => {
    const time = new Date().toLocaleTimeString('en',{hour12:false})
    setEvents(ev => [...ev.slice(-200), { msg, type, time }])
  }, [])

  const connectWS = useCallback((jobId) => {
    if (wsRef.current) wsRef.current.close()
    const ws = new WebSocket(`${WS_BASE}/ws/${jobId}`)
    wsRef.current = ws

    ws.onmessage = (e) => {
      const d = JSON.parse(e.data)
      if (d.event === 'ping') return

      if (d.event === 'start') {
        addEvent(`Job started — ${d.job?.total} URLs queued`, 'info')

      } else if (d.event === 'progress') {
        setProgress({ completed:d.completed, failed:d.failed, total:d.total })
        if (d.rate_status) setRateStatus(d.rate_status)

        if (d.latest_status === 'done') {
          addEvent(`✓ ${(d.latest_url||'').substring(0,70)}`, 'success')
          if (d.sample) setSampleResults(s => [...s.slice(-8), d.sample])
        } else if (d.latest_status === 'error') {
          addEvent(`✗ ${(d.latest_url||'').substring(0,70)}`, 'error')
        } else if (d.latest_status === 'rate_limited') {
          addEvent('⚠ Rate limited — AIMD throttling down', 'warn')
        }

      } else if (d.event === 'done') {
        addEvent(`Complete: ${d.job?.completed} pages scraped`, 'success')
        setActiveJob(j => ({ ...j, ...d.job }))

      } else if (d.event === 'state') {
        if (d.job) {
          setActiveJob(d.job)
          setProgress({ completed:d.job.completed, failed:d.job.failed, total:d.job.total })
          if (d.job.rate_status) setRateStatus(d.job.rate_status)
          if (d.job.sample_results?.length) setSampleResults(d.job.sample_results)
        }
      }
    }
    ws.onclose = () => addEvent('WebSocket disconnected', 'warn')
    ws.onerror = () => addEvent('WebSocket error', 'error')
  }, [addEvent])

  const handleStart = async () => {
    if (!target.trim()) return
    setLoading(true)
    setEvents([])
    setSampleResults([])
    setRateStatus({})
    setProgress({ completed:0, failed:0, total:0 })
    setUrls([])

    try {
      // Strip any accidental quotes from the target
      const cleanTarget = target.trim().replace(/^["']|["']$/g, '')
      addEvent(`Resolving: ${cleanTarget}`, 'info')

      const res = await fetch(`${API}/api/jobs/create`, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          target: cleanTarget,
          data_type: dataType,
          max_items: maxItems,
          concurrency,
        }),
      })
      const job = await res.json()

      if (job.error) { addEvent(`Error: ${job.error}`, 'error'); return }

      setUrls(job.urls || [])
      addEvent(`Discovered ${job.count} URLs`, 'success')
      setActiveJob({ id:job.job_id, status:'queued', total:job.count })
      setView('job')

      connectWS(job.job_id)

      await fetch(`${API}/api/jobs/${job.job_id}/start`, { method:'POST' })
      addEvent('Scrape engine running — AIMD rate controller active', 'info')

    } catch(err) {
      addEvent(`Connection error: ${err.message}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleCancel = async () => {
    if (!activeJob) return
    await fetch(`${API}/api/jobs/${activeJob.id}/cancel`, { method:'POST' })
    addEvent('Cancelled by user', 'warn')
  }

  const handleDownload = async () => {
    if (!activeJob) return
    const res  = await fetch(`${API}/api/jobs/${activeJob.id}/results?limit=1000`)
    const data = await res.json()
    const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'})
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = `ultrascrap-${activeJob.id.slice(0,8)}.json`
    a.click(); URL.revokeObjectURL(url)
  }

  const pct       = progress.total > 0 ? Math.round((progress.completed+progress.failed)/progress.total*100) : 0
  const isRunning = activeJob?.status === 'running'
  const isDone    = activeJob?.status === 'done'

  // ── HOME ────────────────────────────────────────────────
  if (view === 'home') return (
    <div className="grid-bg" style={{minHeight:'100vh',position:'relative',fontFamily:"'Syne',sans-serif"}}>
      <Orb x="-80px"  y="-80px"  color="#7c5cfc" size={500} opacity={0.08}/>
      <Orb x="65%"    y="15%"    color="#22d3a0" size={400} opacity={0.05}/>
      <Orb x="80%"    y="70%"    color="#f43f5e" size={300} opacity={0.04}/>

      {/* Header */}
      <header style={{
        position:'relative',zIndex:1,
        padding:'18px 36px',
        display:'flex',alignItems:'center',justifyContent:'space-between',
        borderBottom:'1px solid var(--border)',
        backdropFilter:'blur(20px)',
      }}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <div style={{
            width:34,height:34,borderRadius:9,
            background:'linear-gradient(135deg,#7c5cfc,#22d3a0)',
            display:'flex',alignItems:'center',justifyContent:'center',
          }}>
            <Zap size={17} fill="white" color="white"/>
          </div>
          <span style={{fontWeight:800,fontSize:17,letterSpacing:'-0.4px'}}>
            Ultra<span className="grad-text">Scrap</span>
          </span>
        </div>
        <span className="tag tag-green">
          <span style={{width:6,height:6,borderRadius:'50%',background:'var(--green)',display:'inline-block'}}/>
          ADAPTIVE ENGINE v1.0
        </span>
      </header>

      {/* Hero */}
      <main style={{
        position:'relative',zIndex:1,maxWidth:860,margin:'0 auto',
        padding:'70px 24px 50px',textAlign:'center',
      }}>
        <h1 style={{
          fontSize:'clamp(2.4rem,5.5vw,4.5rem)',fontWeight:800,
          lineHeight:1.06,letterSpacing:'-2px',marginBottom:18,
        }}>
          <span className="shimmer-text">Intelligent</span><br/>
          <span style={{color:'var(--text)'}}>Web Scraping</span>
        </h1>
        <p style={{
          fontSize:'clamp(0.9rem,1.8vw,1.1rem)',color:'var(--text2)',
          maxWidth:560,margin:'0 auto 44px',lineHeight:1.75,
        }}>
          Adaptive AIMD rate control · Behavioral simulation · Universal extraction.
          Paste any URL or type a topic — it figures the rest out.
        </p>

        {/* Form */}
        <div className="glass glow" style={{borderRadius:20,padding:26,maxWidth:680,margin:'0 auto'}}>
          <div style={{marginBottom:14}}>
            <input className="input"
              placeholder='URL or topic — e.g. https://en.wikipedia.org/wiki/Python or "python language"'
              value={target}
              onChange={e => setTarget(e.target.value)}
              onKeyDown={e => e.key==='Enter' && handleStart()}
            />
          </div>

          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,marginBottom:18}}>
            {[
              { label:'DATA TYPE', el: (
                <select className="input" value={dataType} onChange={e=>setDataType(e.target.value)}
                  style={{padding:'9px 13px',fontSize:12}}>
                  {DATA_TYPES.map(d=><option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
              )},
              { label:'MAX PAGES', el: (
                <input type="number" className="input" min={1} max={200} value={maxItems}
                  onChange={e=>setMaxItems(Number(e.target.value))}
                  style={{padding:'9px 13px',fontSize:12}}/>
              )},
              { label:'CONCURRENCY', el: (
                <input type="number" className="input" min={1} max={10} value={concurrency}
                  onChange={e=>setConcurrency(Number(e.target.value))}
                  style={{padding:'9px 13px',fontSize:12}}/>
              )},
            ].map(({label,el}) => (
              <div key={label}>
                <div style={{fontSize:10,color:'var(--text2)',fontFamily:'var(--mono)',marginBottom:5}}>{label}</div>
                {el}
              </div>
            ))}
          </div>

          <button className="btn btn-primary" onClick={handleStart}
            disabled={loading||!target.trim()}
            style={{width:'100%',padding:'14px',fontSize:'0.95rem',justifyContent:'center'}}>
            {loading
              ? <><Loader2 size={17} className="spin"/> Initialising…</>
              : <><Zap size={17}/> Launch Scraper</>
            }
          </button>
        </div>

        {/* Feature cards */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:10,marginTop:40,textAlign:'left'}}>
          {[
            {icon:Activity, title:'AIMD Rate Control', desc:'Auto scales concurrency based on site response'},
            {icon:Globe,    title:'Universal Extraction', desc:'Text, tables, prices, links — all auto-detected'},
            {icon:Layers,   title:'Stealth Profiles',  desc:'Real fingerprints, Bézier mouse, human scroll'},
            {icon:BarChart3,title:'Live Telemetry',    desc:'Real-time error rate and concurrency dashboard'},
          ].map(({icon:Icon,title,desc}) => (
            <div key={title} className="card" style={{padding:14}}>
              <Icon size={18} style={{color:'var(--accent2)',marginBottom:7}}/>
              <div style={{fontWeight:700,fontSize:11,color:'var(--text)',marginBottom:4,fontFamily:'var(--mono)'}}>{title}</div>
              <div style={{fontSize:11,color:'var(--text2)',lineHeight:1.55}}>{desc}</div>
            </div>
          ))}
        </div>
      </main>
    </div>
  )

  // ── JOB VIEW ────────────────────────────────────────────
  return (
    <div className="grid-bg" style={{minHeight:'100vh',position:'relative',fontFamily:"'Syne',sans-serif"}}>
      <Orb x="-60px" y="5%"  color="#7c5cfc" size={400} opacity={0.06}/>
      <Orb x="70%"   y="55%" color="#22d3a0" size={350} opacity={0.04}/>

      {/* Sticky header */}
      <header style={{
        position:'sticky',top:0,zIndex:100,
        padding:'13px 24px',
        display:'flex',alignItems:'center',justifyContent:'space-between',
        borderBottom:'1px solid var(--border)',
        backdropFilter:'blur(20px)',
        background:'rgba(5,5,8,0.88)',
      }}>
        <div style={{display:'flex',alignItems:'center',gap:14}}>
          <button className="btn btn-ghost" onClick={()=>setView('home')}
            style={{padding:'6px 13px',fontSize:12}}>
            <ArrowRight size={11} style={{transform:'rotate(180deg)'}}/> Back
          </button>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            {isRunning && <div className="dot-live"/>}
            <span style={{fontWeight:700,fontSize:13}}>
              {isRunning?'Scraping…':isDone?'Complete':'Preparing'}
            </span>
            {activeJob && <StatusBadge status={activeJob.status}/>}
          </div>
        </div>
        <div style={{display:'flex',gap:8}}>
          {isDone && (
            <button className="btn btn-ghost" onClick={handleDownload} style={{padding:'7px 14px',fontSize:12}}>
              <Download size={12}/> Export JSON
            </button>
          )}
          {isRunning && (
            <button className="btn btn-danger" onClick={handleCancel} style={{padding:'7px 14px',fontSize:12}}>
              <X size={12}/> Cancel
            </button>
          )}
          <button className="btn btn-ghost" onClick={()=>setView('home')} style={{padding:'7px 14px',fontSize:12}}>
            <RefreshCw size={12}/> New Scrape
          </button>
        </div>
      </header>

      <div style={{maxWidth:1280,margin:'0 auto',padding:'20px',position:'relative',zIndex:1}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 340px',gap:18}}>

          {/* LEFT */}
          <div style={{display:'flex',flexDirection:'column',gap:14}}>

            {/* Stats */}
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10}}>
              {[
                {label:'SCRAPED',  val:progress.completed, color:'var(--green)'},
                {label:'FAILED',   val:progress.failed,    color:'var(--red)'},
                {label:'TOTAL',    val:progress.total,     color:'var(--accent2)'},
                {label:'PROGRESS', val:`${pct}%`,          color:'var(--text)'},
              ].map(({label,val,color}) => (
                <div key={label} className="card" style={{textAlign:'center',padding:'14px 10px'}}>
                  <div style={{fontSize:10,color:'var(--text2)',fontFamily:'var(--mono)',marginBottom:5}}>{label}</div>
                  <div style={{fontFamily:'var(--mono)',fontSize:'1.7rem',fontWeight:700,color,letterSpacing:'-1px'}}>{val}</div>
                </div>
              ))}
            </div>

            {/* Progress bar */}
            <div className="card" style={{padding:'14px 18px'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
                <span style={{fontSize:11,color:'var(--text2)',fontFamily:'var(--mono)'}}>EXTRACTION PROGRESS</span>
                <ProgressRing pct={pct} size={44} stroke={4}/>
              </div>
              <div style={{height:5,background:'var(--border)',borderRadius:3,overflow:'hidden'}}>
                <div style={{
                  height:'100%', width:`${pct}%`,
                  background:'linear-gradient(90deg,#7c5cfc,#22d3a0)',
                  borderRadius:3, transition:'width 0.6s ease',
                  position:'relative',overflow:'hidden',
                }}>
                  {isRunning && <div style={{
                    position:'absolute',inset:0,
                    background:'linear-gradient(90deg,transparent,rgba(255,255,255,0.3),transparent)',
                    animation:'shimmer 1.5s linear infinite',backgroundSize:'200% 100%',
                  }}/>}
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div className="card" style={{padding:0,overflow:'hidden'}}>
              <div style={{display:'flex',borderBottom:'1px solid var(--border)'}}>
                {[
                  {id:'preview', label:'Data Preview',       icon:Eye},
                  {id:'log',     label:'Activity Log',       icon:Activity},
                  {id:'urls',    label:`URLs (${urls.length})`, icon:Globe},
                ].map(({id,label,icon:Icon}) => (
                  <button key={id} onClick={()=>setActiveTab(id)} style={{
                    padding:'13px 18px', background:'none', border:'none',
                    borderBottom:`2px solid ${activeTab===id?'var(--accent)':'transparent'}`,
                    color:activeTab===id?'var(--text)':'var(--text2)',
                    cursor:'pointer', fontSize:12, fontFamily:'Syne,sans-serif',
                    fontWeight:activeTab===id?700:400,
                    display:'flex',alignItems:'center',gap:6,
                    marginBottom:-1, transition:'all 0.2s',
                  }}>
                    <Icon size={12}/>{label}
                  </button>
                ))}
              </div>
              <div style={{padding:18}}>
                {activeTab==='preview' && <DataPreview results={sampleResults}/>}
                {activeTab==='log'     && <EventLog events={events}/>}
                {activeTab==='urls'    && (
                  <div className="sb" style={{maxHeight:280,overflowY:'auto'}}>
                    {urls.slice(0,200).map((u,i) => (
                      <div key={i} className="fadeUp" style={{
                        display:'flex',gap:8,padding:'5px 0',
                        borderBottom:'1px solid var(--border)',
                        fontSize:11,fontFamily:'var(--mono)',color:'var(--text2)',
                        animationDelay:`${Math.min(i*15,400)}ms`,
                      }}>
                        <span style={{color:'var(--accent2)',minWidth:26}}>{i+1}.</span>
                        <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{u}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* RIGHT */}
          <div style={{display:'flex',flexDirection:'column',gap:14}}>

            {/* Target info */}
            <div className="card">
              <div style={{fontSize:10,color:'var(--text2)',fontFamily:'var(--mono)',marginBottom:7}}>TARGET</div>
              <div style={{fontSize:12,wordBreak:'break-all',color:'var(--text)',lineHeight:1.55}}>{target}</div>
              <div style={{marginTop:10,display:'flex',gap:5,flexWrap:'wrap'}}>
                <span className="tag tag-purple">{dataType}</span>
                <span className="tag tag-purple">max {maxItems}</span>
                <span className="tag tag-purple">×{concurrency}</span>
              </div>
            </div>

            {/* Rate controller */}
            <div className="card">
              <div style={{display:'flex',alignItems:'center',gap:7,marginBottom:12}}>
                <Activity size={13} style={{color:'var(--accent2)'}}/>
                <span style={{fontSize:11,fontWeight:700,fontFamily:'var(--mono)',color:'var(--text2)'}}>
                  AIMD RATE CONTROLLER
                </span>
              </div>
              <RateGauge rateStatus={rateStatus}/>
            </div>

            {/* Pipeline steps */}
            <div className="card">
              <div style={{fontSize:10,color:'var(--text2)',fontFamily:'var(--mono)',marginBottom:12}}>PIPELINE</div>
              {[
                {label:'URL Discovery',     done:urls.length>0},
                {label:'Browser Init',      done:progress.completed+progress.failed>0},
                {label:'Stealth Profile',   done:progress.completed+progress.failed>0},
                {label:'Content Fetch',     done:progress.completed>0,   active:isRunning},
                {label:'Rate Adaptation',   done:Object.keys(rateStatus).length>0, active:isRunning},
                {label:'Data Structuring',  done:sampleResults.length>0},
                {label:'Export Ready',      done:isDone},
              ].map(({label,done,active}) => (
                <div key={label} style={{
                  display:'flex',alignItems:'center',gap:9,
                  padding:'7px 0',borderBottom:'1px solid var(--border)',fontSize:12,
                }}>
                  <div style={{
                    width:18,height:18,borderRadius:'50%',flexShrink:0,
                    display:'flex',alignItems:'center',justifyContent:'center',
                    background: done?'rgba(34,211,160,0.12)':active?'rgba(124,92,252,0.12)':'var(--surface2)',
                    border:`1px solid ${done?'var(--green)':active?'var(--accent)':'var(--border)'}`,
                    transition:'all 0.35s',
                  }}>
                    {done
                      ? <CheckCircle2 size={10} style={{color:'var(--green)'}}/>
                      : active
                        ? <Loader2 size={10} style={{color:'var(--accent2)'}} className="spin"/>
                        : <Clock size={10} style={{color:'var(--text2)',opacity:0.4}}/>
                    }
                  </div>
                  <span style={{
                    color:done?'var(--text)':active?'var(--accent2)':'var(--text2)',
                    fontWeight:done||active?600:400, transition:'color 0.3s',
                  }}>{label}</span>
                </div>
              ))}
            </div>

          </div>
        </div>
      </div>
    </div>
  )
}

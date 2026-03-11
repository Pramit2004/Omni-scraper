import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  Zap, Globe, Activity, ChevronRight, X, Download,
  CheckCircle2, Clock, AlertCircle, Loader2, Eye,
  BarChart3, Layers, Settings2, ArrowRight, Copy, RefreshCw
} from 'lucide-react'

// ── Constants ──────────────────────────────────────────────────────────────
const API = 'http://localhost:8000'
const WS_BASE = 'ws://localhost:8000'

const DATA_TYPES = [
  { value: 'auto', label: 'Auto Detect', desc: 'Intelligently extracts all data types' },
  { value: 'text', label: 'Text & Content', desc: 'Articles, paragraphs, headings' },
  { value: 'table', label: 'Tables & Data', desc: 'Structured tabular data' },
  { value: 'links', label: 'Links', desc: 'All hyperlinks with anchor text' },
  { value: 'images', label: 'Images', desc: 'Image URLs and metadata' },
]

// ── Styles (injected once) ─────────────────────────────────────────────────
const CSS = `
  :root {
    --bg: #050508;
    --surface: #0d0d14;
    --surface2: #13131e;
    --border: rgba(120,100,255,0.15);
    --border2: rgba(120,100,255,0.25);
    --accent: #7c5cfc;
    --accent2: #a78bfa;
    --green: #22d3a0;
    --red: #f43f5e;
    --yellow: #fbbf24;
    --text: #e8e6ff;
    --text2: #9991cc;
    --mono: 'DM Mono', 'Space Mono', monospace;
  }

  @keyframes pulse-ring {
    0%   { transform: scale(0.8); opacity:1 }
    100% { transform: scale(2.2); opacity:0 }
  }
  @keyframes scan-line {
    0%   { top: 0; opacity: 0.7 }
    100% { top: 100%; opacity: 0 }
  }
  @keyframes float {
    0%, 100% { transform: translateY(0) }
    50%       { transform: translateY(-8px) }
  }
  @keyframes shimmer {
    0%   { background-position: -200% center }
    100% { background-position: 200% center }
  }
  @keyframes glow-pulse {
    0%, 100% { box-shadow: 0 0 20px rgba(124,92,252,0.2) }
    50%       { box-shadow: 0 0 40px rgba(124,92,252,0.5), 0 0 80px rgba(124,92,252,0.1) }
  }
  @keyframes spin-slow {
    from { transform: rotate(0deg) }
    to   { transform: rotate(360deg) }
  }
  @keyframes slide-in-up {
    from { opacity:0; transform: translateY(20px) }
    to   { opacity:1; transform: translateY(0) }
  }
  @keyframes data-flow {
    0%   { stroke-dashoffset: 1000 }
    100% { stroke-dashoffset: 0 }
  }
  @keyframes blink {
    0%,100% { opacity:1 } 50% { opacity:0 }
  }
  @keyframes progress-bar {
    from { width: 0% }
  }

  .slide-in { animation: slide-in-up 0.4s ease both }
  .float-anim { animation: float 3s ease-in-out infinite }
  .glow-anim  { animation: glow-pulse 2s ease-in-out infinite }

  .gradient-text {
    background: linear-gradient(135deg, #a78bfa 0%, #7c5cfc 40%, #22d3a0 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .shimmer-text {
    background: linear-gradient(90deg, #a78bfa 0%, #7c5cfc 30%, #22d3a0 50%, #7c5cfc 70%, #a78bfa 100%);
    background-size: 200% auto;
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    animation: shimmer 3s linear infinite;
  }

  .glass {
    background: rgba(13,13,20,0.8);
    backdrop-filter: blur(16px);
    border: 1px solid var(--border);
  }

  .btn-primary {
    background: linear-gradient(135deg, #7c5cfc, #5b3fd6);
    border: none;
    color: white;
    font-family: 'Syne', sans-serif;
    font-weight: 700;
    cursor: pointer;
    border-radius: 12px;
    transition: all 0.2s;
    position: relative;
    overflow: hidden;
  }
  .btn-primary::before {
    content:'';
    position:absolute;inset:0;
    background: linear-gradient(135deg, rgba(255,255,255,0.1), transparent);
    opacity: 0;
    transition: opacity 0.2s;
  }
  .btn-primary:hover::before { opacity:1 }
  .btn-primary:hover { transform: translateY(-1px); box-shadow: 0 8px 32px rgba(124,92,252,0.4) }
  .btn-primary:active { transform: translateY(0) }
  .btn-primary:disabled { opacity:0.5; cursor:not-allowed; transform:none }

  .btn-ghost {
    background: transparent;
    border: 1px solid var(--border2);
    color: var(--text2);
    font-family: 'Syne', sans-serif;
    cursor: pointer;
    border-radius: 10px;
    transition: all 0.2s;
  }
  .btn-ghost:hover {
    border-color: var(--accent);
    color: var(--accent2);
    background: rgba(124,92,252,0.08);
  }

  .input-field {
    background: rgba(13,13,20,0.9);
    border: 1px solid var(--border2);
    color: var(--text);
    font-family: 'Syne', sans-serif;
    font-size: 1rem;
    border-radius: 12px;
    padding: 14px 18px;
    width: 100%;
    outline: none;
    transition: border-color 0.2s, box-shadow 0.2s;
  }
  .input-field::placeholder { color: var(--text2); }
  .input-field:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px rgba(124,92,252,0.15);
  }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 20px;
    transition: border-color 0.2s;
  }
  .card:hover { border-color: var(--border2) }

  .stat-value {
    font-family: var(--mono);
    font-size: 2rem;
    font-weight: 700;
    letter-spacing: -1px;
  }

  .tag {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 10px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    font-family: var(--mono);
  }
  .tag-green { background: rgba(34,211,160,0.12); color: var(--green); border: 1px solid rgba(34,211,160,0.2) }
  .tag-red   { background: rgba(244,63,94,0.12);  color: var(--red);   border: 1px solid rgba(244,63,94,0.2) }
  .tag-yellow{ background: rgba(251,191,36,0.12); color: var(--yellow);border: 1px solid rgba(251,191,36,0.2) }
  .tag-purple{ background: rgba(124,92,252,0.12); color: var(--accent2);border: 1px solid rgba(124,92,252,0.2) }

  .scrollbar::-webkit-scrollbar { width: 4px }
  .scrollbar::-webkit-scrollbar-track { background: transparent }
  .scrollbar::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 2px }

  .progress-ring {
    transform: rotate(-90deg);
    transform-origin: center;
  }
  .progress-ring circle {
    transition: stroke-dashoffset 0.5s ease;
  }

  .activity-dot {
    width: 8px; height: 8px;
    border-radius: 50%;
    background: var(--green);
    position: relative;
  }
  .activity-dot::after {
    content:'';
    position:absolute;
    inset: -4px;
    border-radius: 50%;
    background: var(--green);
    opacity: 0.3;
    animation: pulse-ring 1.5s ease-out infinite;
  }

  .grid-bg {
    background-image:
      linear-gradient(rgba(120,100,255,0.03) 1px, transparent 1px),
      linear-gradient(90deg, rgba(120,100,255,0.03) 1px, transparent 1px);
    background-size: 40px 40px;
  }

  .noise-overlay {
    position: fixed; inset: 0; pointer-events: none; z-index: 0;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.04'/%3E%3C/svg%3E");
    opacity: 0.4;
  }

  select.input-field {
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239991cc' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 14px center;
    padding-right: 40px;
  }
`

function injectCSS() {
  if (document.getElementById('ultrascrap-styles')) return
  const el = document.createElement('style')
  el.id = 'ultrascrap-styles'
  el.textContent = CSS
  document.head.appendChild(el)
}

// ── Subcomponents ──────────────────────────────────────────────────────────

function Orb({ size = 300, x, y, color = '#7c5cfc', opacity = 0.12 }) {
  return (
    <div style={{
      position: 'fixed', left: x, top: y,
      width: size, height: size,
      borderRadius: '50%',
      background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
      opacity, pointerEvents: 'none', zIndex: 0,
      filter: 'blur(60px)',
    }} />
  )
}

function RadarAnimation() {
  return (
    <div style={{ position: 'relative', width: 120, height: 120 }}>
      {[1, 2, 3].map(i => (
        <div key={i} style={{
          position: 'absolute',
          inset: `${i * 16}px`,
          borderRadius: '50%',
          border: '1px solid rgba(124,92,252,0.2)',
        }} />
      ))}
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Zap size={28} style={{ color: '#7c5cfc' }} />
      </div>
    </div>
  )
}

function ProgressRing({ pct = 0, size = 80, stroke = 6 }) {
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const offset = circ - (pct / 100) * circ
  return (
    <svg width={size} height={size} className="progress-ring">
      <circle cx={size/2} cy={size/2} r={r}
        fill="none" stroke="rgba(124,92,252,0.15)" strokeWidth={stroke} />
      <circle cx={size/2} cy={size/2} r={r}
        fill="none" stroke="#7c5cfc" strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={offset} />
    </svg>
  )
}

function StatusBadge({ status }) {
  const configs = {
    queued:      { cls: 'tag-yellow', label: 'QUEUED',    icon: Clock },
    running:     { cls: 'tag-purple', label: 'RUNNING',   icon: Loader2 },
    done:        { cls: 'tag-green',  label: 'DONE',      icon: CheckCircle2 },
    cancelled:   { cls: 'tag-red',    label: 'CANCELLED', icon: X },
    error:       { cls: 'tag-red',    label: 'ERROR',     icon: AlertCircle },
  }
  const cfg = configs[status] || configs.queued
  const Icon = cfg.icon
  return (
    <span className={`tag ${cfg.cls}`}>
      <Icon size={10} className={status === 'running' ? 'spin-slow' : ''} />
      {cfg.label}
    </span>
  )
}

function EventLog({ events }) {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [events])

  return (
    <div ref={ref}
      className="scrollbar"
      style={{
        height: 200, overflowY: 'auto',
        fontFamily: 'var(--mono)', fontSize: 11,
        lineHeight: 1.8,
        color: 'var(--text2)',
      }}>
      {events.map((e, i) => (
        <div key={i} style={{
          display: 'flex', gap: 8,
          color: e.type === 'success' ? 'var(--green)'
               : e.type === 'error'   ? 'var(--red)'
               : e.type === 'warn'    ? 'var(--yellow)'
               : 'var(--text2)',
          animation: i === events.length - 1 ? 'slide-in-up 0.3s ease' : 'none',
        }}>
          <span style={{ opacity: 0.5, minWidth: 60 }}>{e.time}</span>
          <span style={{ opacity: 0.6 }}>{e.type === 'success' ? '✓' : e.type === 'error' ? '✗' : e.type === 'warn' ? '⚠' : '›'}</span>
          <span>{e.msg}</span>
        </div>
      ))}
      {events.length === 0 && (
        <div style={{ color: 'rgba(153,145,204,0.4)', paddingTop: 8 }}>
          Waiting for scrape activity...
        </div>
      )}
    </div>
  )
}

function DataPreview({ results }) {
  const [selected, setSelected] = useState(0)
  if (!results || results.length === 0) return (
    <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text2)' }}>
      <Eye size={32} style={{ opacity: 0.3, marginBottom: 8 }} />
      <p style={{ fontSize: 13 }}>Sample data will appear here as pages are scraped</p>
    </div>
  )

  const item = results[selected]
  const data = item?.data || {}

  return (
    <div style={{ animation: 'slide-in-up 0.4s ease' }}>
      {/* Tab selector */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {results.slice(0, 4).map((r, i) => (
          <button key={i} onClick={() => setSelected(i)}
            className="btn-ghost"
            style={{
              padding: '6px 12px', fontSize: 11,
              fontFamily: 'var(--mono)',
              background: selected === i ? 'rgba(124,92,252,0.15)' : undefined,
              borderColor: selected === i ? 'var(--accent)' : undefined,
              color: selected === i ? 'var(--accent2)' : undefined,
              maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
            {i + 1}. {r?.data?.title || new URL(r?.url || 'http://x').hostname}
          </button>
        ))}
      </div>

      {/* URL */}
      <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text2)', marginBottom: 12, wordBreak: 'break-all' }}>
        <span style={{ color: 'var(--accent2)' }}>URL › </span>{item?.url}
      </div>

      {/* Title */}
      {data.title && (
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>
          {data.title}
        </div>
      )}

      {/* Text blocks */}
      {data.text?.slice(0, 5).map((block, i) => (
        <div key={i} style={{
          padding: '8px 12px',
          marginBottom: 6,
          background: 'rgba(120,100,255,0.04)',
          borderLeft: `2px solid ${block.tag.startsWith('h') ? 'var(--accent)' : 'var(--border2)'}`,
          borderRadius: '0 6px 6px 0',
          fontSize: block.tag.startsWith('h') ? 13 : 12,
          fontWeight: block.tag.startsWith('h') ? 700 : 400,
          color: block.tag.startsWith('h') ? 'var(--text)' : 'var(--text2)',
          lineHeight: 1.6,
        }}>
          <span style={{ fontSize: 9, color: 'var(--accent2)', fontFamily: 'var(--mono)', marginRight: 8 }}>
            {block.tag.toUpperCase()}
          </span>
          {block.text.substring(0, 200)}{block.text.length > 200 ? '…' : ''}
        </div>
      ))}

      {/* Tables */}
      {data.tables && data.tables[0] && (
        <div style={{ overflowX: 'auto', marginTop: 8 }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11, fontFamily: 'var(--mono)' }}>
            <tbody>
              {data.tables[0].slice(0, 6).map((row, ri) => (
                <tr key={ri}>
                  {row.slice(0, 5).map((cell, ci) => (
                    <td key={ci} style={{
                      padding: '4px 8px',
                      border: '1px solid var(--border)',
                      background: ri === 0 ? 'rgba(124,92,252,0.1)' : 'transparent',
                      color: ri === 0 ? 'var(--accent2)' : 'var(--text2)',
                      maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Prices */}
      {data.prices?.length > 0 && (
        <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {data.prices.slice(0, 6).map((p, i) => (
            <span key={i} className="tag tag-green">{p.values[0]}</span>
          ))}
        </div>
      )}
    </div>
  )
}

function RateGauge({ rateStatus }) {
  if (!rateStatus || Object.keys(rateStatus).length === 0) return (
    <div style={{ color: 'var(--text2)', fontSize: 12, textAlign: 'center', padding: '20px 0' }}>
      Rate controller will activate once scraping starts
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {Object.entries(rateStatus).map(([domain, stats]) => (
        <div key={domain} className="card" style={{ padding: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--accent2)' }}>
              {domain}
            </span>
            <span className={`tag ${stats.error_rate > 5 ? 'tag-red' : stats.error_rate > 2 ? 'tag-yellow' : 'tag-green'}`}>
              {stats.error_rate}% err
            </span>
          </div>
          <div style={{ display: 'flex', gap: 16, fontSize: 11, fontFamily: 'var(--mono)' }}>
            <div>
              <div style={{ color: 'var(--text2)' }}>CONCURRENCY</div>
              <div style={{ color: 'var(--text)', fontSize: 18, fontWeight: 700 }}>{stats.concurrency}</div>
            </div>
            <div>
              <div style={{ color: 'var(--text2)' }}>DELAY RANGE</div>
              <div style={{ color: 'var(--text)', fontSize: 13, fontWeight: 700 }}>
                {stats.delay_range?.[0]}s — {stats.delay_range?.[1]}s
              </div>
            </div>
            <div>
              <div style={{ color: 'var(--text2)' }}>SAMPLES</div>
              <div style={{ color: 'var(--text)', fontSize: 18, fontWeight: 700 }}>{stats.samples}</div>
            </div>
          </div>
          {/* AIMD bar */}
          <div style={{ marginTop: 8, height: 3, background: 'var(--border)', borderRadius: 2 }}>
            <div style={{
              height: '100%',
              width: `${Math.min(100, (stats.concurrency / 20) * 100)}%`,
              background: stats.error_rate > 5 ? 'var(--red)' : 'var(--accent)',
              borderRadius: 2,
              transition: 'width 0.5s ease',
            }} />
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Main App ───────────────────────────────────────────────────────────────

export default function App() {
  injectCSS()

  const [view, setView] = useState('home') // home | job
  const [target, setTarget] = useState('')
  const [dataType, setDataType] = useState('auto')
  const [maxItems, setMaxItems] = useState(20)
  const [concurrency, setConcurrency] = useState(3)
  const [loading, setLoading] = useState(false)
  const [activeJob, setActiveJob] = useState(null)
  const [events, setEvents] = useState([])
  const [sampleResults, setSampleResults] = useState([])
  const [rateStatus, setRateStatus] = useState({})
  const [progress, setProgress] = useState({ completed: 0, failed: 0, total: 0 })
  const [discoveredUrls, setDiscoveredUrls] = useState([])
  const [activeTab, setActiveTab] = useState('preview')
  const wsRef = useRef(null)

  const addEvent = useCallback((msg, type = 'info') => {
    const time = new Date().toLocaleTimeString('en', { hour12: false })
    setEvents(ev => [...ev.slice(-200), { msg, type, time }])
  }, [])

  const connectWS = useCallback((jobId) => {
    if (wsRef.current) wsRef.current.close()
    const ws = new WebSocket(`${WS_BASE}/ws/${jobId}`)
    wsRef.current = ws

    ws.onmessage = (e) => {
      const data = JSON.parse(e.data)
      if (data.event === 'ping') return

      if (data.event === 'start') {
        addEvent(`Job started — ${data.job?.total} URLs queued`, 'info')
      } else if (data.event === 'progress') {
        setProgress({ completed: data.completed, failed: data.failed, total: data.total })
        if (data.rate_status) setRateStatus(data.rate_status)
        if (data.latest_status === 'done') {
          addEvent(`✓ ${data.latest_url?.substring(0, 60)}...`, 'success')
          if (data.sample) setSampleResults(s => [...s.slice(-9), data.sample].filter(Boolean))
        } else if (data.latest_status === 'error') {
          addEvent(`✗ ${data.latest_url?.substring(0, 60)}`, 'error')
        } else if (data.latest_status === 'rate_limited') {
          addEvent(`⚠ Rate limited — AIMD throttling active`, 'warn')
        }
      } else if (data.event === 'done') {
        addEvent(`Job complete: ${data.job?.completed} pages scraped`, 'success')
        setActiveJob(j => ({ ...j, ...data.job }))
      } else if (data.event === 'state') {
        if (data.job) {
          setActiveJob(data.job)
          setProgress({ completed: data.job.completed, failed: data.job.failed, total: data.job.total })
          if (data.job.rate_status) setRateStatus(data.job.rate_status)
          setSampleResults(data.job.sample_results || [])
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
    setProgress({ completed: 0, failed: 0, total: 0 })

    try {
      addEvent(`Resolving target: "${target}"`, 'info')

      // Create job
      const createRes = await fetch(`${API}/api/jobs/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, data_type: dataType, max_items: maxItems, concurrency }),
      })
      const jobData = await createRes.json()

      if (jobData.error) {
        addEvent(`Error: ${jobData.error}`, 'error')
        return
      }

      setDiscoveredUrls(jobData.urls || [])
      addEvent(`Discovered ${jobData.count} URLs`, 'success')
      setActiveJob({ id: jobData.job_id, status: 'queued', total: jobData.count })
      setView('job')

      // Connect WS before starting
      connectWS(jobData.job_id)

      // Start job
      await fetch(`${API}/api/jobs/${jobData.job_id}/start`, { method: 'POST' })
      addEvent('Scrape engine started — AIMD rate controller active', 'info')

    } catch (err) {
      addEvent(`Failed to connect to backend: ${err.message}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleCancel = async () => {
    if (!activeJob) return
    await fetch(`${API}/api/jobs/${activeJob.id}/cancel`, { method: 'POST' })
    addEvent('Job cancelled by user', 'warn')
  }

  const handleDownload = async () => {
    if (!activeJob) return
    const res = await fetch(`${API}/api/jobs/${activeJob.id}/results?limit=1000`)
    const data = await res.json()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ultrascrap-${activeJob.id.slice(0, 8)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const pct = progress.total > 0
    ? Math.round((progress.completed + progress.failed) / progress.total * 100)
    : 0
  const isRunning = activeJob?.status === 'running'
  const isDone = activeJob?.status === 'done'

  // ── HOME VIEW ──────────────────────────────────────────────────────────
  if (view === 'home') return (
    <div className="grid-bg" style={{ minHeight: '100vh', position: 'relative' }}>
      <div className="noise-overlay" />
      <Orb x="-100px" y="-100px" color="#7c5cfc" size={500} opacity={0.08} />
      <Orb x="60%" y="20%" color="#22d3a0" size={400} opacity={0.05} />
      <Orb x="80%" y="70%" color="#f43f5e" size={300} opacity={0.04} />

      {/* Header */}
      <header style={{
        position: 'relative', zIndex: 1,
        padding: '20px 40px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid var(--border)',
        backdropFilter: 'blur(20px)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: 'linear-gradient(135deg, #7c5cfc, #22d3a0)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Zap size={18} fill="white" color="white" />
          </div>
          <span style={{ fontWeight: 800, fontSize: 18, letterSpacing: '-0.5px' }}>
            Ultra<span className="gradient-text">Scrap</span>
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className="tag tag-green">
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', display: 'inline-block' }} />
            ADAPTIVE ENGINE v1.0
          </span>
        </div>
      </header>

      {/* Hero */}
      <main style={{
        position: 'relative', zIndex: 1,
        maxWidth: 900, margin: '0 auto',
        padding: '80px 24px 60px',
        textAlign: 'center',
      }}>
        <div className="float-anim" style={{ display: 'inline-block', marginBottom: 32 }}>
          <RadarAnimation />
        </div>

        <h1 style={{
          fontSize: 'clamp(2.5rem, 6vw, 5rem)',
          fontWeight: 800,
          lineHeight: 1.05,
          letterSpacing: '-2px',
          marginBottom: 20,
        }}>
          <span className="shimmer-text">Intelligent</span>
          <br />
          <span style={{ color: 'var(--text)' }}>Web Scraping</span>
        </h1>

        <p style={{
          fontSize: 'clamp(0.9rem, 2vw, 1.15rem)',
          color: 'var(--text2)',
          maxWidth: 600, margin: '0 auto 48px',
          lineHeight: 1.7,
        }}>
          Pure-code adaptive engine with AIMD rate control, behavioral simulation,
          and universal content extraction. Scrape any website intelligently.
        </p>

        {/* Input form */}
        <div className="glass glow-anim" style={{ borderRadius: 20, padding: 28, maxWidth: 700, margin: '0 auto' }}>

          <div style={{ marginBottom: 16 }}>
            <input
              className="input-field"
              placeholder="Enter URL, domain, or natural language target (e.g. 'wikipedia python')"
              value={target}
              onChange={e => setTarget(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleStart()}
              style={{ fontSize: '1rem' }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 20 }}>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text2)', fontFamily: 'var(--mono)', display: 'block', marginBottom: 6 }}>
                DATA TYPE
              </label>
              <select className="input-field" value={dataType} onChange={e => setDataType(e.target.value)}
                style={{ padding: '10px 14px', fontSize: 13 }}>
                {DATA_TYPES.map(d => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text2)', fontFamily: 'var(--mono)', display: 'block', marginBottom: 6 }}>
                MAX PAGES
              </label>
              <input type="number" className="input-field" min={1} max={500} value={maxItems}
                onChange={e => setMaxItems(Number(e.target.value))}
                style={{ padding: '10px 14px', fontSize: 13 }} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text2)', fontFamily: 'var(--mono)', display: 'block', marginBottom: 6 }}>
                CONCURRENCY
              </label>
              <input type="number" className="input-field" min={1} max={15} value={concurrency}
                onChange={e => setConcurrency(Number(e.target.value))}
                style={{ padding: '10px 14px', fontSize: 13 }} />
            </div>
          </div>

          <button className="btn-primary" onClick={handleStart} disabled={loading || !target.trim()}
            style={{ width: '100%', padding: '16px 24px', fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            {loading ? <><Loader2 size={18} style={{ animation: 'spin-slow 1s linear infinite' }} /> Initialising…</> : <><Zap size={18} /> Launch Scraper</>}
          </button>
        </div>

        {/* Feature grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 12, marginTop: 48, textAlign: 'left',
        }}>
          {[
            { icon: Activity, title: 'AIMD Rate Control', desc: 'Automatically scales up/down based on site response' },
            { icon: Globe, title: 'Universal Extraction', desc: 'Text, tables, prices, links, images — all auto-detected' },
            { icon: Layers, title: 'Stealth Profiles', desc: 'Real browser fingerprints, Bézier mouse curves' },
            { icon: BarChart3, title: 'Live Telemetry', desc: 'Real-time error rates, concurrency and delay monitoring' },
          ].map(({ icon: Icon, title, desc }) => (
            <div key={title} className="card" style={{ padding: 16 }}>
              <Icon size={20} style={{ color: 'var(--accent2)', marginBottom: 8 }} />
              <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--text)', marginBottom: 4, fontFamily: 'var(--mono)' }}>{title}</div>
              <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.5 }}>{desc}</div>
            </div>
          ))}
        </div>
      </main>
    </div>
  )

  // ── JOB VIEW ──────────────────────────────────────────────────────────────
  return (
    <div className="grid-bg" style={{ minHeight: '100vh', position: 'relative' }}>
      <div className="noise-overlay" />
      <Orb x="-50px" y="10%" color="#7c5cfc" size={400} opacity={0.06} />
      <Orb x="70%" y="60%" color="#22d3a0" size={350} opacity={0.04} />

      {/* Header */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 100,
        padding: '14px 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid var(--border)',
        backdropFilter: 'blur(20px)',
        background: 'rgba(5,5,8,0.85)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button className="btn-ghost" onClick={() => setView('home')}
            style={{ padding: '6px 14px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <ArrowRight size={12} style={{ transform: 'rotate(180deg)' }} /> Back
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {isRunning && <div className="activity-dot" />}
            <span style={{ fontWeight: 700, fontSize: 14 }}>
              {isRunning ? 'Scraping in Progress' : isDone ? 'Scrape Complete' : 'Preparing'}
            </span>
            {activeJob && <StatusBadge status={activeJob.status} />}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {isDone && (
            <button className="btn-ghost" onClick={handleDownload}
              style={{ padding: '8px 16px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Download size={13} /> Download JSON
            </button>
          )}
          {isRunning && (
            <button className="btn-ghost" onClick={handleCancel}
              style={{ padding: '8px 16px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--red)', borderColor: 'rgba(244,63,94,0.3)' }}>
              <X size={13} /> Cancel
            </button>
          )}
          <button className="btn-ghost" onClick={() => setView('home')}
            style={{ padding: '8px 16px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <RefreshCw size={13} /> New Scrape
          </button>
        </div>
      </header>

      <div style={{ maxWidth: 1300, margin: '0 auto', padding: '24px', position: 'relative', zIndex: 1 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 20 }}>

          {/* LEFT COLUMN */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Stats row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
              {[
                { label: 'SCRAPED', value: progress.completed, color: 'var(--green)' },
                { label: 'FAILED', value: progress.failed, color: 'var(--red)' },
                { label: 'TOTAL', value: progress.total, color: 'var(--accent2)' },
                { label: 'PROGRESS', value: `${pct}%`, color: 'var(--text)' },
              ].map(({ label, value, color }) => (
                <div key={label} className="card" style={{ textAlign: 'center', padding: '16px 12px' }}>
                  <div style={{ fontSize: 10, color: 'var(--text2)', fontFamily: 'var(--mono)', marginBottom: 6 }}>{label}</div>
                  <div className="stat-value" style={{ fontSize: '1.8rem', color }}>{value}</div>
                </div>
              ))}
            </div>

            {/* Progress bar */}
            <div className="card" style={{ padding: '16px 20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontSize: 12, color: 'var(--text2)', fontFamily: 'var(--mono)' }}>
                  EXTRACTION PROGRESS
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <ProgressRing pct={pct} size={48} stroke={4} />
                </div>
              </div>
              <div style={{ height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${pct}%`,
                  background: 'linear-gradient(90deg, #7c5cfc, #22d3a0)',
                  borderRadius: 3,
                  transition: 'width 0.6s ease',
                  position: 'relative',
                  overflow: 'hidden',
                }}>
                  {isRunning && (
                    <div style={{
                      position: 'absolute', inset: 0,
                      background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)',
                      animation: 'shimmer 1.5s linear infinite',
                      backgroundSize: '200% 100%',
                    }} />
                  )}
                </div>
              </div>
            </div>

            {/* Main content tabs */}
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{
                display: 'flex',
                borderBottom: '1px solid var(--border)',
                padding: '0 4px',
              }}>
                {[
                  { id: 'preview', label: 'Data Preview', icon: Eye },
                  { id: 'log', label: 'Activity Log', icon: Activity },
                  { id: 'urls', label: `URLs (${discoveredUrls.length})`, icon: Globe },
                ].map(({ id, label, icon: Icon }) => (
                  <button key={id} onClick={() => setActiveTab(id)}
                    style={{
                      padding: '14px 18px',
                      background: 'none',
                      border: 'none',
                      borderBottom: activeTab === id ? '2px solid var(--accent)' : '2px solid transparent',
                      color: activeTab === id ? 'var(--text)' : 'var(--text2)',
                      cursor: 'pointer',
                      fontSize: 12,
                      fontFamily: 'Syne, sans-serif',
                      fontWeight: activeTab === id ? 700 : 400,
                      display: 'flex', alignItems: 'center', gap: 6,
                      marginBottom: -1,
                      transition: 'all 0.2s',
                    }}>
                    <Icon size={13} />
                    {label}
                  </button>
                ))}
              </div>

              <div style={{ padding: 20 }}>
                {activeTab === 'preview' && <DataPreview results={sampleResults} />}
                {activeTab === 'log' && <EventLog events={events} />}
                {activeTab === 'urls' && (
                  <div className="scrollbar" style={{ maxHeight: 300, overflowY: 'auto' }}>
                    {discoveredUrls.slice(0, 100).map((url, i) => (
                      <div key={i} style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '6px 0',
                        borderBottom: '1px solid var(--border)',
                        fontSize: 11,
                        fontFamily: 'var(--mono)',
                        color: 'var(--text2)',
                        animation: 'slide-in-up 0.3s ease both',
                        animationDelay: `${i * 20}ms`,
                      }}>
                        <span style={{ color: 'var(--accent2)', minWidth: 28 }}>{i + 1}.</span>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{url}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Target */}
            <div className="card">
              <div style={{ fontSize: 10, color: 'var(--text2)', fontFamily: 'var(--mono)', marginBottom: 8 }}>TARGET</div>
              <div style={{ fontSize: 13, wordBreak: 'break-all', color: 'var(--text)', lineHeight: 1.5 }}>
                {target}
              </div>
              <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <span className="tag tag-purple">{dataType}</span>
                <span className="tag tag-purple">max {maxItems}</span>
                <span className="tag tag-purple">×{concurrency} concurrent</span>
              </div>
            </div>

            {/* Rate Controller */}
            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <Activity size={14} style={{ color: 'var(--accent2)' }} />
                <span style={{ fontSize: 11, fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--text2)' }}>
                  AIMD RATE CONTROLLER
                </span>
              </div>
              <RateGauge rateStatus={rateStatus} />
            </div>

            {/* Process Steps */}
            <div className="card">
              <div style={{ fontSize: 10, color: 'var(--text2)', fontFamily: 'var(--mono)', marginBottom: 14 }}>
                SCRAPER PIPELINE
              </div>
              {[
                { label: 'URL Discovery',       done: progress.total > 0 },
                { label: 'Browser Init',         done: progress.completed + progress.failed > 0 },
                { label: 'Stealth Profile',      done: progress.completed + progress.failed > 0 },
                { label: 'Content Extraction',   done: progress.completed > 0,  active: isRunning && progress.completed > 0 },
                { label: 'Rate Adaptation',      done: Object.keys(rateStatus).length > 0, active: isRunning },
                { label: 'Data Structuring',     done: sampleResults.length > 0 },
                { label: 'Export Ready',         done: isDone },
              ].map(({ label, done, active }) => (
                <div key={label} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 0',
                  borderBottom: '1px solid var(--border)',
                  fontSize: 12,
                }}>
                  <div style={{
                    width: 20, height: 20,
                    borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: done ? 'rgba(34,211,160,0.15)' : active ? 'rgba(124,92,252,0.15)' : 'var(--surface2)',
                    border: `1px solid ${done ? 'var(--green)' : active ? 'var(--accent)' : 'var(--border)'}`,
                    flexShrink: 0,
                    transition: 'all 0.4s',
                  }}>
                    {done
                      ? <CheckCircle2 size={11} style={{ color: 'var(--green)' }} />
                      : active
                        ? <Loader2 size={11} style={{ color: 'var(--accent2)', animation: 'spin-slow 1s linear infinite' }} />
                        : <Clock size={11} style={{ color: 'var(--text2)', opacity: 0.5 }} />
                    }
                  </div>
                  <span style={{
                    color: done ? 'var(--text)' : active ? 'var(--accent2)' : 'var(--text2)',
                    fontWeight: done || active ? 600 : 400,
                    transition: 'all 0.3s',
                  }}>
                    {label}
                  </span>
                  {active && (
                    <div style={{
                      marginLeft: 'auto',
                      width: 24, height: 3,
                      borderRadius: 2,
                      background: 'var(--border)',
                      overflow: 'hidden',
                    }}>
                      <div style={{
                        height: '100%',
                        background: 'var(--accent)',
                        animation: 'shimmer 1s linear infinite',
                        backgroundSize: '200% 100%',
                        backgroundImage: 'linear-gradient(90deg, var(--accent) 0%, var(--accent2) 50%, var(--accent) 100%)',
                      }} />
                    </div>
                  )}
                </div>
              ))}
            </div>

          </div>
        </div>
      </div>
    </div>
  )
}

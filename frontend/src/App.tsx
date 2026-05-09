import { useEffect, useRef, useState } from 'react'
import './App.css'

type Segment = { start: number; end: number; text: string }
type Info = { language: string; language_probability: number; duration: number }
type Estimate = { duration_seconds: number; eta_seconds: number; model: string; device: string; compute: string }
type JobStatus = 'queued' | 'running' | 'paused' | 'done' | 'error' | 'cancelled'
type JobSummary = {
  id: string; filename: string; status: JobStatus; created_at: number;
  language: string | null; duration_seconds: number | null; segment_count: number;
  progress: number; error: string | null;
  live?: boolean; listen_url?: string | null;
}

const formatTs = (s: number) => {
  const m = Math.floor(s / 60)
  const sec = (s % 60).toFixed(1).padStart(4, '0')
  return `${m.toString().padStart(2, '0')}:${sec}`
}

const formatDuration = (s: number) => {
  if (s < 60) return `${s.toFixed(0)}s`
  const m = Math.floor(s / 60)
  const sec = Math.round(s % 60)
  if (m < 60) return `${m}m ${sec}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

const STATUS_COLOR: Record<JobStatus, string> = {
  queued: '#888', running: '#0a84ff', paused: '#f59e0b',
  done: '#10b981', error: '#ef4444', cancelled: '#6b7280',
}

export default function App() {
  const [jobs, setJobs] = useState<JobSummary[]>([])
  const [selected, setSelected] = useState<string | null>(null)

  const refreshJobs = async () => {
    try {
      const r = await fetch('/api/jobs')
      const data = await r.json()
      setJobs(data.jobs)
      if (selected === null && data.jobs.length > 0) setSelected(data.jobs[0].id)
    } catch { /* ignore */ }
  }

  useEffect(() => {
    refreshJobs()
    const t = setInterval(refreshJobs, 2000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="container">
      <h1>Meet · 逐字稿</h1>
      <div className="layout">
        <Sidebar jobs={jobs} selected={selected} onSelect={setSelected} onRefresh={refreshJobs} />
        <main className="detail">
          {selected
            ? <JobDetail key={selected} jobId={selected} onChange={refreshJobs} />
            : <NewJob onCreated={(id) => { refreshJobs(); setSelected(id) }} />}
        </main>
      </div>
    </div>
  )
}


function Sidebar({ jobs, selected, onSelect, onRefresh }: {
  jobs: JobSummary[]; selected: string | null;
  onSelect: (id: string | null) => void; onRefresh: () => void;
}) {
  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <button onClick={() => onSelect(null)}>+ 新轉錄</button>
        <button className="ghost" onClick={onRefresh}>↻</button>
      </div>
      <div className="job-list">
        {jobs.length === 0 && <div className="empty">尚無任務</div>}
        {jobs.map((j) => (
          <button
            key={j.id}
            className={'job-item' + (j.id === selected ? ' selected' : '')}
            onClick={() => onSelect(j.id)}
          >
            <div className="job-row">
              <span className="status-dot" style={{ background: STATUS_COLOR[j.status] }} />
              <span className="job-name">{j.filename}</span>
            </div>
            <div className="job-meta">
              <span>{j.status}</span>
              <span>·</span>
              <span>{(j.progress * 100).toFixed(0)}%</span>
              <span>·</span>
              <span>{j.segment_count} 段</span>
            </div>
          </button>
        ))}
      </div>
    </aside>
  )
}


function NewJob({ onCreated }: { onCreated: (id: string) => void }) {
  const [mode, setMode] = useState<'file' | 'live'>('file')
  const [file, setFile] = useState<File | null>(null)
  const [language, setLanguage] = useState('zh-TW')
  const [vad, setVad] = useState(true)
  const [listenUrl, setListenUrl] = useState('tcp://0.0.0.0:9999?listen=1')
  const [chunkSeconds, setChunkSeconds] = useState(6)
  const [label, setLabel] = useState('')
  const [record, setRecord] = useState(false)
  const [recordFormat, setRecordFormat] = useState<'mkv' | 'mp4' | 'ts'>('mkv')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleStartFile = async () => {
    if (!file || submitting) return
    setSubmitting(true); setError(null)
    const form = new FormData()
    form.append('file', file)
    if (language) form.append('language', language)
    form.append('vad', vad ? 'true' : 'false')
    try {
      const r = await fetch('/api/jobs', { method: 'POST', body: form })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = await r.json()
      onCreated(data.id)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleStartLive = async () => {
    if (!listenUrl || submitting) return
    setSubmitting(true); setError(null)
    const form = new FormData()
    form.append('listen_url', listenUrl)
    if (language) form.append('language', language)
    form.append('vad', vad ? 'true' : 'false')
    form.append('chunk_seconds', String(chunkSeconds))
    if (label) form.append('label', label)
    form.append('record', record ? 'true' : 'false')
    if (record) form.append('record_format', recordFormat)
    try {
      const r = await fetch('/api/live', { method: 'POST', body: form })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = await r.json()
      onCreated(data.id)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="card">
      <h2>新轉錄任務</h2>
      <div className="row tabs">
        <button className={mode === 'file' ? 'tab active' : 'tab'} onClick={() => setMode('file')}>檔案上傳</button>
        <button className={mode === 'live' ? 'tab active' : 'tab'} onClick={() => setMode('live')}>OBS 直播</button>
      </div>

      {mode === 'file' ? (
        <div className="row">
          <input type="file" accept="audio/*,video/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
      ) : (
        <>
          <div className="row">
            <label style={{ flex: 1 }}>監聽 URL：
              <input
                type="text"
                value={listenUrl}
                onChange={(e) => setListenUrl(e.target.value)}
                style={{ width: '100%', fontFamily: 'monospace' }}
              />
            </label>
          </div>
          <div className="row">
            <label>標籤（可選）：
              <input type="text" value={label} placeholder="OBS Live"
                     onChange={(e) => setLabel(e.target.value)} />
            </label>
            <label>chunk 秒數：
              <input type="number" min={2} max={30} value={chunkSeconds}
                     onChange={(e) => setChunkSeconds(Number(e.target.value) || 6)}
                     style={{ width: 60 }} />
            </label>
          </div>
          <div className="row">
            <label>
              <input type="checkbox" checked={record}
                     onChange={(e) => setRecord(e.target.checked)} />
              同步保留影片檔（不重編，存到 outputs/）
            </label>
            {record && (
              <label>格式：
                <select value={recordFormat} onChange={(e) => setRecordFormat(e.target.value as 'mkv' | 'mp4' | 'ts')}>
                  <option value="mkv">mkv（推薦，串流斷掉也不會壞）</option>
                  <option value="mp4">mp4</option>
                  <option value="ts">ts</option>
                </select>
              </label>
            )}
          </div>
          <div className="meta">
            <strong>meet 端</strong>：上面的 URL 必須帶 <code>?listen=1</code>（tcp/udp 自動補；srt 用 <code>?mode=listener</code>）。<br />
            <strong>OBS 端</strong>：設定 → 輸出 → 模式：進階 → 錄製 → 類型：<strong>自訂輸出 (FFmpeg)</strong> →
            FFmpeg 輸出類型：<strong>輸出到 URL</strong> → URL 填 <code>tcp://127.0.0.1:9999</code>
            （<em>不要</em>加 <code>?listen=1</code>，OBS 是去 connect），容器格式選 <code>mpegts</code>。<br />
            順序：先在這裡按「開始監聽」，再去 OBS 開始錄製。
          </div>
        </>
      )}

      <div className="row">
        <label>語言：
          <select value={language} onChange={(e) => setLanguage(e.target.value)}>
            <option value="zh-TW">繁體中文</option>
            <option value="zh-CN">简体中文</option>
            <option value="en">English</option>
            <option value="ja">日本語</option>
            <option value="ko">한국어</option>
            <option value="auto">自動偵測</option>
          </select>
        </label>
        <label>
          <input type="checkbox" checked={vad} onChange={(e) => setVad(e.target.checked)} />
          VAD（過濾靜音）
        </label>
      </div>
      <div className="row">
        {mode === 'file' ? (
          <button onClick={handleStartFile} disabled={!file || submitting}>開始轉錄</button>
        ) : (
          <button onClick={handleStartLive} disabled={!listenUrl || submitting}>開始監聽</button>
        )}
      </div>
      {error && <div className="error">錯誤：{error}</div>}
    </div>
  )
}


function JobDetail({ jobId, onChange }: { jobId: string; onChange: () => void }) {
  const [estimate, setEstimate] = useState<Estimate | null>(null)
  const [info, setInfo] = useState<Info | null>(null)
  const [segments, setSegments] = useState<Segment[]>([])
  const [status, setStatus] = useState<JobStatus>('queued')
  const [error, setError] = useState<string | null>(null)
  const [filename, setFilename] = useState<string>('')
  const [live, setLive] = useState<boolean>(false)
  const [listenUrl, setListenUrl] = useState<string | null>(null)
  const [listening, setListening] = useState<boolean>(false)
  const [recordPath, setRecordPath] = useState<string | null>(null)
  const transcriptRef = useRef<HTMLDivElement | null>(null)
  const autoScrollRef = useRef(true)

  useEffect(() => {
    setEstimate(null); setInfo(null); setSegments([]); setError(null); setStatus('queued'); setListening(false)
    fetch(`/api/jobs/${jobId}`).then((r) => r.json()).then((j) => {
      setFilename(j.filename || '')
      setLive(!!j.live)
      setListenUrl(j.listen_url || null)
      setRecordPath(j.record_path || null)
    })
    const ctrl = new AbortController()
    ;(async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}/events`, { signal: ctrl.signal })
        if (!res.body) return
        const reader = res.body.getReader()
        const decoder = new TextDecoder('utf-8')
        let buf = ''
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const parts = buf.split('\n\n')
          buf = parts.pop() ?? ''
          for (const chunk of parts) {
            const line = chunk.split('\n').find((l) => l.startsWith('data: '))
            if (!line) continue
            const ev = JSON.parse(line.slice(6))
            if (ev.type === 'estimate') setEstimate(ev)
            else if (ev.type === 'info') setInfo(ev)
            else if (ev.type === 'listening') setListening(true)
            else if (ev.type === 'segment') setSegments((prev) => [...prev, ev])
            else if (ev.type === 'state') {
              setStatus(ev.status)
              if (ev.error) setError(ev.error)
              onChange()
            }
            else if (ev.type === 'error') setError(ev.message)
          }
        }
      } catch (e: unknown) {
        if ((e as Error).name !== 'AbortError') setError((e as Error).message)
      }
    })()
    return () => ctrl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId])

  useEffect(() => {
    const el = transcriptRef.current
    if (!el || !autoScrollRef.current) return
    el.scrollTop = el.scrollHeight
  }, [segments])

  const handleScroll = () => {
    const el = transcriptRef.current
    if (!el) return
    autoScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
  }

  const action = async (a: 'pause' | 'resume' | 'cancel') => {
    await fetch(`/api/jobs/${jobId}/${a}`, { method: 'POST' })
    onChange()
  }

  const lastEnd = segments.length ? segments[segments.length - 1].end : 0
  const progress = estimate && estimate.duration_seconds > 0 ? Math.min(1, lastEnd / estimate.duration_seconds) : 0
  const remainingEta = estimate ? Math.max(0, estimate.eta_seconds * (1 - progress)) : 0
  const fullText = segments.map((s) => s.text).join('\n')
  const handleCopy = () => navigator.clipboard.writeText(fullText)

  const isActive = status === 'running' || status === 'paused'

  return (
    <>
      <div className="card">
        <div className="row job-header">
          <div>
            <div className="job-title">{filename}</div>
            <div className="job-id">job: {jobId}</div>
          </div>
          <div className="status-pill" style={{ background: STATUS_COLOR[status] }}>{status}</div>
        </div>
        <div className="row">
          {!live && status === 'running' && <button onClick={() => action('pause')}>⏸ 暫停</button>}
          {!live && status === 'paused' && <button onClick={() => action('resume')}>▶ 繼續</button>}
          {isActive && (
            <button className="danger" onClick={() => action('cancel')}>
              {live ? '⏹ 停止監聽' : '⏹ 終止'}
            </button>
          )}
          <button onClick={handleCopy} disabled={!segments.length}>複製全文</button>
          <a href={`/api/jobs/${jobId}/output`} download>
            <button disabled={status !== 'done' && segments.length === 0}>下載 .txt</button>
          </a>
          {recordPath && (
            <a href={`/api/jobs/${jobId}/recording`} download>
              <button disabled={isActive}>下載錄影</button>
            </a>
          )}
        </div>
      </div>

      {error && <div className="card error">錯誤：{error}</div>}
      {live && (
        <div className="card meta">
          🔴 直播模式 · 監聽：<code>{listenUrl}</code>
          {listening
            ? '（已就緒，等待 OBS 連入或音訊…）'
            : '（啟動中，模型載入後會開始監聽）'}
          {recordPath && <div>🎬 同步錄影：<code>{recordPath}</code></div>}
        </div>
      )}
      {estimate && !info && (
        <div className="card meta">
          音檔長度：{formatDuration(estimate.duration_seconds)} · 預估處理時間：~{formatDuration(estimate.eta_seconds)}
          （{estimate.model} / {estimate.device} / {estimate.compute}）
        </div>
      )}
      {info && (
        <div className="card meta">
          語言：{info.language}（{(info.language_probability * 100).toFixed(0)}%） · 時長：{formatDuration(info.duration)} · 段落：{segments.length}
          {estimate && isActive && ` · 進度：${(progress * 100).toFixed(0)}% · 剩餘：~${formatDuration(remainingEta)}`}
        </div>
      )}

      <div className="card transcript" ref={transcriptRef} onScroll={handleScroll}>
        {segments.length === 0 && <div className="empty">尚無內容</div>}
        {segments.map((s, i) => (
          <div key={i} className="segment">
            <span className="ts">[{formatTs(s.start)}]</span>
            <span className="text">{s.text}</span>
          </div>
        ))}
        {status === 'paused' && <div className="loading">已暫停</div>}
        {status === 'running' && <div className="loading">轉錄中…</div>}
      </div>
    </>
  )
}

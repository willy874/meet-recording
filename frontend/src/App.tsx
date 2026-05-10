import { useEffect, useRef, useState } from 'react'
import {
  AppBar, Toolbar, Typography, Container, Box, Stack, Card, CardContent,
  Button, IconButton, TextField, MenuItem, Select, FormControlLabel, Checkbox,
  Tabs, Tab, Chip, List, ListItem, ListItemButton, ListItemText, LinearProgress,
  Alert, Tooltip, InputLabel, FormControl, useColorScheme, Divider,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import RefreshIcon from '@mui/icons-material/Refresh'
import PauseIcon from '@mui/icons-material/Pause'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import StopIcon from '@mui/icons-material/Stop'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import DownloadIcon from '@mui/icons-material/Download'
import VideocamIcon from '@mui/icons-material/Videocam'
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord'
import LightModeIcon from '@mui/icons-material/LightMode'
import DarkModeIcon from '@mui/icons-material/DarkMode'
import SettingsBrightnessIcon from '@mui/icons-material/SettingsBrightness'
import { statusColor } from './theme'

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

export default function App() {
  const [jobs, setJobs] = useState<JobSummary[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [outputsDir, setOutputsDir] = useState<string | null>(null)

  const refreshJobs = async () => {
    try {
      const r = await fetch('/api/jobs')
      const data = await r.json()
      setJobs(data.jobs)
      if (selected === null && data.jobs.length > 0) setSelected(data.jobs[0].id)
    } catch { /* ignore */ }
  }

  const refreshOutputsDir = async () => {
    try {
      const r = await fetch('/api/outputs-dir')
      const data = await r.json()
      setOutputsDir(data.outputs_dir ?? null)
    } catch { /* ignore */ }
  }

  useEffect(() => {
    refreshJobs()
    refreshOutputsDir()
    const t = setInterval(refreshJobs, 2000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar
        position="sticky"
        elevation={0}
        color="transparent"
        sx={{ backdropFilter: 'blur(12px)', borderBottom: 1, borderColor: 'divider' }}
      >
        <Toolbar>
          <Typography variant="h5" sx={{ flex: 1, fontWeight: 500 }}>
            Meet · 逐字稿
          </Typography>
          <ColorSchemeToggle />
        </Toolbar>
      </AppBar>

      <Container maxWidth="lg" sx={{ pt: 2 }}>
        <OutputsDirBar value={outputsDir} onChange={setOutputsDir} />
      </Container>

      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: '300px 1fr' },
            gap: 3,
            alignItems: 'start',
          }}
        >
          <Sidebar jobs={jobs} selected={selected} onSelect={setSelected} onRefresh={refreshJobs} />
          <Box>
            {selected
              ? <JobDetail key={selected} jobId={selected} onChange={refreshJobs} />
              : <NewJob onCreated={(id) => { refreshJobs(); setSelected(id) }} />}
          </Box>
        </Box>
      </Container>
    </Box>
  )
}

function OutputsDirBar({ value, onChange }: { value: string | null; onChange: (v: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const startEdit = () => { setDraft(value ?? ''); setError(null); setEditing(true) }
  const cancel = () => { setEditing(false); setError(null) }

  const save = async () => {
    const path = draft.trim()
    if (!path) return
    setSaving(true); setError(null)
    try {
      const r = await fetch('/api/outputs-dir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data?.detail || `HTTP ${r.status}`)
      onChange(data.outputs_dir as string)
      setEditing(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card variant="outlined" sx={{ mb: 0 }}>
      <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' } }}>
          <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>
            輸出資料夾
          </Typography>
          {editing ? (
            <>
              <TextField
                size="small"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="/絕對路徑/到/輸出資料夾"
                fullWidth
                disabled={saving}
                slotProps={{ input: { sx: { fontFamily: 'ui-monospace, monospace', fontSize: 13 } } }}
                onKeyDown={(e) => { if (e.key === 'Enter') save() }}
              />
              <Stack direction="row" spacing={1}>
                <Button size="small" variant="contained" onClick={save} disabled={saving || !draft.trim()}>儲存</Button>
                <Button size="small" onClick={cancel} disabled={saving}>取消</Button>
              </Stack>
            </>
          ) : (
            <>
              <Typography
                variant="body2"
                sx={{ flex: 1, fontFamily: 'ui-monospace, monospace', fontSize: 13, wordBreak: 'break-all' }}
              >
                {value || '（載入中…）'}
              </Typography>
              <Button size="small" onClick={startEdit} disabled={!value}>變更</Button>
            </>
          )}
        </Stack>
        {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
      </CardContent>
    </Card>
  )
}

function ColorSchemeToggle() {
  const { mode, setMode } = useColorScheme()
  if (!mode) return null
  const next = mode === 'light' ? 'dark' : mode === 'dark' ? 'system' : 'light'
  const Icon = mode === 'light' ? LightModeIcon : mode === 'dark' ? DarkModeIcon : SettingsBrightnessIcon
  return (
    <Tooltip title={`配色：${mode}（點擊切換）`}>
      <IconButton onClick={() => setMode(next)}><Icon /></IconButton>
    </Tooltip>
  )
}

function Sidebar({ jobs, selected, onSelect, onRefresh }: {
  jobs: JobSummary[]; selected: string | null;
  onSelect: (id: string | null) => void; onRefresh: () => void;
}) {
  return (
    <Card sx={{ position: { md: 'sticky' }, top: { md: 88 } }}>
      <CardContent>
        <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
          <Button
            startIcon={<AddIcon />}
            variant="contained"
            sx={{ flex: 1 }}
            onClick={() => onSelect(null)}
          >
            新轉錄
          </Button>
          <Tooltip title="重新整理">
            <IconButton onClick={onRefresh}><RefreshIcon /></IconButton>
          </Tooltip>
        </Stack>
        <Divider sx={{ mb: 1 }} />
        <List dense disablePadding sx={{ maxHeight: '70vh', overflowY: 'auto' }}>
          {jobs.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
              尚無任務
            </Typography>
          )}
          {jobs.map((j) => (
            <ListItem key={j.id} disablePadding sx={{ mb: 0.5 }}>
              <ListItemButton
                selected={j.id === selected}
                onClick={() => onSelect(j.id)}
                sx={{ alignItems: 'flex-start', py: 1, px: 1.5 }}
              >
                <FiberManualRecordIcon
                  color={statusColor(j.status) as 'primary' | 'success' | 'error' | 'warning' | 'inherit'}
                  sx={{ fontSize: 10, mt: '8px', mr: 1 }}
                />
                <ListItemText
                  primary={j.filename}
                  secondary={
                    <Box component="span" sx={{ display: 'flex', gap: 0.75, fontSize: 11 }}>
                      <span>{j.status}</span>
                      <span>·</span>
                      <span>{(j.progress * 100).toFixed(0)}%</span>
                      <span>·</span>
                      <span>{j.segment_count} 段</span>
                    </Box>
                  }
                  slotProps={{
                    primary: { noWrap: true, variant: 'body2', sx: { fontWeight: 500 } },
                    secondary: { component: 'span' },
                  }}
                />
              </ListItemButton>
            </ListItem>
          ))}
        </List>
      </CardContent>
    </Card>
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
    <Card>
      <CardContent>
        <Typography variant="h5" sx={{ mb: 2 }}>新轉錄任務</Typography>

        <Tabs
          value={mode}
          onChange={(_, v) => setMode(v)}
          sx={{ mb: 3, '& .MuiTabs-indicator': { height: 3, borderRadius: 3 } }}
        >
          <Tab value="file" label="檔案上傳" />
          <Tab value="live" label="OBS 直播" />
        </Tabs>

        {mode === 'file' ? (
          <Box sx={{ mb: 2 }}>
            <Button variant="outlined" component="label">
              {file ? file.name : '選擇音訊／影片檔'}
              <input
                hidden
                type="file"
                accept="audio/*,video/*"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </Button>
          </Box>
        ) : (
          <Stack spacing={2} sx={{ mb: 2 }}>
            <TextField
              label="監聽 URL"
              value={listenUrl}
              onChange={(e) => setListenUrl(e.target.value)}
              fullWidth
              slotProps={{ input: { sx: { fontFamily: 'ui-monospace, monospace' } } }}
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label="標籤（可選）"
                placeholder="OBS Live"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                sx={{ flex: 1 }}
              />
              <TextField
                label="chunk 秒數"
                type="number"
                value={chunkSeconds}
                onChange={(e) => setChunkSeconds(Number(e.target.value) || 6)}
                slotProps={{ htmlInput: { min: 2, max: 30 } }}
                sx={{ width: 140 }}
              />
            </Stack>
            <FormControlLabel
              control={
                <Checkbox checked={record} onChange={(e) => setRecord(e.target.checked)} />
              }
              label="同步保留影片檔（不重編，存到 outputs/）"
            />
            {record && (
              <FormControl size="small" sx={{ maxWidth: 320 }}>
                <InputLabel>格式</InputLabel>
                <Select
                  label="格式"
                  value={recordFormat}
                  onChange={(e) => setRecordFormat(e.target.value as 'mkv' | 'mp4' | 'ts')}
                >
                  <MenuItem value="mkv">mkv（推薦，串流斷掉也不會壞）</MenuItem>
                  <MenuItem value="mp4">mp4</MenuItem>
                  <MenuItem value="ts">ts</MenuItem>
                </Select>
              </FormControl>
            )}
            <Alert severity="info" variant="outlined">
              <Typography variant="body2" component="div">
                <strong>meet 端</strong>：URL 需帶 <code>?listen=1</code>（tcp/udp 自動補；srt 用 <code>?mode=listener</code>）。<br />
                <strong>OBS 端</strong>：設定 → 輸出 → 模式：進階 → 錄製 → 類型：<strong>自訂輸出 (FFmpeg)</strong> →
                FFmpeg 輸出類型：<strong>輸出到 URL</strong> → URL 填 <code>tcp://127.0.0.1:9999</code>
                （<em>不要</em>加 <code>?listen=1</code>），容器格式選 <code>mpegts</code>。<br />
                順序：先在這裡按「開始監聽」，再去 OBS 開始錄製。
              </Typography>
            </Alert>
          </Stack>
        )}

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 3 }}>
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel>語言</InputLabel>
            <Select label="語言" value={language} onChange={(e) => setLanguage(e.target.value)}>
              <MenuItem value="zh-TW">繁體中文</MenuItem>
              <MenuItem value="zh-CN">简体中文</MenuItem>
              <MenuItem value="en">English</MenuItem>
              <MenuItem value="ja">日本語</MenuItem>
              <MenuItem value="ko">한국어</MenuItem>
              <MenuItem value="auto">自動偵測</MenuItem>
            </Select>
          </FormControl>
          <FormControlLabel
            control={<Checkbox checked={vad} onChange={(e) => setVad(e.target.checked)} />}
            label="VAD（過濾靜音）"
          />
        </Stack>

        {mode === 'file' ? (
          <Button
            variant="contained"
            onClick={handleStartFile}
            disabled={!file || submitting}
            startIcon={<PlayArrowIcon />}
          >
            開始轉錄
          </Button>
        ) : (
          <Button
            variant="contained"
            onClick={handleStartLive}
            disabled={!listenUrl || submitting}
            startIcon={<VideocamIcon />}
          >
            開始監聽
          </Button>
        )}

        {error && <Alert severity="error" sx={{ mt: 2 }}>錯誤：{error}</Alert>}
      </CardContent>
    </Card>
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
    <Stack spacing={2}>
      <Card>
        <CardContent>
          <Stack direction="row" spacing={2} sx={{ mb: 2, alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="h6" noWrap>{filename}</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'ui-monospace, monospace' }}>
                job: {jobId}
              </Typography>
            </Box>
            <Chip
              label={status}
              color={statusColor(status) as 'primary' | 'success' | 'error' | 'warning' | 'default'}
              sx={{ textTransform: 'uppercase', fontSize: 11 }}
              size="small"
            />
          </Stack>

          {isActive && estimate && (
            <LinearProgress
              variant="determinate"
              value={progress * 100}
              sx={{ height: 6, borderRadius: 3, mb: 2 }}
            />
          )}

          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
            {!live && status === 'running' && (
              <Button startIcon={<PauseIcon />} onClick={() => action('pause')}>暫停</Button>
            )}
            {!live && status === 'paused' && (
              <Button startIcon={<PlayArrowIcon />} onClick={() => action('resume')}>繼續</Button>
            )}
            {isActive && (
              <Button color="error" variant="contained" startIcon={<StopIcon />} onClick={() => action('cancel')}>
                {live ? '停止監聽' : '終止'}
              </Button>
            )}
            <Button startIcon={<ContentCopyIcon />} onClick={handleCopy} disabled={!segments.length}>
              複製全文
            </Button>
            <Button
              component="a"
              href={`/api/jobs/${jobId}/output`}
              download
              startIcon={<DownloadIcon />}
              disabled={status !== 'done' && segments.length === 0}
            >
              下載 .md
            </Button>
            {recordPath && (
              <Button
                component="a"
                href={`/api/jobs/${jobId}/recording`}
                download
                startIcon={<DownloadIcon />}
                disabled={isActive}
              >
                下載錄影
              </Button>
            )}
          </Stack>
        </CardContent>
      </Card>

      {error && <Alert severity="error">錯誤：{error}</Alert>}

      {live && (
        <Alert severity="info" icon={<VideocamIcon />}>
          🔴 直播模式 · 監聽：<code>{listenUrl}</code>{' '}
          {listening ? '（已就緒，等待 OBS 連入或音訊…）' : '（啟動中，模型載入後會開始監聽）'}
          {recordPath && <Box sx={{ mt: 0.5 }}>🎬 同步錄影：<code>{recordPath}</code></Box>}
        </Alert>
      )}
      {estimate && !info && (
        <Alert severity="info" variant="outlined">
          音檔長度：{formatDuration(estimate.duration_seconds)} · 預估處理時間：~{formatDuration(estimate.eta_seconds)}
          （{estimate.model} / {estimate.device} / {estimate.compute}）
        </Alert>
      )}
      {info && (
        <Alert severity="success" variant="outlined">
          語言：{info.language}（{(info.language_probability * 100).toFixed(0)}%） · 時長：{formatDuration(info.duration)} · 段落：{segments.length}
          {estimate && isActive && ` · 進度：${(progress * 100).toFixed(0)}% · 剩餘：~${formatDuration(remainingEta)}`}
        </Alert>
      )}

      <Card>
        <Box
          ref={transcriptRef}
          onScroll={handleScroll}
          sx={{
            p: 2,
            minHeight: 240,
            maxHeight: '60vh',
            overflowY: 'auto',
            fontSize: 15,
            lineHeight: 1.8,
          }}
        >
          {segments.length === 0 && (
            <Typography color="text.secondary" sx={{ textAlign: 'center', py: 5 }}>
              尚無內容
            </Typography>
          )}
          {segments.map((s, i) => (
            <Stack key={i} direction="row" spacing={1.5} sx={{ py: 0.5 }}>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ fontFamily: 'ui-monospace, monospace', mt: '4px', flexShrink: 0 }}
              >
                [{formatTs(s.start)}]
              </Typography>
              <Typography sx={{ flex: 1 }}>{s.text}</Typography>
            </Stack>
          ))}
          {status === 'paused' && (
            <Typography color="text.secondary" sx={{ pt: 1, fontStyle: 'italic' }}>已暫停</Typography>
          )}
          {status === 'running' && (
            <Typography color="text.secondary" sx={{ pt: 1, fontStyle: 'italic' }}>轉錄中…</Typography>
          )}
        </Box>
      </Card>
    </Stack>
  )
}

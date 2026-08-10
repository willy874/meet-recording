import { useEffect, useRef, useState } from 'react'
import {
  AppBar, Toolbar, Typography, Container, Box, Stack, Card, CardContent,
  Button, IconButton, TextField, MenuItem, Select, FormControlLabel, Checkbox,
  Tabs, Tab, Chip, List, ListItem, ListItemButton, ListItemText, LinearProgress,
  Alert, Tooltip, InputLabel, FormControl, useColorScheme, Divider, Snackbar,
  ToggleButton, ToggleButtonGroup,
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
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineOutlined'
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
  model?: string;
}
type ModelInfo = {
  id: string; params: string; size: string; note: string;
  rtf: number; live_chunk: number; live_viable: boolean; cached: boolean
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
  // While a live job is being stopped, the backend is blocking until ffmpeg
  // releases the listen port. Any new job started during that window would
  // hit "Address already in use" and crash — so we lock navigation and show
  // a snackbar until the cancel call resolves.
  const [cancelPending, setCancelPending] = useState(false)
  const [navBlockedToast, setNavBlockedToast] = useState(false)
  const initialSelectDone = useRef(false)

  const guardedSelect = (id: string | null) => {
    if (cancelPending) {
      setNavBlockedToast(true)
      return
    }
    setSelected(id)
  }

  const refreshJobs = async () => {
    try {
      const r = await fetch('/api/jobs')
      const data = await r.json()
      setJobs(data.jobs)
      if (!initialSelectDone.current && data.jobs.length > 0) {
        setSelected(data.jobs[0].id)
      }
      initialSelectDone.current = true
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
          <Sidebar
            jobs={jobs}
            selected={selected}
            onSelect={guardedSelect}
            onRefresh={refreshJobs}
            onDeleted={(id) => {
              setJobs((prev) => prev.filter((j) => j.id !== id))
              if (selected === id) setSelected(null)
            }}
          />
          <Box>
            {selected
              ? <JobDetail
                  key={selected}
                  jobId={selected}
                  onChange={refreshJobs}
                  onCancelPendingChange={setCancelPending}
                />
              : <NewJob
                  defaultOutputsDir={outputsDir}
                  onCreated={(id, autoSelect = true) => {
                    refreshJobs()
                    if (autoSelect) setSelected(id)
                  }} />}
          </Box>
        </Box>
      </Container>

      <Snackbar
        open={navBlockedToast}
        autoHideDuration={4000}
        onClose={() => setNavBlockedToast(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="warning" variant="filled" onClose={() => setNavBlockedToast(false)}>
          正在停止前一個任務、釋放監聽埠中，請稍候再切換或建立新任務。
        </Alert>
      </Snackbar>
    </Box>
  )
}

function OutputsDirBar({ value, onChange }: { value: string | null; onChange: (v: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)

  const startEdit = () => { setDraft(value ?? ''); setError(null); setEditing(true) }
  const cancel = () => { setEditing(false); setError(null) }

  const pickFolder = async () => {
    setError(null)
    setPicking(true)
    try {
      const r = await fetch('/api/outputs-dir/pick', { method: 'POST' })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data?.detail || `HTTP ${r.status}`)
      const path = (data?.path as string) || ''
      if (!path) return // cancelled
      if (!editing) setEditing(true)
      setDraft(path)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setPicking(false)
    }
  }

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
          <Tooltip title="新任務沒有指定輸出資料夾時的預設位置；每個任務可自行覆寫">
            <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>
              預設輸出資料夾
            </Typography>
          </Tooltip>
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
                <Tooltip title="開啟本機原生資料夾選擇對話框">
                  <span>
                    <Button size="small" onClick={pickFolder} disabled={saving || picking}>
                      {picking ? '選擇中…' : '選擇…'}
                    </Button>
                  </span>
                </Tooltip>
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
              <Stack direction="row" spacing={1}>
                <Tooltip title="開啟本機原生資料夾選擇對話框">
                  <span>
                    <Button size="small" onClick={pickFolder} disabled={!value || picking}>
                      {picking ? '選擇中…' : '選擇…'}
                    </Button>
                  </span>
                </Tooltip>
                <Button size="small" onClick={startEdit} disabled={!value}>變更</Button>
              </Stack>
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

function Sidebar({ jobs, selected, onSelect, onRefresh, onDeleted }: {
  jobs: JobSummary[]; selected: string | null;
  onSelect: (id: string | null) => void; onRefresh: () => void;
  onDeleted: (id: string) => void;
}) {
  const [deleting, setDeleting] = useState<string | null>(null)
  const isTerminal = (s: JobStatus) => s === 'done' || s === 'error' || s === 'cancelled'

  const handleDelete = async (id: string) => {
    setDeleting(id)
    try {
      const r = await fetch(`/api/jobs/${id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      onDeleted(id)
    } catch { /* keep UI; next refresh will reconcile */ }
    finally { setDeleting(null) }
  }

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
            <ListItem
              key={j.id}
              disablePadding
              sx={{ mb: 0.5 }}
              secondaryAction={isTerminal(j.status) ? (
                <Tooltip title="從清單移除">
                  <span>
                    <IconButton
                      edge="end"
                      size="small"
                      disabled={deleting === j.id}
                      onClick={(e) => { e.stopPropagation(); handleDelete(j.id) }}
                    >
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              ) : null}
            >
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

const NEWJOB_PREFS_KEY = 'meet.newjob.prefs.v1'
type NewJobPrefs = {
  mode: 'file' | 'live'
  language: string
  model: string
  vad: boolean
  listenUrl: string
  chunkSeconds: number
  label: string
  record: boolean
  recordKind: 'audio' | 'video'
  recordAudioFormat: 'm4a' | 'mp3' | 'wav'
  recordVideoFormat: 'mkv' | 'mp4' | 'ts'
  outputDir: string
}
const NEWJOB_DEFAULTS: NewJobPrefs = {
  mode: 'file',
  language: 'auto',
  // Empty = "whatever the backend reports as default"; filled in once
  // /api/models resolves, so we never hard-code a model the backend may
  // have overridden via WHISPER_MODEL.
  model: '',
  vad: true,
  listenUrl: 'tcp://0.0.0.0:9999?listen=1',
  chunkSeconds: 6,
  label: '',
  record: false,
  recordKind: 'audio',
  recordAudioFormat: 'm4a',
  recordVideoFormat: 'mkv',
  outputDir: '',
}
const loadNewJobPrefs = (): NewJobPrefs => {
  try {
    const raw = localStorage.getItem(NEWJOB_PREFS_KEY)
    if (!raw) return NEWJOB_DEFAULTS
    return { ...NEWJOB_DEFAULTS, ...(JSON.parse(raw) as Partial<NewJobPrefs>) }
  } catch {
    return NEWJOB_DEFAULTS
  }
}

function NewJob({ onCreated, defaultOutputsDir }: {
  onCreated: (id: string, autoSelect?: boolean) => void
  defaultOutputsDir: string | null
}) {
  const initial = loadNewJobPrefs()
  const [mode, setMode] = useState<'file' | 'live'>(initial.mode)
  const [files, setFiles] = useState<File[]>([])
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null)
  const [language, setLanguage] = useState(initial.language)
  const [model, setModel] = useState(initial.model)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [vad, setVad] = useState(initial.vad)
  const [listenUrl, setListenUrl] = useState(initial.listenUrl)
  const [chunkSeconds, setChunkSeconds] = useState(initial.chunkSeconds)
  const [label, setLabel] = useState(initial.label)
  const [record, setRecord] = useState(initial.record)
  const [recordKind, setRecordKind] = useState<'audio' | 'video'>(initial.recordKind)
  const [recordAudioFormat, setRecordAudioFormat] = useState<'m4a' | 'mp3' | 'wav'>(initial.recordAudioFormat)
  const [recordVideoFormat, setRecordVideoFormat] = useState<'mkv' | 'mp4' | 'ts'>(initial.recordVideoFormat)
  const [outputDir, setOutputDir] = useState(initial.outputDir)
  const [pickingOutputDir, setPickingOutputDir] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Model catalog is backend-owned (it knows which weights are on disk and
  // what the configured default is), so fetch rather than hard-code it.
  useEffect(() => {
    const ctrl = new AbortController()
    ;(async () => {
      try {
        const r = await fetch('/api/models', { signal: ctrl.signal })
        if (!r.ok) return
        const data = await r.json()
        setModels(data.models ?? [])
        // Only adopt the backend default when the user has no stored choice.
        setModel((cur) => cur || (data.default as string) || '')
      } catch { /* offline backend — the Select just stays empty */ }
    })()
    return () => ctrl.abort()
  }, [])

  const pickOutputDir = async () => {
    setPickingOutputDir(true)
    try {
      const r = await fetch('/api/outputs-dir/pick', { method: 'POST' })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data?.detail || `HTTP ${r.status}`)
      const path = (data?.path as string) || ''
      if (path) setOutputDir(path)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setPickingOutputDir(false)
    }
  }

  // When entering live mode, ask the backend for a listen URL whose port
  // isn't already used by another active live job — that's what makes
  // running multiple OBS streams (one per port) work without collision.
  useEffect(() => {
    if (mode !== 'live') return
    const ctrl = new AbortController()
    ;(async () => {
      try {
        const r = await fetch(`/api/live/suggest?base=${encodeURIComponent(listenUrl)}`, { signal: ctrl.signal })
        if (!r.ok) return
        const data = await r.json()
        const suggested = data.listen_url as string | undefined
        if (suggested && suggested !== listenUrl) {
          setListenUrl(suggested)
        }
      } catch { /* ignore — keep whatever the user already has */ }
    })()
    return () => ctrl.abort()
    // Only re-run when switching tabs; we don't want to fight the user
    // while they're typing into the field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  const persistPrefs = () => {
    const prefs: NewJobPrefs = {
      mode, language, model, vad, listenUrl, chunkSeconds, label,
      record, recordKind, recordAudioFormat, recordVideoFormat,
      outputDir,
    }
    try { localStorage.setItem(NEWJOB_PREFS_KEY, JSON.stringify(prefs)) } catch { /* ignore quota */ }
  }

  const selectedModel = models.find((m) => m.id === model) ?? null
  // A chunk must finish transcribing before the next one arrives. Models
  // slower than real time can't win that race at any chunk size, so they get
  // a hard warning; the rest just need a chunk long enough to amortize their
  // per-chunk cost, which we offer to apply in one click.
  const liveTooSlow = mode === 'live' && selectedModel !== null && !selectedModel.live_viable
  const chunkTooShort = mode === 'live' && selectedModel !== null
    && selectedModel.live_viable && chunkSeconds < selectedModel.live_chunk
  const fasterLiveModel = models.find((m) => m.live_viable && m.cached)?.id ?? 'medium'

  const handleStartFile = async () => {
    if (files.length === 0 || submitting) return
    persistPrefs()
    setSubmitting(true); setError(null)
    setBatchProgress({ done: 0, total: files.length })
    const errors: string[] = []
    let lastId: string | null = null
    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      const form = new FormData()
      form.append('file', f)
      if (language) form.append('language', language)
      if (model) form.append('model', model)
      form.append('vad', vad ? 'true' : 'false')
      if (outputDir.trim()) form.append('output_dir', outputDir.trim())
      try {
        const r = await fetch('/api/jobs', { method: 'POST', body: form })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const data = await r.json()
        lastId = data.id
        // refresh sidebar after every job; do NOT auto-select so user stays on the form
        onCreated(data.id, false)
      } catch (e) {
        errors.push(`${f.name}: ${(e as Error).message}`)
      }
      setBatchProgress({ done: i + 1, total: files.length })
    }
    if (errors.length) setError(errors.join('\n'))
    setBatchProgress(null)
    setSubmitting(false)
    if (errors.length === 0) {
      setFiles([])
      // single file: keep legacy behavior of jumping to detail
      if (files.length === 1 && lastId) onCreated(lastId, true)
    }
  }

  const handleStartLive = async () => {
    if (!listenUrl || submitting) return
    persistPrefs()
    setSubmitting(true); setError(null)
    const form = new FormData()
    form.append('listen_url', listenUrl)
    if (language) form.append('language', language)
    if (model) form.append('model', model)
    form.append('vad', vad ? 'true' : 'false')
    form.append('chunk_seconds', String(chunkSeconds))
    if (label) form.append('label', label)
    form.append('record', record ? 'true' : 'false')
    if (record) {
      form.append('record_kind', recordKind)
      form.append('record_format', recordKind === 'audio' ? recordAudioFormat : recordVideoFormat)
    }
    if (outputDir.trim()) form.append('output_dir', outputDir.trim())
    try {
      const r = await fetch('/api/live', { method: 'POST', body: form })
      if (!r.ok) {
        const payload = await r.json().catch(() => null)
        const detail = payload?.detail
        if (r.status === 409 && detail && typeof detail === 'object') {
          const suggested = detail.suggested_listen_url as string | undefined
          if (suggested) setListenUrl(suggested)
          throw new Error(
            `${detail.message || '監聽埠衝突'}` +
            (suggested ? `\n已自動建議改用：${suggested}（再按一次開始監聽）` : ''),
          )
        }
        throw new Error(typeof detail === 'string' ? detail : `HTTP ${r.status}`)
      }
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
            <Stack direction="row" spacing={1} sx={{ mb: files.length ? 1 : 0, alignItems: 'center' }}>
              <Button variant="outlined" component="label">
                {files.length === 0
                  ? '選擇音訊／影片檔（可多選）'
                  : `已選 ${files.length} 個檔案（再點可累加）`}
                <input
                  hidden
                  type="file"
                  accept="audio/*,video/*"
                  multiple
                  onChange={(e) => {
                    const picked = Array.from(e.target.files ?? [])
                    if (picked.length === 0) return
                    setFiles((prev) => {
                      const seen = new Set(prev.map((f) => `${f.name}|${f.size}|${f.lastModified}`))
                      const merged = [...prev]
                      for (const f of picked) {
                        const key = `${f.name}|${f.size}|${f.lastModified}`
                        if (!seen.has(key)) { merged.push(f); seen.add(key) }
                      }
                      return merged
                    })
                    // allow re-picking the same file later
                    e.target.value = ''
                  }}
                />
              </Button>
              {files.length > 0 && (
                <Button size="small" onClick={() => setFiles([])} disabled={submitting}>清空</Button>
              )}
            </Stack>
            {files.length > 0 && (
              <List dense disablePadding sx={{ maxHeight: 200, overflowY: 'auto', border: 1, borderColor: 'divider', borderRadius: 1 }}>
                {files.map((f, i) => (
                  <ListItem
                    key={`${f.name}-${f.size}-${f.lastModified}-${i}`}
                    secondaryAction={
                      <Button
                        size="small"
                        onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                        disabled={submitting}
                      >
                        移除
                      </Button>
                    }
                  >
                    <ListItemText
                      primary={f.name}
                      secondary={`${(f.size / (1024 * 1024)).toFixed(1)} MB`}
                      slotProps={{ primary: { noWrap: true, variant: 'body2' } }}
                    />
                  </ListItem>
                ))}
              </List>
            )}
            {batchProgress && (
              <Box sx={{ mt: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  建立任務中… {batchProgress.done}/{batchProgress.total}
                </Typography>
                <LinearProgress
                  variant="determinate"
                  value={(batchProgress.done / Math.max(1, batchProgress.total)) * 100}
                  sx={{ mt: 0.5, height: 4, borderRadius: 2 }}
                />
              </Box>
            )}
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
                slotProps={{ htmlInput: { min: 2, max: 60 } }}
                sx={{ width: 140 }}
              />
            </Stack>
            {liveTooSlow && selectedModel && (
              <Alert
                severity="error"
                variant="outlined"
                action={
                  <Button size="small" color="inherit" onClick={() => setModel(fasterLiveModel)}>
                    改用 {fasterLiveModel}
                  </Button>
                }
              >
                <Typography variant="body2">
                  <strong>{selectedModel.id}</strong> 在 CPU 上約需 {selectedModel.rtf}× 實時
                  （轉 1 秒音訊要花 {selectedModel.rtf} 秒），比串流進來的速度還慢——
                  <strong>不論 chunk 秒數設多少都會愈落後愈多</strong>，直到記憶體被待處理音訊塞爆。
                  直播請用 <strong>{fasterLiveModel}</strong>；{selectedModel.id} 留給事後轉檔案。
                </Typography>
              </Alert>
            )}
            {chunkTooShort && selectedModel && (
              <Alert
                severity="warning"
                variant="outlined"
                action={
                  <Button size="small" onClick={() => setChunkSeconds(selectedModel.live_chunk)}>
                    改成 {selectedModel.live_chunk}s
                  </Button>
                }
              >
                <Typography variant="body2">
                  <strong>{selectedModel.id}</strong> 在 CPU 上轉一段 {chunkSeconds}s 的音訊，
                  所需時間可能超過 {chunkSeconds}s —— 逐字稿會愈落後愈多。
                  建議 chunk 秒數設為 <strong>{selectedModel.live_chunk}s</strong> 以上
                  （代價是每段字幕最多延遲 {selectedModel.live_chunk} 秒才出現）。
                </Typography>
              </Alert>
            )}
            <FormControlLabel
              control={
                <Checkbox checked={record} onChange={(e) => setRecord(e.target.checked)} />
              }
              label="同步保留原始檔（存到 outputs/）"
            />
            {record && (
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
                <ToggleButtonGroup
                  size="small"
                  exclusive
                  value={recordKind}
                  onChange={(_, v) => v && setRecordKind(v)}
                >
                  <ToggleButton value="audio">純音檔</ToggleButton>
                  <ToggleButton value="video">影片（含音訊）</ToggleButton>
                </ToggleButtonGroup>
                {recordKind === 'audio' ? (
                  <FormControl size="small" sx={{ maxWidth: 320, minWidth: 200 }}>
                    <InputLabel>格式</InputLabel>
                    <Select
                      label="格式"
                      value={recordAudioFormat}
                      onChange={(e) => setRecordAudioFormat(e.target.value as 'm4a' | 'mp3' | 'wav')}
                    >
                      <MenuItem value="m4a">m4a（推薦，不重編）</MenuItem>
                      <MenuItem value="mp3">mp3（重編，相容性最高）</MenuItem>
                      <MenuItem value="wav">wav（無損，檔案大）</MenuItem>
                    </Select>
                  </FormControl>
                ) : (
                  <FormControl size="small" sx={{ maxWidth: 320, minWidth: 200 }}>
                    <InputLabel>格式</InputLabel>
                    <Select
                      label="格式"
                      value={recordVideoFormat}
                      onChange={(e) => setRecordVideoFormat(e.target.value as 'mkv' | 'mp4' | 'ts')}
                    >
                      <MenuItem value="mkv">mkv（推薦，串流斷掉也不會壞）</MenuItem>
                      <MenuItem value="mp4">mp4</MenuItem>
                      <MenuItem value="ts">ts</MenuItem>
                    </Select>
                  </FormControl>
                )}
              </Stack>
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

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 2, alignItems: { sm: 'center' } }}>
          <TextField
            size="small"
            label="輸出資料夾（留空則用預設）"
            value={outputDir}
            onChange={(e) => setOutputDir(e.target.value)}
            placeholder={defaultOutputsDir ?? '/絕對路徑/到/輸出資料夾'}
            fullWidth
            slotProps={{ input: { sx: { fontFamily: 'ui-monospace, monospace', fontSize: 13 } } }}
          />
          <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
            <Tooltip title="開啟本機原生資料夾選擇對話框">
              <span>
                <Button size="small" onClick={pickOutputDir} disabled={pickingOutputDir} sx={{ whiteSpace: 'nowrap', minWidth: 'auto' }}>
                  {pickingOutputDir ? '選擇中…' : '選擇…'}
                </Button>
              </span>
            </Tooltip>
            {outputDir && (
              <Button size="small" onClick={() => setOutputDir('')} sx={{ whiteSpace: 'nowrap', minWidth: 'auto' }}>清除</Button>
            )}
          </Stack>
        </Stack>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 1.5 }}>
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
          <FormControl size="small" sx={{ minWidth: 260 }} disabled={models.length === 0}>
            <InputLabel>模型</InputLabel>
            <Select label="模型" value={models.length ? model : ''} onChange={(e) => setModel(e.target.value)}>
              {models.map((m) => (
                <MenuItem key={m.id} value={m.id}>
                  {m.id} · {m.note}{m.cached ? '' : `（未下載 ${m.size}）`}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControlLabel
            control={<Checkbox checked={vad} onChange={(e) => setVad(e.target.checked)} />}
            label="VAD（過濾靜音）"
          />
        </Stack>

        {selectedModel && !selectedModel.cached && (
          <Alert severity="info" variant="outlined" sx={{ mb: 2 }}>
            <Typography variant="body2">
              第一次使用 <strong>{selectedModel.id}</strong> 會先下載約 {selectedModel.size} 的權重，
              這段期間任務會停在開頭不動，屬正常現象。下載完成後就會快取起來，之後不用再等。
            </Typography>
          </Alert>
        )}
        {selectedModel?.cached && <Box sx={{ mb: 1.5 }} />}

        {mode === 'file' ? (
          <Button
            variant="contained"
            onClick={handleStartFile}
            disabled={files.length === 0 || submitting}
            startIcon={<PlayArrowIcon />}
          >
            {files.length > 1 ? `開始轉錄 ${files.length} 個檔案` : '開始轉錄'}
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

function JobDetail({ jobId, onChange, onCancelPendingChange }: {
  jobId: string
  onChange: () => void
  onCancelPendingChange?: (pending: boolean) => void
}) {
  const [estimate, setEstimate] = useState<Estimate | null>(null)
  const [info, setInfo] = useState<Info | null>(null)
  const [segments, setSegments] = useState<Segment[]>([])
  const [status, setStatus] = useState<JobStatus>('queued')
  const [error, setError] = useState<string | null>(null)
  const [filename, setFilename] = useState<string>('')
  const [live, setLive] = useState<boolean>(false)
  const [listenUrl, setListenUrl] = useState<string | null>(null)
  const [listening, setListening] = useState<boolean>(false)
  const [receiving, setReceiving] = useState<boolean>(false)
  const [recordPath, setRecordPath] = useState<string | null>(null)
  const [recordKind, setRecordKind] = useState<'audio' | 'video' | null>(null)
  const transcriptRef = useRef<HTMLDivElement | null>(null)
  const autoScrollRef = useRef(true)
  const sseAbortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    setEstimate(null); setInfo(null); setSegments([]); setError(null); setStatus('queued'); setListening(false); setReceiving(false)
    fetch(`/api/jobs/${jobId}`).then((r) => r.json()).then((j) => {
      setFilename(j.filename || '')
      setLive(!!j.live)
      setListenUrl(j.listen_url || null)
      setRecordPath(j.record_path || null)
      setRecordKind(j.record_kind || null)
    })
    const ctrl = new AbortController()
    sseAbortRef.current = ctrl
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
            else if (ev.type === 'receiving') setReceiving(true)
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

  const [pendingAction, setPendingAction] = useState<'pause' | 'resume' | 'cancel' | null>(null)
  const action = async (a: 'pause' | 'resume' | 'cancel') => {
    setPendingAction(a)
    // For live jobs: stop syncing immediately and do NOT lock navigation.
    // The user explicitly wants the task page unlocked the moment they press stop,
    // and all backend↔frontend sync (SSE) terminated.
    if (a === 'cancel' && live) {
      sseAbortRef.current?.abort()
      setStatus('cancelled')
      setListening(false)
    }
    // For file jobs we still surface the (brief) cancel-pending state so the
    // user knows the worker is winding down — but we no longer block the UI
    // for live jobs.
    if (a === 'cancel' && !live) onCancelPendingChange?.(true)
    try {
      await fetch(`/api/jobs/${jobId}/${a}`, { method: 'POST' })
      onChange()
    } finally {
      setPendingAction(null)
      if (a === 'cancel' && !live) onCancelPendingChange?.(false)
    }
  }

  // Safety net: if this JobDetail unmounts while a cancel is pending (e.g.
  // user navigated away despite the guard), make sure the App-level lock
  // doesn't get stuck on.
  useEffect(() => {
    return () => { onCancelPendingChange?.(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
              <Button
                startIcon={<PauseIcon />}
                onClick={() => action('pause')}
                disabled={pendingAction !== null}
              >
                {pendingAction === 'pause' ? '暫停中…' : '暫停'}
              </Button>
            )}
            {!live && status === 'paused' && (
              <Button
                startIcon={<PlayArrowIcon />}
                onClick={() => action('resume')}
                disabled={pendingAction !== null}
              >
                {pendingAction === 'resume' ? '繼續中…' : '繼續'}
              </Button>
            )}
            {isActive && (
              <Button
                color="error"
                variant="contained"
                startIcon={<StopIcon />}
                onClick={() => action('cancel')}
                disabled={pendingAction !== null}
              >
                {pendingAction === 'cancel'
                  ? (live ? '停止中…' : '終止中…')
                  : (live ? '停止監聽' : '終止')}
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
                {recordKind === 'audio' ? '下載音檔' : '下載錄影'}
              </Button>
            )}
          </Stack>
        </CardContent>
      </Card>

      {error && <Alert severity="error">錯誤：{error}</Alert>}

      {pendingAction === 'cancel' && (
        <Alert severity="warning">
          {live
            ? '正在停止監聽…等待 ffmpeg 結束並釋放監聽埠（最多 5 秒）。在此期間請不要重複按按鈕。'
            : '正在終止任務…等待 worker 行程結束（最多 5 秒）。'}
        </Alert>
      )}

      {live && (
        <Alert severity="info" icon={<VideocamIcon />}>
          🔴 直播模式 · 監聽：<code>{listenUrl}</code>{' '}
          {!isActive
            ? status === 'error'
              ? '（❌ 串流異常已結束）'
              : status === 'cancelled'
                ? '（🛑 已手動停止）'
                : receiving
                  ? '（🛑 OBS 已中斷，串流結束）'
                  : '（已結束，未收到任何音訊）'
            : receiving
              ? '（🎧 已接收到 OBS 音訊串流）'
              : listening
                ? '（已就緒，等待 OBS 連入或音訊…）'
                : '（啟動中，模型載入後會開始監聽）'}
          {recordPath && (
            <Box sx={{ mt: 0.5 }}>
              {recordKind === 'audio' ? '🎙️ 同步錄音' : '🎬 同步錄影'}：<code>{recordPath}</code>
            </Box>
          )}
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

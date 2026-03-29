import { useState, useEffect, useRef, useCallback } from 'react'
import AgentStrip from './components/AgentStrip'
import BriefInput from './components/BriefInput'
import LiveLog from './components/LiveLog'
import Header from './components/Header'
import CodeViewer from './components/CodeViewer'

export interface AgentDef {
  id: string; name: string; icon: string; color: string
}
export interface LogEntry {
  agent_id: string; agent_name: string; message: string; timestamp: string
}
export type AgentStatus = 'idle' | 'working' | 'done' | 'failed'

interface TestResult { name: string; status: string }
interface TestResults { passed: number; failed: number; total: number; tests: TestResult[] }

interface ProjectSummary {
  id: string; brief: string; status: string; created_at: string
  preview_url?: string | null; code_url?: string | null
  agents: Record<string, string>; test_results?: TestResults | null
}

const API = import.meta.env.VITE_API_URL || ''
const WS_URL = import.meta.env.VITE_WS_URL ||
  `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`

export default function App() {
  const [agents, setAgents] = useState<AgentDef[]>([])
  const [statuses, setStatuses] = useState<Record<string, AgentStatus>>({})
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [projectId, setProjectId] = useState<string | null>(null)
  const [phase, setPhase] = useState<'idle' | 'running' | 'done' | 'failed'>('idle')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [codeUrl, setCodeUrl] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<TestResults | null>(null)
  const [showCode, setShowCode] = useState(false)
  const [showTests, setShowTests] = useState(false)
  const [showDeploy, setShowDeploy] = useState(false)
  const [history, setHistory] = useState<ProjectSummary[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [activeBrief, setActiveBrief] = useState<string | null>(null)
  const [iterateMsg, setIterateMsg] = useState('')
  const wsRef = useRef<WebSocket | null>(null)

  const resetIdle = (agentList: AgentDef[]) => {
    const init: Record<string, AgentStatus> = {}
    agentList.forEach(a => init[a.id] = 'idle')
    return init
  }

  // Fetch agent definitions + check for active/running project
  useEffect(() => {
    fetch(`${API}/api/agents`).then(r => r.json()).then((data: AgentDef[]) => {
      setAgents(data)
      setStatuses(resetIdle(data))

      // Check if there's a running project to restore
      fetch(`${API}/api/projects/active`).then(r => r.json()).then((active: any) => {
        if (active && active.id) {
          setProjectId(active.id)
          setPhase(active.status === 'running' ? 'running' : active.status === 'completed' ? 'done' : active.status === 'failed' ? 'failed' : 'idle')
          setActiveBrief(active.brief || null)
          if (active.preview_url) setPreviewUrl(active.preview_url)
          // Restore agent statuses
          if (active.agents) {
            const restored: Record<string, AgentStatus> = {}
            data.forEach(a => {
              const s = active.agents[a.id]
              restored[a.id] = (s === 'done' || s === 'working' || s === 'failed') ? s as AgentStatus : 'idle'
            })
            setStatuses(restored)
          }
        }
      }).catch(() => {})
    }).catch(() => {})

    // Load history
    fetch(`${API}/api/projects`).then(r => r.json()).then((data: ProjectSummary[]) => {
      if (Array.isArray(data)) setHistory(data)
    }).catch(() => {})
  }, [])

  // WebSocket connection with auto-reconnect
  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout>

    function connect() {
      const ws = new WebSocket(WS_URL)
      wsRef.current = ws

      ws.onmessage = (ev) => {
        const event = JSON.parse(ev.data)

        if (event.type === 'agent_status') {
          setStatuses(prev => ({ ...prev, [event.agent_id]: event.status }))
        }

        if (event.type === 'log') {
          setLogs(prev => [...prev, {
            agent_id: event.agent_id,
            agent_name: event.agent_name,
            message: event.message,
            timestamp: event.timestamp,
          }])
        }

        if (event.type === 'project_complete') {
          setPhase('done')
          setPreviewUrl(event.preview_url)
          setCodeUrl(event.code_url || null)
          setTestResults(event.test_results || null)
          // Refresh history
          fetch(`${API}/api/projects`).then(r => r.json()).then((data: ProjectSummary[]) => {
            if (Array.isArray(data)) setHistory(data)
          }).catch(() => {})
        }

        if (event.type === 'project_failed') {
          setPhase('failed')
          fetch(`${API}/api/projects`).then(r => r.json()).then((data: ProjectSummary[]) => {
            if (Array.isArray(data)) setHistory(data)
          }).catch(() => {})
        }

        if (event.type === 'project_started') {
          setPhase('running')
          setProjectId(event.project_id)
          setActiveBrief(event.brief || null)
        }
      }

      ws.onclose = () => {
        reconnectTimer = setTimeout(connect, 2000)
      }
    }

    connect()

    return () => {
      clearTimeout(reconnectTimer)
      wsRef.current?.close()
    }
  }, [])

  const handleBrief = useCallback(async (message: string) => {
    setLogs([])
    setPreviewUrl(null)
    setCodeUrl(null)
    setTestResults(null)
    setShowCode(false)
    setShowTests(false)
    setShowDeploy(false)
    const init: Record<string, AgentStatus> = {}
    agents.forEach(a => init[a.id] = 'idle')
    setStatuses(init)

    const res = await fetch(`${API}/api/briefings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    })
    const data = await res.json()
    if (data.error === 'busy') {
      // Already running — restore that project
      setPhase('running')
      setProjectId(data.project_id)
      return
    }
    setPhase('running')
    setProjectId(data.id)
    setActiveBrief(message)
  }, [agents])

  const handleIterate = useCallback(async () => {
    if (!iterateMsg.trim() || !projectId) return
    const msg = iterateMsg.trim()
    setIterateMsg('')
    setPhase('running')
    setShowCode(false)
    setShowTests(false)
    setShowDeploy(false)
    setTestResults(null)
    const init: Record<string, AgentStatus> = {}
    agents.forEach(a => init[a.id] = 'idle')
    setStatuses(init)

    await fetch(`${API}/api/projects/${projectId}/iterate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg }),
    })
  }, [iterateMsg, projectId, agents])

  const restoreProject = useCallback(async (p: ProjectSummary) => {
    setProjectId(p.id)
    setActiveBrief(p.brief)
    setPhase(p.status === 'completed' ? 'done' : p.status === 'failed' ? 'failed' : 'running')
    setPreviewUrl(p.preview_url || null)
    setCodeUrl(p.code_url || null)
    setTestResults(p.test_results || null)
    setShowCode(false)
    setShowTests(false)
    setShowDeploy(false)
    // Restore agent statuses
    const restored: Record<string, AgentStatus> = {}
    for (const a of agents) {
      const s = p.agents?.[a.id]
      restored[a.id] = (s === 'done' || s === 'working' || s === 'failed' || s === 'idle') ? s as AgentStatus : 'idle'
    }
    setStatuses(restored)
    // Load persisted logs
    try {
      const res = await fetch(`${API}/api/projects/${p.id}/logs`)
      const data = await res.json()
      if (Array.isArray(data.logs)) setLogs(data.logs)
      else setLogs([])
    } catch {
      setLogs([])
    }
  }, [agents])

  const activeAgent = agents.find(a => statuses[a.id] === 'working') || null
  const doneCount = Object.values(statuses).filter(s => s === 'done').length

  // Past projects (not the current one)
  const pastProjects = history.filter(p => p.id !== projectId)

  // Filtered logs for panels
  const testLogs = logs.filter(l => l.agent_id === 'qa' && (l.message.includes('✅') || l.message.includes('❌') || l.message.includes('🧪') || l.message.includes('Tests:')))
  const deployLogs = logs.filter(l => l.agent_name === 'Build' || l.agent_name === 'QA' && l.message.includes('🧪') || (l.agent_id === 'devops'))

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 20px' }}>
      <Header />

      <AgentStrip
        agents={agents}
        statuses={statuses}
        activeAgent={activeAgent}
      />

      {phase === 'idle' && <BriefInput onSubmit={handleBrief} />}

      {phase === 'running' && (
        <div className="animate-in" style={{ marginTop: 20 }}>
          <div style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: '16px 20px',
            marginBottom: 16,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 10, height: 10, borderRadius: '50%',
                background: 'var(--cyan)',
                animation: 'pulse-glow 1.5s infinite',
                ['--glow-color' as string]: 'var(--cyan)',
              }} />
              <span style={{ color: 'var(--text-dim)', fontFamily: 'var(--mono)', fontSize: 13 }}>
                Procesando brief — {doneCount}/{agents.length} agentes completados
              </span>
              <div style={{
                marginLeft: 'auto',
                width: 120, height: 4,
                background: 'var(--surface-2)',
                borderRadius: 2,
                overflow: 'hidden',
              }}>
                <div style={{
                  width: `${(doneCount / agents.length) * 100}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, var(--cyan), var(--purple))',
                  borderRadius: 2,
                  transition: 'width 0.5s ease',
                }} />
              </div>
            </div>
            {activeBrief && (
              <div style={{
                marginTop: 10,
                padding: '8px 12px',
                background: 'var(--bg)',
                borderRadius: 8,
                fontSize: 12,
                color: 'var(--text-dim)',
                fontFamily: 'var(--mono)',
                whiteSpace: 'pre-wrap',
                maxHeight: 60,
                overflow: 'hidden',
              }}>
                📋 {activeBrief}
              </div>
            )}
          </div>
        </div>
      )}

      {phase === 'done' && (
        <div className="animate-in" style={{ marginTop: 20 }}>
          {/* Success header */}
          <div style={{
            background: 'linear-gradient(135deg, rgba(16,185,129,.1), rgba(6,182,212,.1))',
            border: '1px solid rgba(16,185,129,.3)',
            borderRadius: 12,
            padding: '20px 24px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 32 }}>✅</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 16 }}>Proyecto Completado</div>
                <div style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: 4 }}>
                  Los 7 agentes terminaron exitosamente
                  {testResults && testResults.total > 0 && (
                    <span> — {testResults.passed}/{testResults.total} tests pasaron</span>
                  )}
                </div>
              </div>
            </div>

            {/* Action buttons row */}
            <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
              {previewUrl && (
                <a href={previewUrl} target="_blank" rel="noreferrer" style={{
                  background: 'var(--green)',
                  color: '#000',
                  padding: '10px 20px',
                  borderRadius: 8,
                  fontWeight: 600,
                  fontSize: 13,
                  textDecoration: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}>
                  🚀 Ver App
                </a>
              )}
              {projectId && (
                <button onClick={() => { setShowCode(!showCode); setShowTests(false); setShowDeploy(false) }} style={{
                  background: showCode ? 'var(--cyan)' : 'var(--surface-2)',
                  color: showCode ? '#000' : 'var(--text)',
                  border: '1px solid var(--border)',
                  padding: '10px 20px',
                  borderRadius: 8,
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}>
                  💻 {showCode ? 'Ocultar Código' : 'Ver Código'}
                </button>
              )}
              <button onClick={() => { setShowTests(!showTests); setShowCode(false); setShowDeploy(false) }} style={{
                background: showTests ? 'var(--purple)' : 'var(--surface-2)',
                color: showTests ? '#fff' : 'var(--text)',
                border: '1px solid var(--border)',
                padding: '10px 20px',
                borderRadius: 8,
                fontWeight: 600,
                fontSize: 13,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}>
                🧪 {showTests ? 'Ocultar Tests' : 'Ver Tests'}
              </button>
              <button onClick={() => { setShowDeploy(!showDeploy); setShowCode(false); setShowTests(false) }} style={{
                background: showDeploy ? 'var(--pink)' : 'var(--surface-2)',
                color: showDeploy ? '#fff' : 'var(--text)',
                border: '1px solid var(--border)',
                padding: '10px 20px',
                borderRadius: 8,
                fontWeight: 600,
                fontSize: 13,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}>
                🚀 {showDeploy ? 'Ocultar Deploy' : 'Ver Deploy'}
              </button>
              <button onClick={() => { setPhase('idle'); setLogs([]); setActiveBrief(null); setShowCode(false); setShowTests(false); setShowDeploy(false) }} style={{
                background: 'var(--surface-2)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                padding: '10px 20px',
                borderRadius: 8,
                fontWeight: 500,
                fontSize: 13,
                cursor: 'pointer',
              }}>
                ✨ Nuevo Brief
              </button>
            </div>

            {/* Iterate chat input */}
            <div style={{
              marginTop: 14,
              display: 'flex',
              gap: 8,
            }}>
              <input
                type="text"
                value={iterateMsg}
                onChange={e => setIterateMsg(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleIterate() } }}
                placeholder="Pide un cambio... ej: 'cambia los colores a azul', 'añade un botón de exportar'"
                style={{
                  flex: 1,
                  background: 'var(--bg)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: '10px 14px',
                  color: 'var(--text)',
                  fontSize: 13,
                  fontFamily: 'var(--font)',
                  outline: 'none',
                }}
              />
              <button
                onClick={handleIterate}
                disabled={!iterateMsg.trim()}
                style={{
                  background: iterateMsg.trim() ? 'var(--cyan)' : 'var(--surface-2)',
                  color: iterateMsg.trim() ? '#000' : 'var(--text-dim)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: '10px 16px',
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: iterateMsg.trim() ? 'pointer' : 'default',
                  whiteSpace: 'nowrap',
                }}
              >
                💬 Iterar
              </button>
            </div>

            {/* Test results summary (always visible) */}
            {testResults && testResults.total > 0 && (
              <div style={{
                marginTop: 14,
                display: 'flex',
                gap: 12,
                alignItems: 'center',
                padding: '8px 12px',
                background: 'var(--bg)',
                borderRadius: 8,
                border: '1px solid var(--border)',
              }}>
                <span style={{ fontSize: 14 }}>🧪</span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--green)', fontWeight: 600 }}>
                  ✅ {testResults.passed} pasaron
                </span>
                {testResults.failed > 0 && (
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--red)', fontWeight: 600 }}>
                    ❌ {testResults.failed} fallaron
                  </span>
                )}
                <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-dim)' }}>
                  ({testResults.total} total)
                </span>
              </div>
            )}
          </div>

          {/* Tests panel (toggle) */}
          {showTests && (
            <div className="animate-in" style={{
              marginTop: 16,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              overflow: 'hidden',
            }}>
              <div style={{
                padding: '12px 16px',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}>
                <span style={{ fontSize: 14 }}>🧪</span>
                <span style={{
                  fontSize: 12,
                  fontFamily: 'var(--mono)',
                  fontWeight: 600,
                  color: 'var(--purple)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}>
                  Resultados de Tests
                </span>
              </div>
              <div style={{ padding: '12px 16px', fontFamily: 'var(--mono)', fontSize: 12 }}>
                {testResults && testResults.tests.length > 0 ? (
                  testResults.tests.map((t, i) => (
                    <div key={i} style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '6px 0',
                      borderBottom: i < testResults.tests.length - 1 ? '1px solid var(--border)' : 'none',
                    }}>
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 22, height: 22,
                        borderRadius: 6,
                        background: t.status === 'passed' ? 'rgba(16,185,129,.15)' : 'rgba(239,68,68,.15)',
                        fontSize: 12,
                      }}>
                        {t.status === 'passed' ? '✅' : '❌'}
                      </span>
                      <span style={{ color: t.status === 'passed' ? 'var(--green)' : 'var(--red)' }}>
                        {t.name}
                      </span>
                    </div>
                  ))
                ) : testLogs.length > 0 ? (
                  testLogs.map((log, i) => (
                    <div key={i} style={{ color: 'var(--text)', padding: '3px 0' }}>
                      {log.message}
                    </div>
                  ))
                ) : (
                  <div style={{ color: 'var(--text-dim)', padding: 8 }}>No hay resultados de tests disponibles</div>
                )}
              </div>
            </div>
          )}

          {/* Deploy panel (toggle) */}
          {showDeploy && (
            <div className="animate-in" style={{
              marginTop: 16,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              overflow: 'hidden',
            }}>
              <div style={{
                padding: '12px 16px',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}>
                <span style={{ fontSize: 14 }}>🚀</span>
                <span style={{
                  fontSize: 12,
                  fontFamily: 'var(--mono)',
                  fontWeight: 600,
                  color: 'var(--pink)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}>
                  Pipeline de Deploy
                </span>
              </div>
              <div style={{ padding: '12px 16px', fontFamily: 'var(--mono)', fontSize: 12 }}>
                {deployLogs.length > 0 ? (
                  deployLogs.map((log, i) => {
                    const isSuccess = log.message.includes('successful') || log.message.includes('installed') || log.message.includes('Completed')
                    const isFail = log.message.includes('failed') || log.message.includes('error')
                    return (
                      <div key={i} style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 10,
                        padding: '6px 0',
                        borderBottom: i < deployLogs.length - 1 ? '1px solid var(--border)' : 'none',
                      }}>
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: 22, height: 22,
                          borderRadius: 6,
                          background: isFail ? 'rgba(239,68,68,.15)' : isSuccess ? 'rgba(16,185,129,.15)' : 'rgba(59,130,246,.15)',
                          fontSize: 11,
                          flexShrink: 0,
                        }}>
                          {isFail ? '❌' : isSuccess ? '✅' : '⚙️'}
                        </span>
                        <div>
                          <div style={{ color: 'var(--text)' }}>{log.message}</div>
                          <div style={{ color: 'var(--text-dim)', fontSize: 10, marginTop: 2 }}>
                            {new Date(log.timestamp).toLocaleTimeString('es-CO', { hour12: false })}
                          </div>
                        </div>
                      </div>
                    )
                  })
                ) : (
                  <div style={{ color: 'var(--text-dim)', padding: 8 }}>No hay logs de deploy disponibles</div>
                )}
              </div>
            </div>
          )}

          {/* Code viewer (toggle) */}
          {showCode && projectId && (
            <div style={{ marginTop: 16 }}>
              <CodeViewer projectId={projectId} />
            </div>
          )}
        </div>
      )}

      {phase === 'failed' && (
        <div className="animate-in" style={{
          marginTop: 20,
          background: 'rgba(239,68,68,.1)',
          border: '1px solid rgba(239,68,68,.3)',
          borderRadius: 12,
          padding: '20px 24px',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
        }}>
          <span style={{ fontSize: 32 }}>❌</span>
          <div>
            <div style={{ fontWeight: 600 }}>Ejecución Fallida</div>
            <div style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: 4 }}>
              Revisa la consola abajo para más detalles
            </div>
          </div>
          <button onClick={() => { setPhase('idle'); setActiveBrief(null) }} style={{
            marginLeft: 'auto',
            background: 'var(--surface-2)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
            padding: '10px 20px',
            borderRadius: 8,
            cursor: 'pointer',
          }}>
            Reintentar
          </button>
        </div>
      )}

      <LiveLog logs={logs} agents={agents} />

      {/* History panel */}
      {pastProjects.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <button
            onClick={() => setShowHistory(!showHistory)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-dim)',
              fontFamily: 'var(--mono)',
              fontSize: 12,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 0',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            <span style={{ transform: showHistory ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s', display: 'inline-block' }}>▶</span>
            📂 Historial de Apps ({pastProjects.length})
          </button>

          {showHistory && (
            <div style={{
              marginTop: 8,
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: 12,
            }}>
              {pastProjects.map((p) => {
                const statusIcon = p.status === 'completed' ? '✅' : p.status === 'failed' ? '❌' : '⏳'
                const date = new Date(p.created_at).toLocaleString('es-CO', {
                  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
                })
                const tr = p.test_results as { passed?: number; failed?: number; total?: number } | undefined
                return (
                  <div key={p.id} style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 12,
                    overflow: 'hidden',
                    transition: 'border-color 0.2s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--purple)')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
                  >
                    {/* Preview iframe */}
                    {p.status === 'completed' && p.preview_url && (
                      <div style={{
                        position: 'relative',
                        height: 140,
                        overflow: 'hidden',
                        borderBottom: '1px solid var(--border)',
                        background: '#1a1a2e',
                      }}>
                        <iframe
                          src={p.preview_url}
                          title={p.brief}
                          sandbox="allow-scripts allow-same-origin"
                          loading="lazy"
                          style={{
                            width: '200%',
                            height: '200%',
                            transform: 'scale(0.5)',
                            transformOrigin: '0 0',
                            border: 'none',
                            pointerEvents: 'none',
                          }}
                        />
                        <div style={{
                          position: 'absolute',
                          inset: 0,
                          cursor: 'pointer',
                        }} onClick={() => p.preview_url && window.open(p.preview_url, '_blank')} />
                      </div>
                    )}
                    {/* Card body */}
                    <div style={{ padding: '12px 14px' }}>
                      <div style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 8,
                        marginBottom: 8,
                      }}>
                        <span style={{ fontSize: 14, marginTop: 1 }}>{statusIcon}</span>
                        <div style={{
                          fontSize: 13,
                          color: 'var(--text)',
                          lineHeight: 1.4,
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                          flex: 1,
                        }}>
                          {p.brief}
                        </div>
                      </div>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                      }}>
                        <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--mono)' }}>
                          {date}
                        </span>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          {tr && tr.total && tr.total > 0 && (
                            <span style={{
                              fontSize: 10,
                              fontFamily: 'var(--mono)',
                              color: (tr.failed ?? 0) > 0 ? 'var(--red)' : 'var(--green)',
                              background: (tr.failed ?? 0) > 0 ? 'rgba(239,68,68,.12)' : 'rgba(16,185,129,.12)',
                              padding: '2px 8px',
                              borderRadius: 6,
                              fontWeight: 600,
                            }}>
                              🧪 {tr.passed}/{tr.total}
                            </span>
                          )}
                          {p.status === 'completed' && p.preview_url && (
                            <a href={p.preview_url} target="_blank" rel="noreferrer" style={{
                              fontSize: 10,
                              fontFamily: 'var(--mono)',
                              color: 'var(--green)',
                              textDecoration: 'none',
                              background: 'rgba(16,185,129,.12)',
                              padding: '2px 8px',
                              borderRadius: 6,
                              fontWeight: 600,
                            }}>
                              Ver App ↗
                            </a>
                          )}
                          <button onClick={() => restoreProject(p)} style={{
                            fontSize: 10,
                            fontFamily: 'var(--mono)',
                            color: 'var(--cyan)',
                            background: 'rgba(6,182,212,.12)',
                            padding: '2px 8px',
                            borderRadius: 6,
                            fontWeight: 600,
                            border: 'none',
                            cursor: 'pointer',
                          }}>
                            ↩ Retomar
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

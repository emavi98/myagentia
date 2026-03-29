import { useEffect, useRef } from 'react'
import type { LogEntry, AgentDef } from '../App'

interface Props {
  logs: LogEntry[]
  agents: AgentDef[]
}

export default function LiveLog({ logs, agents }: Props) {
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs.length])

  if (logs.length === 0) return null

  const agentColor = (id: string) =>
    agents.find(a => a.id === id)?.color || 'var(--text-dim)'

  return (
    <div className="animate-in" style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      marginTop: 16,
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '10px 16px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <div style={{
          width: 8, height: 8, borderRadius: '50%',
          background: 'var(--green)',
          boxShadow: '0 0 6px var(--green)',
        }} />
        <span style={{
          fontSize: 12,
          fontFamily: 'var(--mono)',
          fontWeight: 600,
          color: 'var(--text-dim)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}>
          Consola en Vivo — {logs.length} eventos
        </span>
      </div>

      <div style={{
        maxHeight: 400,
        overflowY: 'auto',
        padding: '12px 16px',
        fontFamily: 'var(--mono)',
        fontSize: 12,
        lineHeight: 1.8,
      }}>
        {logs.map((log, i) => {
          const time = new Date(log.timestamp).toLocaleTimeString('es-CO', {
            hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
          })
          const color = agentColor(log.agent_id)
          return (
            <div key={i} className="animate-in" style={{
              animationDelay: `${Math.min(i * 30, 300)}ms`,
              display: 'flex',
              gap: 8,
              padding: '2px 0',
            }}>
              <span style={{ color: 'var(--text-dim)', flexShrink: 0 }}>{time}</span>
              <span style={{ color, fontWeight: 600, flexShrink: 0, minWidth: 120 }}>
                [{log.agent_name}]
              </span>
              <span style={{ color: 'var(--text)' }}>{log.message}</span>
            </div>
          )
        })}
        <div ref={endRef} />
      </div>
    </div>
  )
}

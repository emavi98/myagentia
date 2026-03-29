import type { AgentDef, AgentStatus } from '../App'

interface Props {
  agents: AgentDef[]
  statuses: Record<string, AgentStatus>
  activeAgent: AgentDef | null
}

export default function AgentStrip({ agents, statuses }: Props) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
      gap: 10,
      marginBottom: 24,
    }}>
      {agents.map((agent) => {
        const status = statuses[agent.id] || 'idle'
        const isActive = status === 'working'
        const isDone = status === 'done'
        const isFailed = status === 'failed'

        return (
          <div
            key={agent.id}
            className="animate-in"
            style={{
              background: isActive
                ? `linear-gradient(135deg, ${agent.color}15, ${agent.color}08)`
                : isDone
                ? 'linear-gradient(135deg, rgba(16,185,129,.06), rgba(16,185,129,.02))'
                : 'var(--surface)',
              border: `1px solid ${isActive ? agent.color + '60' : isDone ? 'var(--green)40' : isFailed ? '#ef444460' : 'var(--border)'}`,
              borderRadius: 12,
              padding: '14px 12px',
              textAlign: 'center',
              position: 'relative',
              transition: 'all 0.4s cubic-bezier(.4,0,.2,1)',
              transform: isActive ? 'scale(1.04)' : 'scale(1)',
              ...(isActive ? {
                ['--glow-color' as string]: agent.color,
                animation: 'pulse-glow 1.5s infinite',
              } : {}),
            }}
          >
            {/* Active ring animation */}
            {isActive && (
              <div style={{
                position: 'absolute',
                inset: -2,
                borderRadius: 14,
                background: `linear-gradient(90deg, ${agent.color}, transparent, ${agent.color})`,
                backgroundSize: '200% 100%',
                animation: 'border-spin 2s linear infinite',
                opacity: 0.4,
                zIndex: -1,
              }} />
            )}

            {/* Status indicator with ripple */}
            <div style={{
              position: 'absolute',
              top: 8,
              right: 8,
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: isActive ? agent.color : isDone ? 'var(--green)' : isFailed ? '#ef4444' : 'var(--border)',
              boxShadow: isActive ? `0 0 8px ${agent.color}` : isDone ? '0 0 6px var(--green)' : isFailed ? '0 0 6px #ef4444' : 'none',
              transition: 'all 0.3s',
              ...(isActive ? {
                ['--glow-color' as string]: agent.color,
                animation: 'ripple 1.5s infinite',
              } : {}),
            }} />

            {/* Agent icon with float animation */}
            <div style={{
              fontSize: 28,
              marginBottom: 6,
              ...(isActive ? { animation: 'float 2s ease-in-out infinite' } : {}),
              transition: 'transform 0.3s',
            }}>
              {agent.icon}
            </div>

            <div style={{
              fontSize: 12,
              fontWeight: 600,
              color: isActive ? agent.color : isDone ? 'var(--green)' : 'var(--text-dim)',
              transition: 'color 0.3s',
            }}>
              {agent.name}
            </div>

            {/* Status text with thinking dots when active */}
            <div style={{
              fontSize: 10,
              fontFamily: 'var(--mono)',
              color: isActive ? agent.color : 'var(--text-dim)',
              marginTop: 4,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
            }}>
              {isActive ? (
                <>
                  <span>pensando</span>
                  {[0, 1, 2].map(i => (
                    <span key={i} style={{
                      display: 'inline-block',
                      width: 4, height: 4,
                      borderRadius: '50%',
                      background: agent.color,
                      animation: `thinking-dots 1.4s ${i * 0.2}s infinite`,
                      marginLeft: 1,
                    }} />
                  ))}
                </>
              ) : isDone ? '✓ listo' : isFailed ? '✗ error' : '○ espera'}
            </div>
          </div>
        )
      })}
    </div>
  )
}

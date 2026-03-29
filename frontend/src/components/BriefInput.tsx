import { useState } from 'react'

interface Props {
  onSubmit: (message: string) => void
}

const EXAMPLES = [
  'App de gestión de tareas con columnas kanban, drag & drop y almacenamiento local',
  'Dashboard del clima con pronósticos, gráficos y búsqueda por ciudad',
  'App de notas en markdown con vista previa en vivo, categorías y exportar a PDF',
]

export default function BriefInput({ onSubmit }: Props) {
  const [message, setMessage] = useState('')

  const handleSubmit = () => {
    const text = message.trim()
    if (!text) return
    onSubmit(text)
  }

  return (
    <div className="animate-in" style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 16,
      padding: 24,
      marginBottom: 24,
    }}>
      <label style={{
        display: 'block',
        fontSize: 14,
        fontWeight: 600,
        marginBottom: 12,
        color: 'var(--text)',
      }}>
        📡 Enviar Brief al Equipo de Agentes
      </label>

      <div style={{
        display: 'flex',
        gap: 8,
        flexWrap: 'wrap',
        marginBottom: 14,
      }}>
        {EXAMPLES.map((ex, i) => (
          <button
            key={i}
            onClick={() => setMessage(ex)}
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              color: 'var(--text-dim)',
              padding: '6px 12px',
              borderRadius: 20,
              fontSize: 11,
              cursor: 'pointer',
              fontFamily: 'var(--font)',
              transition: 'all 0.2s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = 'var(--cyan)'
              e.currentTarget.style.color = 'var(--text)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'var(--border)'
              e.currentTarget.style.color = 'var(--text-dim)'
            }}
          >
            {ex.slice(0, 50)}…
          </button>
        ))}
      </div>

      <textarea
        value={message}
        onChange={e => setMessage(e.target.value)}
        placeholder="Describe la app que quieres construir..."
        rows={4}
        style={{
          width: '100%',
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: '12px 16px',
          color: 'var(--text)',
          fontFamily: 'var(--font)',
          fontSize: 14,
          resize: 'vertical',
          outline: 'none',
          transition: 'border-color 0.2s',
        }}
        onFocus={e => e.currentTarget.style.borderColor = 'var(--cyan)'}
        onBlur={e => e.currentTarget.style.borderColor = 'var(--border)'}
        onKeyDown={e => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit()
        }}
      />

      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: 12,
      }}>
        <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--mono)' }}>
          Ctrl+Enter para lanzar
        </span>
        <button
          onClick={handleSubmit}
          disabled={!message.trim()}
          style={{
            background: message.trim()
              ? 'linear-gradient(135deg, var(--cyan), var(--purple))'
              : 'var(--surface-2)',
            color: message.trim() ? '#fff' : 'var(--text-dim)',
            border: 'none',
            padding: '12px 32px',
            borderRadius: 10,
            fontWeight: 600,
            fontSize: 14,
            cursor: message.trim() ? 'pointer' : 'not-allowed',
            fontFamily: 'var(--font)',
            transition: 'all 0.3s',
            boxShadow: message.trim() ? '0 4px 20px rgba(6,182,212,.3)' : 'none',
            transform: message.trim() ? 'scale(1)' : 'scale(0.97)',
          }}
        >
          🚀 Lanzar Agentes
        </button>
      </div>
    </div>
  )
}

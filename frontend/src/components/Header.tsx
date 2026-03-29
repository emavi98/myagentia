export default function Header() {
  return (
    <header style={{
      display: 'flex',
      alignItems: 'center',
      gap: 16,
      marginBottom: 32,
      paddingBottom: 20,
      borderBottom: '1px solid var(--border)',
    }}>
      <div style={{
        width: 44, height: 44,
        borderRadius: 12,
        background: 'linear-gradient(135deg, var(--cyan), var(--purple))',
        display: 'grid',
        placeItems: 'center',
        fontSize: 22,
      }}>
        🎯
      </div>
      <div>
        <h1 style={{
          fontSize: 22,
          fontWeight: 700,
          letterSpacing: '-0.02em',
          background: 'linear-gradient(135deg, var(--cyan), var(--purple))',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
        }}>
          DevCrew
        </h1>
        <p style={{
          fontSize: 12,
          color: 'var(--text-dim)',
          fontFamily: 'var(--mono)',
          marginTop: 2,
        }}>
          Centro de Control de Agentes IA — 7 agentes, 1 brief, código real
        </p>
      </div>
      <div style={{
        marginLeft: 'auto',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <div style={{
          width: 8, height: 8, borderRadius: '50%',
          background: 'var(--green)',
          boxShadow: '0 0 8px var(--green)',
          animation: 'ripple 2s infinite',
          ['--glow-color' as string]: 'var(--green)',
        }} />
        <span style={{
          fontSize: 11,
          fontFamily: 'var(--mono)',
          color: 'var(--text-dim)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}>
          Sistema Activo
        </span>
      </div>
    </header>
  )
}

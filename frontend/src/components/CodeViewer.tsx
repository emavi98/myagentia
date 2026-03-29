import { useState, useEffect } from 'react'

interface CodeFile {
  path: string
  content: string
  language: string
}

interface Props {
  projectId: string
}

const API = import.meta.env.VITE_API_URL || ''

export default function CodeViewer({ projectId }: Props) {
  const [files, setFiles] = useState<CodeFile[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`${API}/api/projects/${encodeURIComponent(projectId)}/code`)
      .then(r => r.json())
      .then(data => {
        if (data.files) {
          setFiles(data.files)
          if (data.files.length > 0) setSelectedFile(data.files[0].path)
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [projectId])

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-dim)' }}>
        Cargando código fuente...
      </div>
    )
  }

  const current = files.find(f => f.path === selectedFile)

  // Group files by folder
  const folders = new Map<string, CodeFile[]>()
  files.forEach(f => {
    const parts = f.path.split('/')
    const folder = parts.length > 1 ? parts.slice(0, -1).join('/') : '.'
    if (!folders.has(folder)) folders.set(folder, [])
    folders.get(folder)!.push(f)
  })

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '240px 1fr',
      height: '70vh',
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      overflow: 'hidden',
    }}>
      {/* File tree */}
      <div style={{
        borderRight: '1px solid var(--border)',
        overflowY: 'auto',
        padding: '12px 0',
      }}>
        <div style={{
          padding: '8px 16px',
          fontSize: 11,
          fontFamily: 'var(--mono)',
          color: 'var(--text-dim)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          fontWeight: 600,
        }}>
          📁 Archivos ({files.length})
        </div>
        {[...folders.entries()].map(([folder, folderFiles]) => (
          <div key={folder}>
            {folder !== '.' && (
              <div style={{
                padding: '6px 16px',
                fontSize: 11,
                fontFamily: 'var(--mono)',
                color: 'var(--cyan)',
                fontWeight: 600,
                marginTop: 4,
              }}>
                📂 {folder}/
              </div>
            )}
            {folderFiles.map(f => {
              const fileName = f.path.split('/').pop()
              const isSelected = f.path === selectedFile
              return (
                <button
                  key={f.path}
                  onClick={() => setSelectedFile(f.path)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    background: isSelected ? 'var(--surface-2)' : 'transparent',
                    border: 'none',
                    borderLeft: isSelected ? '2px solid var(--cyan)' : '2px solid transparent',
                    padding: '5px 16px 5px 24px',
                    fontSize: 12,
                    fontFamily: 'var(--mono)',
                    color: isSelected ? 'var(--text)' : 'var(--text-dim)',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  {_fileIcon(f.language)} {fileName}
                </button>
              )
            })}
          </div>
        ))}
      </div>

      {/* Code panel */}
      <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {current && (
          <>
            <div style={{
              padding: '10px 16px',
              borderBottom: '1px solid var(--border)',
              fontSize: 12,
              fontFamily: 'var(--mono)',
              color: 'var(--text-dim)',
              background: 'var(--bg)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}>
              <span style={{ color: 'var(--cyan)' }}>{current.path}</span>
              <span style={{
                marginLeft: 'auto',
                background: 'var(--surface-2)',
                padding: '2px 8px',
                borderRadius: 4,
                fontSize: 10,
                color: 'var(--text-dim)',
              }}>
                {current.language}
              </span>
            </div>
            <div style={{
              flex: 1,
              overflowY: 'auto',
              padding: 0,
              background: 'var(--bg)',
            }}>
              <pre style={{
                margin: 0,
                padding: '12px 0',
                fontFamily: 'var(--mono)',
                fontSize: 12,
                lineHeight: 1.6,
                tabSize: 2,
              }}>
                <code>
                  {current.content.split('\n').map((line, i) => (
                    <div key={i} style={{
                      display: 'flex',
                      minHeight: '1.6em',
                    }}>
                      <span style={{
                        display: 'inline-block',
                        width: 48,
                        textAlign: 'right',
                        paddingRight: 16,
                        color: 'var(--border)',
                        userSelect: 'none',
                        flexShrink: 0,
                      }}>
                        {i + 1}
                      </span>
                      <span style={{ color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                        {line}
                      </span>
                    </div>
                  ))}
                </code>
              </pre>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function _fileIcon(language: string): string {
  const icons: Record<string, string> = {
    typescript: '🔷', tsx: '⚛️', javascript: '🟡', jsx: '⚛️',
    json: '📋', css: '🎨', html: '🌐', markdown: '📝',
    yaml: '⚙️', sql: '🗃️', text: '📄',
  }
  return icons[language] || '📄'
}

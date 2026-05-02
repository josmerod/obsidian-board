const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const express = require('express')

// ── Config ──────────────────────────────────────────────────────────────────

const BOARD_PATH = process.env.BOARD_PATH || '/data/Board.md'
const STATE_PATH = BOARD_PATH.replace(/\.md$/, '.board-state.json')
const PORT = parseInt(process.env.PORT || '8080', 10)
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || ''

// ── Sidecar State (stable task IDs) ───────────────────────────────────────

let _state = null

function textHash(text) {
  return crypto.createHash('sha256').update(text.trim()).digest('hex').slice(0, 12)
}

function readState() {
  if (_state) return _state
  try { _state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) } catch { _state = { id_map: {} } }
  return _state
}

function writeState() {
  if (!_state) return
  try { fs.writeFileSync(STATE_PATH, JSON.stringify(_state, null, 2)) } catch {}
}

function getOrCreateId(column, text) {
  const state = readState()
  const key = `${column}:${textHash(text)}`
  if (state.id_map[key]) return state.id_map[key]
  // Generate new stable ID (no Date.now — deterministic per key)
  const id = `b_${textHash(text + column)}_${Object.keys(state.id_map).length.toString(36)}`
  state.id_map[key] = id
  return id
}

function getOrCreateSubId(parentText, text) {
  const state = readState()
  const key = `sub:${textHash(parentText)}:${textHash(text)}`
  if (state.id_map[key]) return state.id_map[key]
  const id = `b_${textHash(text)}_sub_${Object.keys(state.id_map).length.toString(36)}`
  state.id_map[key] = id
  return id
}

// ── Types ───────────────────────────────────────────────────────────────────

const COLUMNS = ['hoy', 'semana', 'backlog', 'habitos', 'hecho']

const COLUMN_META = {
  hoy:      { emoji: '🔥', label: 'Hoy',          color: '#ef4444' },
  semana:   { emoji: '📋', label: 'Esta Semana',  color: '#f59e0b' },
  backlog:  { emoji: '🗂️', label: 'Backlog',      color: '#3b82f6' },
  habitos:  { emoji: '🔄', label: 'Hábitos',      color: '#8b5cf6' },
  hecho:    { emoji: '✅', label: 'Hecho',        color: '#22c55e' },
}

const COLUMN_TITLE = {
  hoy: 'Hoy',
  semana: 'Esta Semana',
  backlog: 'Backlog',
  habitos: 'Hábitos',
  hecho: 'Hecho',
}

// ── ID Generation ─────────────────────────────────────────────────────────

function generateId(text) {
  // Fallback — action routes now use getOrCreateId directly,
  // but this is kept for any remaining call sites.
  return `b_${textHash(text)}_${Date.now().toString(36)}`
}

// ── Priority Constants ─────────────────────────────────────────────────────

const PRIORITIES = [
  { marker: '!!!', label: 'Critical' },
  { marker: '!!',  label: 'High' },
  { marker: '!',   label: 'Medium' },
  { marker: '-',   label: 'Low' },
  { marker: '~',   label: 'Someday' },
  { marker: '~~',  label: 'Maybe' },
]

// ── File I/O (with retry for Syncthing) ────────────────────────────────────

function readBoardFile() {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return fs.readFileSync(BOARD_PATH, 'utf-8')
    } catch (err) {
      if (err.code === 'ENOENT') return null
      if (err.code === 'EBUSY' || err.code === 'ELOCKED') {
        // Syncthing might be writing — wait and retry
        const ms = 200 * (attempt + 1)
        console.warn(`Board read failed (${err.code}), retrying in ${ms}ms...`)
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
        continue
      }
      throw err
    }
  }
  throw new Error('Failed to read Board.md after 3 attempts')
}

function writeBoardFile(content) {
  // Atomic write: write to temp, then rename
  const tmpPath = BOARD_PATH + '.tmp'
  fs.writeFileSync(tmpPath, content, 'utf-8')
  fs.renameSync(tmpPath, BOARD_PATH)
}

// ── Parser ─────────────────────────────────────────────────────────────────

function parseColumnHeader(header) {
  const h = header.trim().toLowerCase()
  if (h.startsWith('🔥 hoy')) return 'hoy'
  if (h.startsWith('📋 esta semana') || h.startsWith('📋 semana')) return 'semana'
  if (h.startsWith('🗂️ backlog')) return 'backlog'
  if (h.startsWith('🔄 hábitos') || h.startsWith('🔄 habitos')) return 'habitos'
  if (h.startsWith('✅ hecho') || h.startsWith('✅ hech')) return 'hecho'
  if (h.startsWith('notas')) return 'notas'
  return null
}

function parseBoard(raw) {
  if (!raw) raw = '# 🗂️ Board\n'
  
  const columns = { hoy: [], semana: [], backlog: [], habitos: [], hecho: [] }
  const lines = raw.split('\n')
  let currentColumn = null
  let currentCategory = null
  let notesLines = []
  let inNotes = false

  // Skip YAML frontmatter
  let i = 0
  if (lines[0]?.trim() === '---') {
    i = 1
    while (i < lines.length && lines[i]?.trim() !== '---') i++
    i++
  }

  for (; i < lines.length; i++) {
    const line = lines[i]

    if (line.startsWith('## ')) {
      const headerText = line.slice(3)
      const matched = parseColumnHeader(headerText)
      
      if (matched === 'notas') {
        currentColumn = null
        inNotes = true
        continue
      }
      if (matched) {
        currentColumn = matched
        currentCategory = null
        inNotes = false
        continue
      }
      // Unknown ## header inside a column = category header
      if (currentColumn && currentColumn !== 'habitos') {
        currentCategory = line.slice(3).trim()
      }
      continue
    }

    if (line.startsWith('### ') && currentColumn && currentColumn !== 'habitos') {
      currentCategory = line.slice(4).trim()
      continue
    }

    if (inNotes) {
      if (line.trim()) notesLines.push(line)
      continue
    }

    if (currentColumn && /^[-*] \[[ xX]\] /.test(line)) {
      const checked = /^[-*] \[x\]/i.test(line)
      const text = line.replace(/^[-*] \[[ xX]\] /, '').trim()
      if (text) {
        const task = {
          id: getOrCreateId(currentColumn, text),
          text,
          checked,
          category: currentColumn === 'habitos' ? null : currentCategory,
          column: currentColumn,
          subtasks: [],
        }
        columns[currentColumn].push(task)
        // Look ahead for indented subtask lines
        while (i + 1 < lines.length && /^\s{2,}[-*] \[[ xX]\] /.test(lines[i + 1])) {
          i++
          const subChecked = /^\s{2,}[-*] \[x\]/i.test(lines[i])
          const subText = lines[i].replace(/^\s+[-*] \[[ xX]\] /, '').trim()
          if (subText) {
            task.subtasks.push({
              id: getOrCreateSubId(text, subText),
              text: subText,
              checked: subChecked,
            })
          }
        }
      }
    }
  }

  return { columns, notes: notesLines.join('\n').trim(), raw }
}

// ── Serializer ─────────────────────────────────────────────────────────────

function serializeTask(task) {
  const lines = [`- [${task.checked ? 'x' : ' '}] ${task.text}`]
  if (task.subtasks && task.subtasks.length > 0) {
    for (const sub of task.subtasks) {
      lines.push(`  - [${sub.checked ? 'x' : ' '}] ${sub.text}`)
    }
  }
  return lines
}

function serializeBoard(data) {
  const lines = []

  // Preserve YAML frontmatter
  const rawLines = data.raw.split('\n')
  if (rawLines[0]?.trim() === '---') {
    let j = 1
    while (j < rawLines.length && rawLines[j]?.trim() !== '---') j++
    for (let k = 0; k <= j; k++) lines.push(rawLines[k])
    lines.push('')
    lines.push('# 🗂️ Board')
    lines.push('')
  }

  for (const col of COLUMNS) {
    const tasks = data.columns[col]
    const meta = COLUMN_META[col]

    lines.push('---')
    lines.push('')
    lines.push(`## ${meta.emoji} ${COLUMN_TITLE[col]}`)
    lines.push('')

    if (col === 'hoy') {
      lines.push('> Regla: 🔥 max 5 tareas. Si tienes más, algo no está en el sitio correcto.')
      lines.push('> Mueve tareas con copypaste. No pienses, mueve.')
      lines.push('')
    }

    if (col === 'habitos') {
      lines.push('> Esto no va al backlog. Si lo haces 3 días seguidos, ya es hábito.')
      lines.push('')
      for (const task of tasks) {
        lines.push(...serializeTask(task))
      }
      lines.push('')
    } else if (col === 'hecho') {
      lines.push('> 2025-2026 (migrado de Coda)')
      lines.push('')
      for (const task of tasks) {
        lines.push(...serializeTask(task))
      }
      lines.push('')
    } else {
      // hoy, semana, backlog: group by category
      const grouped = new Map()
      for (const task of tasks) {
        const cat = task.category || 'General'
        if (!grouped.has(cat)) grouped.set(cat, [])
        grouped.get(cat).push(task)
      }
      for (const [cat, catTasks] of grouped) {
        if (cat !== 'General') {
          lines.push(`### ${cat}`)
          lines.push('')
        }
        for (const task of catTasks) {
          lines.push(...serializeTask(task))
        }
        lines.push('')
      }
    }
  }

  if (data.notes) {
    lines.push('---')
    lines.push('')
    lines.push('## Notas')
    lines.push('')
    lines.push(data.notes)
    lines.push('')
  }

  return lines.join('\n')
}

// ── Actions ────────────────────────────────────────────────────────────────

function readBoard() {
  const raw = readBoardFile()
  return parseBoard(raw)
}

function writeBoard(data) {
  const content = serializeBoard(data)
  writeBoardFile(content)
  writeState()  // Persist any new/updated IDs to sidecar
  return parseBoard(content)
}

function findTask(board, taskId) {
  for (const col of COLUMNS) {
    const idx = board.columns[col].findIndex(t => t.id === taskId)
    if (idx !== -1) return { col, idx }
  }
  return null
}

// ── Express App ─────────────────────────────────────────────────────────────

const app = express()
app.use(express.json())

// Auth middleware
function authMiddleware(req, res, next) {
  if (!AUTH_PASSWORD) return next()
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (token !== AUTH_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
}

// Serve static files
app.use(express.static('public'))

// API routes
app.get('/api/board', authMiddleware, (req, res) => {
  try {
    const board = readBoard()
    res.json({
      columns: board.columns,
      notes: board.notes,
      columnOrder: COLUMNS,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Etag endpoint for auto-refresh polling
app.get('/api/board/etag', authMiddleware, (req, res) => {
  try {
    const stat = fs.statSync(BOARD_PATH)
    res.json({ mtime: stat.mtimeMs })
  } catch {
    res.json({ mtime: 0 })
  }
})

app.post('/api/board/move', authMiddleware, (req, res) => {
  try {
    const { taskId, column } = req.body
    if (!taskId || !COLUMNS.includes(column)) {
      return res.status(400).json({ error: 'taskId and valid column required' })
    }
    const board = readBoard()
    const found = findTask(board, taskId)
    if (!found) return res.status(404).json({ error: 'Task not found' })
    
    const [task] = board.columns[found.col].splice(found.idx, 1)
    task.column = column
    if (column === 'habitos' || column === 'hecho') task.category = null
    task.checked = column === 'hecho'
    board.columns[column].push(task)
    
    const updated = writeBoard(board)
    res.json({ columns: updated.columns, notes: updated.notes, columnOrder: COLUMNS })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/board/toggle', authMiddleware, (req, res) => {
  try {
    const { taskId } = req.body
    if (!taskId) return res.status(400).json({ error: 'taskId required' })
    
    const board = readBoard()
    const found = findTask(board, taskId)
    if (!found) return res.status(404).json({ error: 'Task not found' })
    
    board.columns[found.col][found.idx].checked = !board.columns[found.col][found.idx].checked
    const updated = writeBoard(board)
    res.json({ columns: updated.columns, notes: updated.notes, columnOrder: COLUMNS })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/board/add', authMiddleware, (req, res) => {
  try {
    const { text, column, category } = req.body
    if (!text || !COLUMNS.includes(column)) {
      return res.status(400).json({ error: 'text and valid column required' })
    }
    
    const board = readBoard()
    const trimmed = text.trim()
    board.columns[column].push({
      id: getOrCreateId(column, trimmed),
      text: trimmed,
      checked: column === 'hecho',
      category: ['hoy','semana','backlog'].includes(column) ? (category || null) : null,
      column,
    })
    
    const updated = writeBoard(board)
    res.json({ columns: updated.columns, notes: updated.notes, columnOrder: COLUMNS })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/board/delete', authMiddleware, (req, res) => {
  try {
    const { taskId } = req.body
    if (!taskId) return res.status(400).json({ error: 'taskId required' })
    
    const board = readBoard()
    const found = findTask(board, taskId)
    if (!found) return res.status(404).json({ error: 'Task not found' })
    
    board.columns[found.col].splice(found.idx, 1)
    const updated = writeBoard(board)
    res.json({ columns: updated.columns, notes: updated.notes, columnOrder: COLUMNS })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/board/edit', authMiddleware, (req, res) => {
  try {
    const { taskId, text, category } = req.body
    if (!taskId) return res.status(400).json({ error: 'taskId required' })

    const board = readBoard()
    const found = findTask(board, taskId)
    if (!found) return res.status(404).json({ error: 'Task not found' })

    const task = board.columns[found.col][found.idx]
    if (text !== undefined) task.text = text.trim()
    if (category !== undefined) {
      task.category = ['hoy','semana','backlog'].includes(found.col) ? (category || null) : null
    }

    const updated = writeBoard(board)
    res.json({ columns: updated.columns, notes: updated.notes, columnOrder: COLUMNS })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/board/subtask/add', authMiddleware, (req, res) => {
  try {
    const { taskId, text } = req.body
    if (!taskId || !text) return res.status(400).json({ error: 'taskId and text required' })

    const board = readBoard()
    const found = findTask(board, taskId)
    if (!found) return res.status(404).json({ error: 'Task not found' })

    const task = board.columns[found.col][found.idx]
    if (!task.subtasks) task.subtasks = []
    const trimmed = text.trim()
    task.subtasks.push({
      id: getOrCreateSubId(task.text, trimmed),
      text: trimmed,
      checked: false,
    })

    const updated = writeBoard(board)
    res.json({ columns: updated.columns, notes: updated.notes, columnOrder: COLUMNS })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/board/subtask/toggle', authMiddleware, (req, res) => {
  try {
    const { taskId, subtaskId } = req.body
    if (!taskId || !subtaskId) return res.status(400).json({ error: 'taskId and subtaskId required' })

    const board = readBoard()
    const found = findTask(board, taskId)
    if (!found) return res.status(404).json({ error: 'Task not found' })

    const task = board.columns[found.col][found.idx]
    const sub = task.subtasks?.find(s => s.id === subtaskId)
    if (!sub) return res.status(404).json({ error: 'Subtask not found' })

    sub.checked = !sub.checked
    const updated = writeBoard(board)
    res.json({ columns: updated.columns, notes: updated.notes, columnOrder: COLUMNS })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/board/subtask/delete', authMiddleware, (req, res) => {
  try {
    const { taskId, subtaskId } = req.body
    if (!taskId || !subtaskId) return res.status(400).json({ error: 'taskId and subtaskId required' })

    const board = readBoard()
    const found = findTask(board, taskId)
    if (!found) return res.status(404).json({ error: 'Task not found' })

    const task = board.columns[found.col][found.idx]
    if (!task.subtasks) return res.status(404).json({ error: 'Subtask not found' })

    task.subtasks = task.subtasks.filter(s => s.id !== subtaskId)
    const updated = writeBoard(board)
    res.json({ columns: updated.columns, notes: updated.notes, columnOrder: COLUMNS })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/board/subtask/edit', authMiddleware, (req, res) => {
  try {
    const { taskId, subtaskId, text } = req.body
    if (!taskId || !subtaskId || !text) return res.status(400).json({ error: 'taskId, subtaskId and text required' })

    const board = readBoard()
    const found = findTask(board, taskId)
    if (!found) return res.status(404).json({ error: 'Task not found' })

    const task = board.columns[found.col][found.idx]
    const sub = task.subtasks?.find(s => s.id === subtaskId)
    if (!sub) return res.status(404).json({ error: 'Subtask not found' })

    sub.text = text.trim()
    const updated = writeBoard(board)
    res.json({ columns: updated.columns, notes: updated.notes, columnOrder: COLUMNS })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', board_path: BOARD_PATH })
})

// ── Category Management Endpoints ──────────────────────────

app.get('/api/board/categories', authMiddleware, (req, res) => {
  try {
    const board = readBoard()
    const cats = new Map()
    for (const col of ['hoy', 'semana', 'backlog']) {
      for (const task of board.columns[col]) {
        const cat = task.category || 'General'
        if (!cats.has(cat)) cats.set(cat, { name: cat, count: 0 })
        cats.get(cat).count++
      }
    }
    res.json({ categories: [...cats.values()].sort((a, b) => a.name.localeCompare(b.name)) })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/board/category/rename', authMiddleware, (req, res) => {
  try {
    const { oldName, newName } = req.body
    if (!oldName || !newName) return res.status(400).json({ error: 'oldName and newName required' })

    const board = readBoard()
    let changed = 0
    for (const col of ['hoy', 'semana', 'backlog']) {
      for (const task of board.columns[col]) {
        if (task.category === oldName) { task.category = newName; changed++ }
        else if (task.category === null && oldName === 'General') { /* skip General rename of null */ }
      }
    }
    // Also rename "General" -> newName for uncategorized (null) tasks
    if (oldName === 'General') {
      for (const col of ['hoy', 'semana', 'backlog']) {
        for (const task of board.columns[col]) {
          if (task.category === null) { task.category = newName; changed++ }
        }
      }
    }
    const updated = writeBoard(board)
    res.json({ columns: updated.columns, notes: updated.notes, columnOrder: COLUMNS, changed })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/board/category/delete', authMiddleware, (req, res) => {
  try {
    const { name } = req.body
    if (!name) return res.status(400).json({ error: 'name required' })

    const board = readBoard()
    let changed = 0
    for (const col of ['hoy', 'semana', 'backlog']) {
      for (const task of board.columns[col]) {
        if (task.category === name) { task.category = null; changed++ }
      }
    }
    const updated = writeBoard(board)
    res.json({ columns: updated.columns, notes: updated.notes, columnOrder: COLUMNS, changed })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🗂️ Obsidian Board server running on http://0.0.0.0:${PORT}`)
  console.log(`   Board file: ${BOARD_PATH}`)
  console.log(`   Auth: ${AUTH_PASSWORD ? 'enabled' : 'disabled'}`)
  
  // Verify board file exists
  try {
    const raw = readBoardFile()
    const board = parseBoard(raw)
    const total = COLUMNS.reduce((sum, col) => sum + board.columns[col].length, 0)
    console.log(`   Loaded: ${total} tasks across ${COLUMNS.length} columns`)
  } catch (err) {
    console.warn(`   Warning: Could not load Board.md: ${err.message}`)
  }
})

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseBoard, serializeBoard } from './server.js'

// ── Parser Tests ─────────────────────────────────────

describe('parseBoard', () => {
  it('parses all 5 columns with tasks', () => {
    const raw = `# 🗂️ Board

---

## 🔥 Hoy

- [ ] Tarea 1
- [x] Tarea completada

---

## 📋 Esta Semana

- [ ] Tarea semanal

---

## 🗂️ Backlog

- [ ] Tarea backlog 1

### Trabajo
- [ ] Tarea de trabajo

---

## 🔄 Hábitos

- [ ] Leer 30 min
- [x] Ejercicio

---

## ✅ Hecho

- [x] Tarea terminada
`
    const board = parseBoard(raw)
    
    assert.equal(board.columns.hoy.length, 2)
    assert.equal(board.columns.hoy[0].text, 'Tarea 1')
    assert.equal(board.columns.hoy[0].checked, false)
    assert.equal(board.columns.hoy[1].checked, true)
    
    assert.equal(board.columns.semana.length, 1)
    assert.equal(board.columns.semana[0].text, 'Tarea semanal')
    
    assert.equal(board.columns.backlog.length, 2)
    assert.equal(board.columns.backlog[0].category, null)
    assert.equal(board.columns.backlog[1].category, 'Trabajo')
    assert.equal(board.columns.backlog[1].text, 'Tarea de trabajo')
    
    assert.equal(board.columns.habitos.length, 2)
    assert.equal(board.columns.hecho.length, 1)
    assert.equal(board.columns.hecho[0].checked, true)
  })

  it('handles empty board', () => {
    const raw = '# 🗂️ Board\n'
    const board = parseBoard(raw)
    
    for (const col of ['hoy', 'semana', 'backlog', 'habitos', 'hecho']) {
      assert.equal(board.columns[col].length, 0)
    }
    assert.equal(board.notes, '')
  })

  it('handles null/undefined raw input', () => {
    const board1 = parseBoard(null)
    assert.ok(board1.columns)
    assert.equal(board1.columns.hoy.length, 0)
    
    const board2 = parseBoard(undefined)
    assert.ok(board2.columns)
  })

  it('parses YAML frontmatter', () => {
    const raw = `---
date: 2026-04-27
type: board
---

# 🗂️ Board

---

## 🔥 Hoy

- [ ] Task with frontmatter
`
    const board = parseBoard(raw)
    assert.equal(board.columns.hoy.length, 1)
    assert.equal(board.columns.hoy[0].text, 'Task with frontmatter')
  })

  it('parses notes section', () => {
    const raw = `# 🗂️ Board

---

## 🔥 Hoy

- [ ] Tarea 1

---

## Notas

Esto es una nota multilinea
con varias líneas.
`
    const board = parseBoard(raw)
    assert.ok(board.notes.includes('Esto es una nota multilinea'))
    assert.equal(board.columns.hoy.length, 1)
  })

  it('handles * checkbox syntax', () => {
    const raw = `# 🗂️ Board

---

## 🔥 Hoy

* [ ] Asterisk task 1
* [x] Asterisk task 2
`
    const board = parseBoard(raw)
    assert.equal(board.columns.hoy.length, 2)
    assert.equal(board.columns.hoy[0].checked, false)
    assert.equal(board.columns.hoy[1].checked, true)
  })

  it('generates stable IDs for tasks', () => {
    const raw1 = `# 🗂️ Board\n\n---\n\n## 🔥 Hoy\n\n- [ ] Stable task\n`
    const raw2 = raw1
    const b1 = parseBoard(raw1)
    const b2 = parseBoard(raw2)
    assert.equal(b1.columns.hoy[0].id, b2.columns.hoy[0].id)
  })

  it('sets column field on each task', () => {
    const raw = `# 🗂️ Board\n\n---\n\n## 🗂️ Backlog\n\n- [ ] Backlog item\n`
    const board = parseBoard(raw)
    assert.equal(board.columns.backlog[0].column, 'backlog')
  })
})

// ── Serializer Tests ──────────────────────────────────

describe('serializeBoard', () => {
  it('roundtrips: parse → serialize → parse', () => {
    const raw = `# 🗂️ Board

---

## 🔥 Hoy

- [ ] Tarea 1
- [x] Tarea 2

---

## 📋 Esta Semana

- [ ] Tarea semanal

---

## 🗂️ Backlog

### Trabajo
- [ ] Job task

---

## 🔄 Hábitos

- [ ] Leer

---

## ✅ Hecho

- [x] Done thing
`
    const parsed1 = parseBoard(raw)
    const serialized = serializeBoard(parsed1)
    const parsed2 = parseBoard(serialized)
    
    // Same number of tasks in each column
    for (const col of ['hoy', 'semana', 'backlog', 'habitos', 'hecho']) {
      assert.equal(parsed1.columns[col].length, parsed2.columns[col].length,
        `Column ${col} mismatch: ${parsed1.columns[col].length} vs ${parsed2.columns[col].length}`)
    }
    
    // Same text content
    assert.equal(parsed2.columns.hoy[0].text, 'Tarea 1')
    assert.equal(parsed2.columns.hoy[1].text, 'Tarea 2')
    assert.equal(parsed2.columns.backlog[0].text, 'Job task')
    assert.equal(parsed2.columns.backlog[0].category, 'Trabajo')
    assert.equal(parsed2.columns.habitos[0].text, 'Leer')
  })

  it('preserves YAML frontmatter', () => {
    const raw = `---
date: 2026-04-27
---

# 🗂️ Board

---

## 🔥 Hoy

- [ ] Task
`
    const board = parseBoard(raw)
    const serialized = serializeBoard(board)
    assert.ok(serialized.startsWith('---'))
    assert.ok(serialized.includes('date: 2026-04-27'))
  })

  it('moving task clears category when leaving backlog', () => {
    const raw = `# 🗂️ Board\n\n---\n\n## 🗂️ Backlog\n\n### Dev\n- [ ] My task\n`
    const board = parseBoard(raw)
    board.columns.backlog[0].column = 'hoy'
    board.columns.backlog[0].category = null
    board.columns.hoy.push(board.columns.backlog.shift())
    
    const serialized = serializeBoard(board)
    const reparsed = parseBoard(serialized)
    
    assert.equal(reparsed.columns.hoy.length, 1)
    assert.equal(reparsed.columns.hoy[0].text, 'My task')
    assert.equal(reparsed.columns.hoy[0].category, null)
  })

  it('preserves notes through roundtrip', () => {
    const raw = `# 🗂️ Board\n\n---\n\n## 🔥 Hoy\n\n- [ ] Tarea\n\n---\n\n## Notas\n\nNota importante aquí.\n`
    const board = parseBoard(raw)
    const serialized = serializeBoard(board)
    const reparsed = parseBoard(serialized)
    assert.ok(reparsed.notes.includes('Nota importante aquí'))
  })

  it('produces valid markdown checkboxes', () => {
    const raw = `# 🗂️ Board\n\n---\n\n## 🔥 Hoy\n\n- [ ] Todo\n- [x] Done\n`
    const board = parseBoard(raw)
    const serialized = serializeBoard(board)
    
    assert.match(serialized, /- \[ \] Todo/)
    assert.match(serialized, /- \[x\] Done/)
  })
})

console.log('All tests ready')

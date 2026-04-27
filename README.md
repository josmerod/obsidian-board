# 🗂️ Obsidian Board

Self-hosted kanban board that reads and writes directly to Obsidian's `Board.md` file. Access your Obsidian board from any browser with drag & drop, dark theme, and password protection.

## Features

- 🗂️ **5 columns**: Hoy, Esta Semana, Backlog, Hábitos, Hecho
- 🔄 **Direct Board.md sync** — reads/writes the actual Obsidian markdown file
- 🎨 **Dark theme** — clean, minimal UI
- 🔐 **Password protection** — optional auth via env var
- 📱 **Mobile-friendly** — responsive layout
- 🐳 **Docker** — single container deploy
- ✨ **Drag & drop** — move tasks between columns
- ⚡ **Atomic writes** — safe file I/O with Syncthing retry logic
- 📂 **Backlog categories** — supports subcategories in Backlog

## Quick Start (Docker)

```bash
docker run -d \
  --name obsidian-board \
  --restart unless-stopped \
  -p 8080:8080 \
  -e BOARD_PATH=/data/Board.md \
  -e AUTH_PASSWORD=your-password \
  -v /path/to/obsidian-vault:/data:ro \
  josmerod/obsidian-board
```

Or with docker-compose:

```yaml
services:
  obsidian-board:
    image: josmerod/obsidian-board
    container_name: obsidian-board
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      - BOARD_PATH=/data/Board.md
      - AUTH_PASSWORD=your-password
    volumes:
      - /path/to/obsidian-vault:/data:ro
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BOARD_PATH` | `/data/Board.md` | Path to Board.md inside the container |
| `PORT` | `8080` | Server port |
| `AUTH_PASSWORD` | (none) | Password for access. Leave empty for no auth |

## Board.md Format

The parser expects this Obsidian-compatible format:

```markdown
# 🗂️ Board

---

## 🔥 Hoy
- [ ] Task one
- [ ] Task two

---

## 📋 Esta Semana
- [ ] Weekly task

---

## 🗂️ Backlog

### Category Name
- [ ] Categorized task

---

## 🔄 Hábitos
- [ ] Daily habit

---

## ✅ Hecho
- [x] Completed task
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/board` | Read board (auth required) |
| POST | `/api/board/move` | Move task to column |
| POST | `/api/board/toggle` | Toggle task checkbox |
| POST | `/api/board/add` | Add new task |
| POST | `/api/board/delete` | Delete task |

## Tech Stack

- **Backend**: Node.js + Express
- **Frontend**: Vanilla HTML/CSS/JS (no frameworks)
- **Docker**: Multi-stage Alpine build (~130MB)

## License

MIT

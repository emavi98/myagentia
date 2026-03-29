"""MyAgenTI — AI Agent Control Room API.

FastAPI backend that orchestrates 7 AI agents using the Anthropic SDK
directly (no CrewAI). Each agent is a prompt+API call that streams
its output. Context is passed sequentially from agent to agent.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from anthropic import AsyncAnthropic
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv()

app = FastAPI(title="MyAgenTI API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

WORKSPACE = Path(os.getenv("WORKSPACE_DIR", "/workspace"))
WORKSPACE.mkdir(parents=True, exist_ok=True)

PROJECTS_FILE = WORKSPACE / "_projects.json"

MODEL = os.getenv("LLM_MODEL", "claude-sonnet-4-20250514")
MODEL_FAST = os.getenv("LLM_MODEL_FAST", MODEL)  # falls back to MODEL if no fast model set
anthropic = AsyncAnthropic()


def _save_projects() -> None:
    """Persist projects dict to JSON file."""
    try:
        PROJECTS_FILE.write_text(json.dumps(projects, default=str, indent=2))
    except Exception:
        pass


def _load_projects() -> dict[str, Any]:
    """Load projects from JSON file on startup."""
    if PROJECTS_FILE.exists():
        try:
            data = json.loads(PROJECTS_FILE.read_text())
            # Mark any stuck 'running' projects as failed (server restarted)
            for p in data.values():
                if p.get("status") == "running":
                    p["status"] = "failed"
                    for aid in p.get("agents", {}):
                        if p["agents"][aid] == "working":
                            p["agents"][aid] = "failed"
            return data
        except Exception:
            pass
    return {}


def _discover_orphan_projects(existing: dict[str, Any]) -> dict[str, Any]:
    """Scan workspace for project dirs not in the projects dict and register them."""
    from datetime import datetime, timezone
    for entry in WORKSPACE.iterdir():
        if not entry.is_dir() or entry.name.startswith("_") or entry.name.startswith("."):
            continue
        pid = entry.name
        if pid in existing:
            continue
        # Determine status by checking for dist/
        has_dist = (entry / "dist").is_dir()
        # Try to extract app name from package.json
        brief = f"Proyecto {pid[:8]}"
        pkg = entry / "package.json"
        if pkg.exists():
            try:
                pkg_data = json.loads(pkg.read_text())
                name = pkg_data.get("name", "")
                if name:
                    brief = name.replace("-", " ").replace("_", " ").title()
            except Exception:
                pass
        # Use directory mtime as created_at
        try:
            mtime = entry.stat().st_mtime
            created = datetime.fromtimestamp(mtime, tz=timezone.utc).isoformat()
        except Exception:
            created = datetime.now(timezone.utc).isoformat()
        existing[pid] = {
            "id": pid,
            "brief": brief,
            "status": "completed" if has_dist else "failed",
            "agents": {a["id"]: "done" if has_dist else "failed" for a in AGENTS},
            "logs": [],
            "created_at": created,
            "preview_url": f"/preview/{pid}/" if has_dist else None,
            "code_url": f"/api/projects/{pid}/code" if has_dist else None,
            "test_results": None,
        }
    return existing

# ---------------------------------------------------------------------------
# Agent definitions
# ---------------------------------------------------------------------------
AGENTS = [
    {"id": "orchestrator", "name": "Orquestador", "icon": "🎯", "color": "#06b6d4"},
    {"id": "requirements", "name": "Requisitos", "icon": "📋", "color": "#8b5cf6"},
    {"id": "architect", "name": "Arquitecto", "icon": "🏗️", "color": "#f59e0b"},
    {"id": "developer", "name": "Desarrollador", "icon": "💻", "color": "#10b981"},
    {"id": "qa", "name": "QA", "icon": "🧪", "color": "#ef4444"},
    {"id": "docs", "name": "Documentación", "icon": "📝", "color": "#3b82f6"},
    {"id": "devops", "name": "DevOps", "icon": "🚀", "color": "#ec4899"},
]

AGENT_CONFIG: dict[str, dict[str, Any]] = {
    "orchestrator": {
        "system": "You are a Project Orchestrator. Analyze briefs and create concise execution plans. Be brief — max 500 words.",
        "instruction": (
            "Analyze this brief and create a SHORT execution plan:\n"
            "1. Scope (2-3 sentences)\n"
            "2. Features list (bullet points)\n"
            "3. Component list for React app\n"
            "4. Data model — what entities/tables are needed (use sql.js for in-browser SQLite)\n"
            "5. API layer — list REST-like service functions (these run client-side with sql.js)\n"
            "Keep it concise — this plan guides the other agents."
        ),
        "max_tokens": 1024,
        "model": "fast",
    },
    "requirements": {
        "system": "You are a Requirements Analyst. Write concise PRDs. Max 600 words.",
        "instruction": (
            "Based on the plan above, write a SHORT PRD:\n"
            "1. Overview (2 sentences)\n"
            "2. 3-5 user stories (one line each)\n"
            "3. Key UI requirements\n"
            "Be concise."
        ),
        "max_tokens": 1024,
        "model": "fast",
    },
    "architect": {
        "system": "You are a Software Architect for React+TS+Vite apps with sql.js (in-browser SQLite). Be concise.",
        "instruction": (
            "Design the architecture:\n"
            "1. File/folder structure (include src/db/ for database layer, src/api/ for service functions)\n"
            "2. Component list with props\n"
            "3. TypeScript interfaces/types\n"
            "4. Database schema — CREATE TABLE statements for sql.js\n"
            "5. API service layer — functions that query sql.js (CRUD operations)\n"
            "6. State management approach\n"
            "The app uses sql.js (SQLite compiled to WASM) for real SQL persistence in the browser.\n"
            "Keep it short — the developer will use this as a blueprint."
        ),
        "max_tokens": 1500,
        "model": "fast",
    },
    "developer": {
        "system": (
            "You are a Senior React Developer. Write COMPLETE source code.\n\n"
            "CRITICAL FORMAT — for EVERY file:\n"
            "=== FILE: path/to/file.tsx ===\n"
            "<complete file contents>\n"
            "=== END FILE ===\n\n"
            "No placeholders, no '...', no TODO. Write real, working, complete code.\n"
            "Use inline styles or a single CSS file (src/index.css). "
            "NEVER use CSS modules (.module.css). No external CSS frameworks.\n\n"
            "FULLSTACK ARCHITECTURE — use sql.js for real SQL in the browser:\n"
            "- src/db/database.ts — initialize sql.js, create tables, export db instance\n"
            "- src/api/[entity].ts — service functions (getAll, getById, create, update, delete) that run SQL queries\n"
            "- Components call api/ functions, never raw SQL\n"
            "- sql.js import: import initSqlJs from 'sql.js'\n"
            "- Initialize with: const SQL = await initSqlJs({ locateFile: () => './sql-wasm.wasm' })\\n"
            "- Persist to localStorage on every write: localStorage.setItem('db', JSON.stringify(Array.from(db.export())))\n"
            "- Restore on load: const saved = localStorage.getItem('db'); if (saved) new SQL.Database(new Uint8Array(JSON.parse(saved)))\n"
        ),
        "instruction": (
            "Write ALL source files for the React app based on the architecture above.\n"
            "Required files: src/main.tsx, src/App.tsx, src/db/database.ts, src/api/ services, all components, src/index.css.\n"
            "Use === FILE: path === / === END FILE === for EVERY file.\n"
            "The app MUST have a real SQL database layer using sql.js with CRUD operations.\n"
            "Make it visually appealing with dark theme and modern design."
        ),
        "max_tokens": 12000,
        "model": "smart",
    },
    "qa": {
        "system": (
            "You are a QA Engineer. Write automated tests using Vitest + React Testing Library.\n"
            "Output test files using === FILE: path === / === END FILE === format.\n"
            "Also review the code for bugs — if you find any, output the corrected file."
        ),
        "instruction": (
            "Do TWO things:\n"
            "1. REVIEW: Check the code for import errors, type issues, missing refs. "
            "If you find bugs, output ONLY the corrected files using === FILE: path === format.\n"
            "2. WRITE TESTS: Create test files that actually test the app.\n"
            "   - src/__tests__/App.test.tsx — test that App renders without crashing\n"
            "   - src/__tests__/api.test.ts — test the api/service functions (create, read, update, delete)\n"
            "   - Use vitest and @testing-library/react\n"
            "   - import { describe, it, expect } from 'vitest'\n"
            "   - import { render, screen } from '@testing-library/react'\n"
            "   - Write 3-6 meaningful tests total\n"
            "   - Use === FILE: path === / === END FILE === format for test files"
        ),
        "max_tokens": 4096,
        "model": "fast",
    },
    "docs": {
        "system": "You are a Technical Writer. Write concise README files.",
        "instruction": (
            "Generate a short README.md: project name, description, features, "
            "tech stack, how to run (npm install, npm run dev).\n"
            "Output as: === FILE: README.md ===\n<content>\n=== END FILE ==="
        ),
        "max_tokens": 1024,
        "model": "fast",
    },
    "devops": {
        "system": "You are a DevOps Engineer. Generate build config files for Vite+React+TS.",
        "instruction": (
            "Generate config files. For EACH use === FILE: name === / === END FILE ===\n"
            "1. package.json — scripts MUST use 'vite build' (NOT 'tsc && vite build'). "
            "MUST include 'test': 'vitest run' in scripts. "
            "Include deps: react 18, react-dom, sql.js, typescript, @types/react, @types/react-dom, "
            "vite, @vitejs/plugin-react. "
            "Include devDeps: vitest, @testing-library/react, @testing-library/jest-dom, jsdom\n"
            "2. vite.config.ts — MUST include base: './' so assets use relative paths. "
            "Add test config: { environment: 'jsdom', globals: true }\n"
            "3. tsconfig.json (set \"noEmit\": true, \"skipLibCheck\": true)\n"
            "4. index.html (with <div id='root'> and <script type='module' src='/src/main.tsx'>)\n"
            "5. src/vite-env.d.ts with: /// <reference types='vite/client' />\n"
            "Make sure dependencies match the imports in the code above (including sql.js, vitest, testing-library)."
        ),
        "max_tokens": 2048,
        "model": "fast",
    },
}

projects: dict[str, dict[str, Any]] = _discover_orphan_projects(_load_projects())
_save_projects()  # persist discovered orphans
ws_clients: list[WebSocket] = []


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class BriefRequest(BaseModel):
    message: str


# ---------------------------------------------------------------------------
# WebSocket hub
# ---------------------------------------------------------------------------
async def broadcast(event: dict[str, Any]) -> None:
    # Persist log events per project
    pid = event.get("project_id")
    if pid and pid in projects and event.get("type") == "log":
        if "logs" not in projects[pid] or not isinstance(projects[pid]["logs"], list):
            projects[pid]["logs"] = []
        projects[pid]["logs"].append({
            "agent_id": event.get("agent_id", ""),
            "agent_name": event.get("agent_name", ""),
            "message": event.get("message", ""),
            "timestamp": event.get("timestamp", ""),
        })
    data = json.dumps(event, default=str)
    dead: list[WebSocket] = []
    for ws in ws_clients:
        try:
            await ws.send_text(data)
        except Exception:
            dead.append(ws)
    for ws in dead:
        ws_clients.remove(ws)


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    await ws.accept()
    ws_clients.append(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        if ws in ws_clients:
            ws_clients.remove(ws)


# ---------------------------------------------------------------------------
# File extraction from LLM output
# ---------------------------------------------------------------------------
def _parse_files(text: str, project_dir: Path) -> list[str]:
    """Extract === FILE: path === blocks and write them to disk."""
    pattern = r"=== FILE:\s*(.+?)\s*===\n(.*?)\n=== END FILE ==="
    matches = re.findall(pattern, text, re.DOTALL)
    created: list[str] = []
    for filepath, content in matches:
        filepath = filepath.strip().lstrip("/")
        # Prevent path traversal
        if ".." in filepath:
            continue
        target = project_dir / filepath
        target.parent.mkdir(parents=True, exist_ok=True)
        # Strip markdown code fences if the LLM wrapped the content
        clean = content.strip()
        if clean.startswith("```"):
            # Remove opening fence (```tsx, ```ts, ```json, etc.)
            first_nl = clean.index("\n") if "\n" in clean else len(clean)
            clean = clean[first_nl + 1:]
        if clean.endswith("```"):
            clean = clean[:-3]
        target.write_text(clean.strip() + "\n")
        created.append(filepath)
    return created


# ---------------------------------------------------------------------------
# Agent execution — direct Anthropic SDK with async streaming
# ---------------------------------------------------------------------------
async def _call_agent(
    agent_id: str,
    project_id: str,
    context: str,
) -> str:
    """Call the Anthropic API for one agent and stream status updates."""
    config = AGENT_CONFIG[agent_id]
    agent_name = next(a["name"] for a in AGENTS if a["id"] == agent_id)

    user_message = f"{context}\n\n---\n\nYour task:\n{config['instruction']}"

    collected: list[str] = []
    char_count = 0
    milestone = 0

    # Use fast (haiku) or smart (sonnet) model per agent config
    agent_model = MODEL_FAST if config.get("model") == "fast" else MODEL

    async with anthropic.messages.stream(
        model=agent_model,
        max_tokens=config["max_tokens"],
        system=config["system"],
        messages=[{"role": "user", "content": user_message}],
    ) as stream:
        async for text in stream.text_stream:
            collected.append(text)
            char_count += len(text)

            # Send progress logs at milestones (every ~1500 chars)
            new_milestone = char_count // 1500
            if new_milestone > milestone:
                milestone = new_milestone
                await broadcast({
                    "type": "log",
                    "project_id": project_id,
                    "agent_id": agent_id,
                    "agent_name": agent_name,
                    "message": f"Generating output... ({char_count:,} chars)",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                })

    return "".join(collected)


async def _run_tests(project_id: str, project_dir: Path) -> dict[str, Any]:
    """Run vitest tests and return parsed results."""
    import subprocess

    test_results: dict[str, Any] = {"passed": 0, "failed": 0, "total": 0, "tests": [], "raw_output": ""}

    # Check if vitest is available
    if not (project_dir / "node_modules" / ".bin" / "vitest").exists():
        return test_results

    try:
        await broadcast({
            "type": "log",
            "project_id": project_id,
            "agent_id": "qa",
            "agent_name": "QA",
            "message": "🧪 Running tests (vitest)...",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })

        proc = await asyncio.create_subprocess_exec(
            "npx", "vitest", "run", "--reporter=verbose",
            cwd=str(project_dir),
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            env={**os.environ, "CI": "true"},
        )
        stdout, stderr = await proc.communicate()
        output = stdout.decode() + stderr.decode()
        test_results["raw_output"] = output[-2000:]  # Keep last 2000 chars

        # Parse test results from vitest output
        for line in output.split("\n"):
            line_stripped = line.strip()
            if line_stripped.startswith("✓") or line_stripped.startswith("√"):
                test_results["passed"] += 1
                test_results["tests"].append({"name": line_stripped[1:].strip(), "status": "passed"})
            elif line_stripped.startswith("✗") or line_stripped.startswith("×") or line_stripped.startswith("✕"):
                test_results["failed"] += 1
                test_results["tests"].append({"name": line_stripped[1:].strip(), "status": "failed"})

        test_results["total"] = test_results["passed"] + test_results["failed"]

        status_emoji = "✅" if test_results["failed"] == 0 and test_results["passed"] > 0 else "⚠️" if test_results["passed"] > 0 else "❌"
        await broadcast({
            "type": "log",
            "project_id": project_id,
            "agent_id": "qa",
            "agent_name": "QA",
            "message": f"{status_emoji} Tests: {test_results['passed']} passed, {test_results['failed']} failed ({test_results['total']} total)",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })

        # Send individual test results
        for t in test_results["tests"]:
            icon = "✅" if t["status"] == "passed" else "❌"
            await broadcast({
                "type": "log",
                "project_id": project_id,
                "agent_id": "qa",
                "agent_name": "QA",
                "message": f"  {icon} {t['name']}",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })

    except Exception as exc:
        await broadcast({
            "type": "log",
            "project_id": project_id,
            "agent_id": "qa",
            "agent_name": "QA",
            "message": f"Test execution error: {exc}",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })

    return test_results


def _auto_patch_sources(project_dir: Path) -> None:
    """Fix common LLM-generated code issues before building."""
    # 1. Fix missing default export in App.tsx
    app_tsx = project_dir / "src" / "App.tsx"
    if app_tsx.exists():
        code = app_tsx.read_text()
        # If there's no default export, add one
        if "export default" not in code:
            # Find the component name: export function App / export const App
            m = re.search(r"export\s+(?:function|const)\s+(\w+)", code)
            if m:
                comp_name = m.group(1)
                code += f"\nexport default {comp_name};\n"
                app_tsx.write_text(code)
            else:
                # Try to find any function component and export it
                m = re.search(r"(?:function|const)\s+(\w+)\s*(?:\(|=)", code)
                if m:
                    comp_name = m.group(1)
                    code += f"\nexport default {comp_name};\n"
                    app_tsx.write_text(code)

    # 2. Fix main.tsx importing App without default export
    main_tsx = project_dir / "src" / "main.tsx"
    if main_tsx.exists():
        code = main_tsx.read_text()
        # Ensure createRoot pattern exists and uses proper import
        if "import App" in code and "from './App'" in code:
            # Check if App.tsx has default export now — it should after patch above
            pass

    # 3. Fix any .tsx/.ts files with missing React import (for JSX)
    for tsx_file in (project_dir / "src").rglob("*.tsx"):
        code = tsx_file.read_text()
        if "<" in code and "import React" not in code and "from 'react'" not in code:
            code = "import React from 'react';\n" + code
            tsx_file.write_text(code)

    # 4. Fix vite.config.ts: replace terser with esbuild (terser is not bundled)
    vite_cfg = project_dir / "vite.config.ts"
    if vite_cfg.exists():
        cfg = vite_cfg.read_text()
        if "'terser'" in cfg or '"terser"' in cfg:
            cfg = cfg.replace("'terser'", "'esbuild'").replace('"terser"', '"esbuild"')
            vite_cfg.write_text(cfg)

    # 5. Fix sql.js: copy WASM to public/ and patch locateFile to use local path
    sqljs_wasm = project_dir / "node_modules" / "sql.js" / "dist" / "sql-wasm.wasm"
    if sqljs_wasm.exists():
        public_dir = project_dir / "public"
        public_dir.mkdir(exist_ok=True)
        import shutil
        shutil.copy2(str(sqljs_wasm), str(public_dir / "sql-wasm.wasm"))
        # Patch any database.ts that uses the CDN URL to use local path
        for db_file in project_dir.rglob("database.ts"):
            if "node_modules" in str(db_file):
                continue
            code = db_file.read_text()
            if "sql.js.org/dist" in code:
                code = re.sub(
                    r"locateFile:\s*\(.*?\)\s*=>\s*`https://sql\.js\.org/dist/\$\{.*?\}`",
                    "locateFile: () => './sql-wasm.wasm'",
                    code,
                )
                db_file.write_text(code)


async def _build_project(project_id: str, project_dir: Path) -> bool:
    """Run npm install and npm run build in the generated project directory."""
    import subprocess

    # Check that package.json exists
    if not (project_dir / "package.json").exists():
        await broadcast({
            "type": "log",
            "project_id": project_id,
            "agent_id": "devops",
            "agent_name": "Build",
            "message": "No package.json found — skipping build",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
        return False

    try:
        # Auto-patch common LLM code issues
        _auto_patch_sources(project_dir)

        # Patch package.json: ensure build script is 'vite build' (not 'tsc && vite build')
        pkg_json = project_dir / "package.json"
        if pkg_json.exists():
            pkg_text = pkg_json.read_text()
            pkg_text = pkg_text.replace('"tsc && vite build"', '"vite build"')
            pkg_text = pkg_text.replace('"tsc -b && vite build"', '"vite build"')
            pkg_json.write_text(pkg_text)

        # Patch vite.config.ts: ensure base: './' for relative asset paths
        vite_cfg = project_dir / "vite.config.ts"
        if vite_cfg.exists():
            cfg_text = vite_cfg.read_text()
            if "base:" not in cfg_text:
                cfg_text = cfg_text.replace(
                    "export default defineConfig({",
                    "export default defineConfig({\n  base: './',",
                )
                vite_cfg.write_text(cfg_text)

        # npm install
        proc = await asyncio.create_subprocess_exec(
            "npm", "install", "--no-audit", "--no-fund",
            cwd=str(project_dir),
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
        if proc.returncode != 0:
            err = stderr.decode()[-300:] if stderr else "unknown error"
            await broadcast({
                "type": "log",
                "project_id": project_id,
                "agent_id": "devops",
                "agent_name": "Build",
                "message": f"npm install failed: {err}",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })
            return False

        await broadcast({
            "type": "log",
            "project_id": project_id,
            "agent_id": "devops",
            "agent_name": "Build",
            "message": "Dependencies installed. Building...",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })

        # npm run build
        proc = await asyncio.create_subprocess_exec(
            "npm", "run", "build",
            cwd=str(project_dir),
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
        if proc.returncode != 0:
            err = stderr.decode()[-300:] if stderr else "unknown error"
            await broadcast({
                "type": "log",
                "project_id": project_id,
                "agent_id": "devops",
                "agent_name": "Build",
                "message": f"Build failed: {err}",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })
            return False

        await broadcast({
            "type": "log",
            "project_id": project_id,
            "agent_id": "devops",
            "agent_name": "Build",
            "message": "Build successful!",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
        return True

    except Exception as exc:
        await broadcast({
            "type": "log",
            "project_id": project_id,
            "agent_id": "devops",
            "agent_name": "Build",
            "message": f"Build error: {exc}",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
        return False


async def _run_crew(project_id: str, brief: str) -> None:
    """Run all 7 agents sequentially with minimal context passing."""
    project = projects[project_id]
    project_dir = WORKSPACE / project_id
    project_dir.mkdir(parents=True, exist_ok=True)

    # Store outputs keyed by agent_id for selective context
    outputs: dict[str, str] = {}

    # Define what context each agent receives (only what it needs)
    def _build_context(agent_id: str) -> str:
        base = f"PROJECT BRIEF:\n{brief}"
        if agent_id == "orchestrator":
            return base
        if agent_id == "requirements":
            return base + f"\n\n--- Plan ---\n{outputs.get('orchestrator', '')}"
        if agent_id == "architect":
            return base + f"\n\n--- Requirements ---\n{outputs.get('requirements', '')}"
        if agent_id == "developer":
            return base + f"\n\n--- Architecture ---\n{outputs.get('architect', '')}"
        if agent_id == "qa":
            # QA needs the code to review
            return f"PROJECT BRIEF:\n{brief}\n\n--- Code ---\n{outputs.get('developer', '')}"
        if agent_id == "docs":
            return base + f"\n\n--- Architecture ---\n{outputs.get('architect', '')}"
        if agent_id == "devops":
            # DevOps needs to see imports used in code
            return f"PROJECT BRIEF:\n{brief}\n\n--- Code ---\n{outputs.get('developer', '')}"
        return base

    try:
        for agent_def in AGENTS:
            agent_id = agent_def["id"]
            agent_name = agent_def["name"]

            # Mark agent as working
            project["agents"][agent_id] = "working"
            await broadcast({
                "type": "agent_status",
                "project_id": project_id,
                "agent_id": agent_id,
                "status": "working",
            })
            await broadcast({
                "type": "log",
                "project_id": project_id,
                "agent_id": agent_id,
                "agent_name": agent_name,
                "message": "Starting work...",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })

            # Build targeted context for this agent
            context = _build_context(agent_id)

            # Call the LLM
            result = await _call_agent(agent_id, project_id, context)

            # Store output for downstream agents
            outputs[agent_id] = result

            # Parse and save files
            created = _parse_files(result, project_dir)
            if created:
                await broadcast({
                    "type": "log",
                    "project_id": project_id,
                    "agent_id": agent_id,
                    "agent_name": agent_name,
                    "message": f"Created files: {', '.join(created)}",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                })

            # Mark agent done
            project["agents"][agent_id] = "done"
            _save_projects()
            await broadcast({
                "type": "agent_status",
                "project_id": project_id,
                "agent_id": agent_id,
                "status": "done",
            })
            await broadcast({
                "type": "log",
                "project_id": project_id,
                "agent_id": agent_id,
                "agent_name": agent_name,
                "message": f"Completed ({len(result):,} chars). {f'Files: {len(created)}' if created else ''}",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })

        # All agents finished — build the project
        await broadcast({
            "type": "log",
            "project_id": project_id,
            "agent_id": "devops",
            "agent_name": "Build",
            "message": "Building project (npm install + build)...",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })

        build_ok = await _build_project(project_id, project_dir)

        # Run tests after build (tests need node_modules)
        test_results = await _run_tests(project_id, project_dir)
        project["test_results"] = test_results

        project["status"] = "completed"
        project["preview_url"] = f"/preview/{project_id}/"
        project["code_url"] = f"/api/projects/{project_id}/code"
        _save_projects()
        await broadcast({
            "type": "project_complete",
            "project_id": project_id,
            "preview_url": project["preview_url"],
            "code_url": project["code_url"],
            "test_results": test_results,
        })

    except Exception as exc:
        project["status"] = "failed"
        _save_projects()
        for agent_def in AGENTS:
            if project["agents"].get(agent_def["id"]) == "working":
                project["agents"][agent_def["id"]] = "failed"
                await broadcast({
                    "type": "agent_status",
                    "project_id": project_id,
                    "agent_id": agent_def["id"],
                    "status": "failed",
                })
        _save_projects()
        await broadcast({
            "type": "log",
            "project_id": project_id,
            "agent_id": "orchestrator",
            "agent_name": "System",
            "message": f"Error: {exc}",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
        await broadcast({
            "type": "project_failed",
            "project_id": project_id,
            "error": str(exc),
        })


# ---------------------------------------------------------------------------
# REST endpoints
# ---------------------------------------------------------------------------
@app.get("/api/agents")
def get_agents() -> list[dict[str, Any]]:
    return AGENTS


@app.post("/api/briefings")
async def create_briefing(req: BriefRequest) -> dict[str, Any]:
    project_id = uuid.uuid4().hex[:12]
    project = {
        "id": project_id,
        "brief": req.message,
        "status": "running",
        "agents": {a["id"]: "idle" for a in AGENTS},
        "logs": [],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "preview_url": None,
    }
    # Block if there's already a running project
    running = [p for p in projects.values() if p.get("status") == "running"]
    if running:
        return {"error": "busy", "message": "Ya hay un proyecto en ejecución", "project_id": running[0]["id"]}

    projects[project_id] = project
    _save_projects()

    await broadcast({
        "type": "project_started",
        "project_id": project_id,
        "brief": req.message,
    })

    asyncio.create_task(_run_crew(project_id, req.message))

    return {"id": project_id, "status": "running"}


class IterateRequest(BaseModel):
    message: str


@app.post("/api/projects/{project_id}/iterate")
async def iterate_project(project_id: str, req: IterateRequest) -> dict[str, Any]:
    """Iterate on an existing project with a follow-up instruction."""
    if project_id not in projects:
        return {"error": "not found"}
    project = projects[project_id]
    if project.get("status") == "running":
        return {"error": "busy", "message": "El proyecto está en ejecución"}

    project_dir = WORKSPACE / project_id
    if not project_dir.exists():
        return {"error": "not found", "message": "Directorio del proyecto no encontrado"}

    # Mark as running
    project["status"] = "running"
    for a in AGENTS:
        project["agents"][a["id"]] = "idle"
    _save_projects()

    await broadcast({
        "type": "project_started",
        "project_id": project_id,
        "brief": f"[Iteración] {req.message}",
    })

    asyncio.create_task(_run_iterate(project_id, project_dir, req.message))

    return {"id": project_id, "status": "running"}


async def _run_iterate(project_id: str, project_dir: Path, instruction: str) -> None:
    """Re-run the full 7-agent crew with existing code as additional context."""
    # Read all current source files to include as context
    skip_dirs = {"node_modules", "dist", ".vite", ".cache", "public"}
    existing_code: list[str] = []
    for filepath in sorted(project_dir.rglob("*")):
        if filepath.is_dir():
            continue
        rel = filepath.relative_to(project_dir)
        if any(part in skip_dirs for part in rel.parts):
            continue
        if filepath.suffix in {".wasm", ".map", ".lock", ".png", ".jpg", ".ico"}:
            continue
        try:
            content = filepath.read_text(encoding="utf-8", errors="ignore")
            if len(content) > 50000:
                continue
            existing_code.append(f"=== FILE: {rel} ===\n{content}\n=== END FILE ===")
        except Exception:
            continue

    code_context = "\n\n".join(existing_code)

    # Build an augmented brief that includes the existing code + change request
    original_brief = projects[project_id].get("brief", "")
    augmented_brief = (
        f"CHANGE REQUEST — This is an iteration on an existing project.\n\n"
        f"ORIGINAL BRIEF:\n{original_brief}\n\n"
        f"CHANGE REQUESTED BY USER:\n{instruction}\n\n"
        f"EXISTING CODE (current state of the project):\n{code_context}\n\n"
        f"Analyze the change request and modify/extend the existing code accordingly. "
        f"All agents should consider the existing codebase when making decisions."
    )

    # Update the brief to reflect the iteration
    projects[project_id]["brief"] = original_brief.split("\n→")[0] + f"\n→ {instruction}"
    _save_projects()

    # Run the full crew pipeline with the augmented brief
    await _run_crew(project_id, augmented_brief)


@app.get("/api/projects")
def list_projects() -> list[dict[str, Any]]:
    """Return all projects, newest first."""
    return sorted(projects.values(), key=lambda p: p.get("created_at", ""), reverse=True)


@app.get("/api/projects/active")
def get_active_project() -> dict[str, Any]:
    """Return the currently running project, or null."""
    for p in projects.values():
        if p.get("status") == "running":
            return p
    return {"active": None}


@app.get("/api/projects/{project_id}")
def get_project(project_id: str) -> dict[str, Any]:
    if project_id not in projects:
        return {"error": "not found"}
    return projects[project_id]


@app.get("/api/projects/{project_id}/logs")
def get_project_logs(project_id: str) -> dict[str, Any]:
    """Return stored logs for a project."""
    if project_id not in projects:
        return {"error": "not found"}
    return {"project_id": project_id, "logs": projects[project_id].get("logs", [])}


@app.get("/api/projects/{project_id}/code")
def get_project_code(project_id: str) -> dict[str, Any]:
    """Return all source files for a project as a tree with contents."""
    project_dir = WORKSPACE / project_id
    if not project_dir.exists():
        return {"error": "not found"}

    files: list[dict[str, str]] = []
    skip_dirs = {"node_modules", "dist", ".vite", ".cache"}

    for filepath in sorted(project_dir.rglob("*")):
        if filepath.is_dir():
            continue
        # Skip build artifacts and binaries
        rel = filepath.relative_to(project_dir)
        if any(part in skip_dirs for part in rel.parts):
            continue
        # Skip binary/large files
        if filepath.suffix in {".wasm", ".map", ".lock", ".png", ".jpg", ".ico"}:
            continue
        try:
            content = filepath.read_text(encoding="utf-8", errors="ignore")
            if len(content) > 50000:  # Skip files larger than 50KB
                continue
            files.append({
                "path": str(rel),
                "content": content,
                "language": _detect_language(str(rel)),
            })
        except Exception:
            continue

    return {"project_id": project_id, "files": files}


def _detect_language(filepath: str) -> str:
    """Detect language from file extension for syntax highlighting."""
    ext_map = {
        ".ts": "typescript", ".tsx": "tsx", ".js": "javascript", ".jsx": "jsx",
        ".json": "json", ".css": "css", ".html": "html", ".md": "markdown",
        ".yml": "yaml", ".yaml": "yaml", ".sql": "sql",
    }
    for ext, lang in ext_map.items():
        if filepath.endswith(ext):
            return lang
    return "text"


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "myagenti"}

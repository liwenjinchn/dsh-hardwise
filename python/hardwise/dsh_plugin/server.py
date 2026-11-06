"""Loopback-only review UI and private DSH file-intake endpoint."""

import argparse
import hmac
import json
import os
from pathlib import Path
import socket
import sys
import threading
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from hardwise.dsh_plugin.intake import CompareRequest, compare_local
from hardwise.dsh_plugin.store import Disposition, ReviewConflict, ReviewStore
from hardwise.revision.demo import compare_demo_files
from hardwise.revision.server import PST_ROLES, ROLES, _receive_compare


def create_app(workspace: Path, ui_dir: Path, token: str, origin: str, frame_origin: str = ""):
    if frame_origin:
        parsed = urlsplit(frame_origin)
        if (
            parsed.scheme != "http"
            or parsed.hostname != "127.0.0.1"
            or not parsed.port
            or parsed.path
            or parsed.query
            or parsed.fragment
            or parsed.username
            or parsed.password
        ):
            raise ValueError("Embedded review requires an exact loopback DSH origin.")
    store = ReviewStore(workspace)
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    @app.middleware("http")
    async def local_boundary(request: Request, call_next):
        if request.headers.get("host") != origin.split("://", 1)[1]:
            return JSONResponse({"detail": "Invalid local host"}, status_code=403)
        supplied = request.headers.get("authorization", "")
        tool = bool(token) and hmac.compare_digest(supplied, "Bearer " + token)
        if request.url.path.startswith("/tool/") and not tool:
            return JSONResponse({"detail": "Private tool endpoint"}, status_code=403)
        if request.method not in {"GET", "HEAD"} and not tool:
            if (
                request.headers.get("origin") != origin
                or request.headers.get("x-hardwise-ui") != "1"
            ):
                return JSONResponse({"detail": "请从本机评审页面提交。"}, status_code=403)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Cache-Control"] = "no-store"
        if frame_origin:
            response.headers["Content-Security-Policy"] = f"frame-ancestors 'self' {frame_origin}"
        else:
            response.headers["X-Frame-Options"] = "SAMEORIGIN"
        return response

    @app.exception_handler(ReviewConflict)
    async def conflict(request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=409)

    @app.exception_handler(KeyError)
    async def missing(request, exc):
        return JSONResponse({"detail": str(exc.args[0])}, status_code=404)

    @app.exception_handler(ValueError)
    async def invalid(request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=422)

    @app.get("/api/runs")
    def runs():
        return {"runs": store.list()}

    @app.get("/api/runs/{run_id}")
    def run(run_id: str):
        return store.get(run_id)

    @app.post("/api/runs/{run_id}/review")
    def review(run_id: str, disposition: Disposition):
        return store.record(run_id, disposition)

    @app.post("/api/demo")
    def demo():
        return store.create(compare_demo_files(), "公开合成示例 · Telesis")

    @app.post("/api/import/{format}")
    async def upload(format: str, request: Request):
        if format not in {"telesis", "pst"}:
            raise HTTPException(404, "不支持此格式。")
        result = await _receive_compare(request, PST_ROLES if format == "pst" else ROLES)
        return await run_in_threadpool(store.create, result, "本机导入 · " + format.upper())

    @app.post("/tool/compare")
    def compare(request: CompareRequest):
        try:
            result = compare_local(workspace, request)
        except OSError as exc:
            raise HTTPException(422, "无法读取输入，请确认文件存在并位于当前工作目录内。") from exc
        return store.create(result, request.label)

    @app.get("/")
    def index():
        return FileResponse(ui_dir / "index.html")

    app.mount("/static", StaticFiles(directory=ui_dir), name="static")
    return app


def main():
    import uvicorn

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--ui", type=Path, required=True)
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--parent-pipe", action="store_true")
    parser.add_argument("--frame-origin", default="")
    args = parser.parse_args()
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.bind(("127.0.0.1", args.port))
    port = listener.getsockname()[1]
    origin = f"http://127.0.0.1:{port}"
    application = create_app(
        args.workspace,
        args.ui,
        os.environ.get("HARDWISE_BRIDGE_TOKEN", ""),
        origin,
        args.frame_origin,
    )
    config = uvicorn.Config(application, log_level="warning", access_log=False, lifespan="off")
    server = uvicorn.Server(config)
    if args.parent_pipe:

        def watch_parent():
            sys.stdin.buffer.read()
            server.should_exit = True

        threading.Thread(target=watch_parent, daemon=True).start()
    print(json.dumps({"origin": origin, "protocol": "hardwise.dsh.v1"}), flush=True)
    server.run(sockets=[listener])


if __name__ == "__main__":
    main()

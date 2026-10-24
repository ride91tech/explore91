"""Serves the admin console's web build from this service.

The console is an Expo web export — a single-page app. It had never been
deployed anywhere, so it only ever ran on a developer's localhost, which made
every moderation and content tool in it unreachable in practice.

Serving it from the API rather than a separate static host is the same
reasoning the public pages were built on: no second runtime, no second release
cycle. It also means the console is on the **same origin** as the API it
calls, so it needs no CORS allowance at all — the build is exported with an
empty `EXPO_PUBLIC_BACKEND_URL`, which makes every request a relative
`/api/...`.

Serving it publicly grants nothing. The bundle is static JavaScript; every
`/api/admin/*` endpoint checks the admin role server-side, and robots.txt
already disallows /admin.
"""
import os
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

router = APIRouter(include_in_schema=False)

# Populated by scripts/build-console.* before a deploy. Absent in a plain
# checkout, which is why nothing here raises at import time.
CONSOLE_DIR = Path(__file__).parent / "console_dist"
INDEX = CONSOLE_DIR / "index.html"


def is_built() -> bool:
    return INDEX.is_file()


_MISSING = """<!doctype html>
<meta charset="utf-8">
<title>Admin console not built</title>
<style>
  body { font: 15px/1.6 system-ui, sans-serif; margin: 10vh auto; max-width: 34rem;
         padding: 0 1.5rem; color: #12120F; background: #FBFAF8; }
  code { background: #F3F2EC; padding: .15rem .4rem; border-radius: .25rem; }
  h1 { font-size: 1.3rem; }
</style>
<h1>The admin console is not in this build.</h1>
<p>The API is running, but no web export was bundled with it. Build one and
redeploy:</p>
<p><code>npm --prefix frontend run build:console</code></p>
<p>That exports the Expo web build and copies it to
<code>backend/web/console_dist/</code>, which is what this service serves.</p>
"""


def mount(app) -> None:
    """Attach the console's static assets, if a build is present.

    The asset paths inside the bundle are absolute (`/_expo/...`,
    `/assets/...`), so those two prefixes have to be mounted at the root
    rather than under /admin. Neither collides with anything this service
    already answers — the API is under /api, the public pages are /place,
    /city, /sitemap.xml, /robots.txt and /.well-known.
    """
    if not is_built():
        return
    for prefix in ("_expo", "assets"):
        directory = CONSOLE_DIR / prefix
        if directory.is_dir():
            app.mount(
                f"/{prefix}",
                StaticFiles(directory=str(directory)),
                name=f"console-{prefix}",
            )


@router.get("/admin", response_class=HTMLResponse)
@router.get("/admin/{path:path}", response_class=HTMLResponse)
async def console(path: str = ""):
    """Every /admin route returns the same document.

    The export is `output: "single"`, so routing happens in the browser. A
    deep link like /admin/users has no file of its own and must still serve
    index.html, or a refresh on any sub-page 404s.
    """
    if not is_built():
        # 503 rather than 404: the route exists, the build does not.
        return HTMLResponse(_MISSING, status_code=503)
    return FileResponse(INDEX, media_type="text/html")


@router.get("/favicon.ico")
async def favicon():
    icon = CONSOLE_DIR / "favicon.ico"
    if not icon.is_file():
        raise HTTPException(status_code=404)
    return FileResponse(icon)

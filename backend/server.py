"""Emergent's API port forwards to the existing TanStack Node app; Render uses Node directly."""
import os
from contextlib import asynccontextmanager
from pathlib import Path
import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.responses import Response, JSONResponse

load_dotenv(Path(__file__).with_name('.env'))

@asynccontextmanager
async def lifespan(app):
    app.state.client = httpx.AsyncClient(base_url=os.environ['NODE_INTERNAL_URL'], timeout=180, follow_redirects=False)
    yield
    await app.state.client.aclose()

app = FastAPI(lifespan=lifespan)
HOP_HEADERS = {'host', 'connection', 'transfer-encoding', 'content-length', 'content-encoding'}

@app.api_route('/api/{path:path}', methods=['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'])
async def proxy(path: str, request: Request):
    headers = {k: v for k, v in request.headers.items() if k.lower() not in HOP_HEADERS}
    headers['x-forwarded-host'] = request.headers.get('host', '')
    headers['x-forwarded-proto'] = request.headers.get('x-forwarded-proto', request.url.scheme)
    try:
        response = await app.state.client.request(request.method, request.url.path, params=request.query_params, headers=headers, content=await request.body())
        return Response(response.content, status_code=response.status_code, headers={k: v for k, v in response.headers.items() if k.lower() not in HOP_HEADERS})
    except httpx.RequestError:
        return JSONResponse({'detail': 'The site is starting. Please retry shortly.'}, status_code=503)
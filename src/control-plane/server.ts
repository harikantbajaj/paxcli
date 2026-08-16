import { randomBytes } from 'node:crypto';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import {
  type ActivityKind,
  MemoryControlPlane,
  type RepositorySettings,
  type RunStatus,
} from './store.js';

export interface FleetDashboardOptions {
  port?: number;
  repositories?: string[];
  store?: MemoryControlPlane;
}

export interface FleetDashboardHandle {
  url: string;
  token: string;
  store: MemoryControlPlane;
  close: () => Promise<void>;
}

const BODY_LIMIT = 256 * 1024;

/**
 * Starts the zero-footprint fleet control plane. All state is memory-only and
 * all agent-facing strings are redacted at ingestion. No connected repository
 * is opened for writing and no local configuration or event file is created.
 */
export async function startFleetDashboard(
  options: FleetDashboardOptions = {},
): Promise<FleetDashboardHandle> {
  const token = randomBytes(24).toString('hex');
  const store = options.store ?? new MemoryControlPlane();
  for (const name of options.repositories ?? []) store.connectRepository({ name });

  const server = http.createServer(async (req, res) => {
    setSecurityHeaders(res);
    try {
      const host = req.headers.host ?? '';
      if (!/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(host)) return send(res, 403, 'forbidden');
      const url = new URL(req.url ?? '/', `http://${host}`);
      if (url.searchParams.get('t') !== token) return send(res, 401, 'missing or invalid token');

      if (req.method === 'GET' && url.pathname === '/') {
        res.setHeader('content-type', 'text/html; charset=utf-8');
        return send(res, 200, PAGE.replaceAll('__TOKEN__', token));
      }
      if (req.method === 'GET' && url.pathname === '/api/state') {
        return json(res, 200, store.snapshot());
      }
      if (req.method === 'GET' && url.pathname === '/api/events') {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        const unsubscribe = store.subscribe((event) =>
          res.write(`data: ${JSON.stringify(event)}\n\n`),
        );
        const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
        req.on('close', () => {
          unsubscribe();
          clearInterval(ping);
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/repositories') {
        const body = await readBody(req);
        return json(
          res,
          201,
          store.connectRepository({
            name: requiredString(body.name, 'name'),
            ...present('id', optionalString(body.id)),
            ...present(
              'provider',
              oneOf(body.provider, ['github', 'gitlab', 'local', 'other'] as const, 'provider'),
            ),
            ...present('defaultBranch', optionalString(body.defaultBranch)),
            ...present(
              'visibility',
              oneOf(body.visibility, ['private', 'public', 'unknown'] as const, 'visibility'),
            ),
            ...present(
              'settings',
              optionalObject(body.settings) as Partial<RepositorySettings> | undefined,
            ),
          }),
        );
      }

      const settingsMatch = url.pathname.match(/^\/api\/repositories\/([^/]+)\/settings$/);
      if (req.method === 'PATCH' && settingsMatch) {
        const body = await readBody(req);
        return json(
          res,
          200,
          store.updateRepositorySettings(
            decodeURIComponent(settingsMatch[1] as string),
            body as Partial<RepositorySettings>,
          ),
        );
      }
      const repositoryMatch = url.pathname.match(/^\/api\/repositories\/([^/]+)$/);
      if (req.method === 'DELETE' && repositoryMatch) {
        const deleted = store.disconnectRepository(
          decodeURIComponent(repositoryMatch[1] as string),
        );
        return json(res, deleted ? 200 : 404, { deleted });
      }

      if (req.method === 'POST' && url.pathname === '/api/runs') {
        const body = await readBody(req);
        return json(
          res,
          201,
          store.createRun({
            repositoryId: requiredString(body.repositoryId, 'repositoryId'),
            request: requiredString(body.request, 'request'),
            agent: requiredString(body.agent, 'agent'),
            ...present('id', optionalString(body.id)),
            ...present('model', optionalString(body.model)),
          }),
        );
      }

      const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
      if (req.method === 'PATCH' && runMatch) {
        const body = await readBody(req);
        return json(
          res,
          200,
          store.updateRun(decodeURIComponent(runMatch[1] as string), {
            ...present(
              'status',
              oneOf(
                body.status,
                [
                  'queued',
                  'running',
                  'waiting-approval',
                  'completed',
                  'rejected',
                  'failed',
                  'stopped',
                ],
                'status',
              ) as RunStatus | undefined,
            ),
            ...present('stage', optionalString(body.stage)),
            ...present('summary', optionalNullableString(body.summary)),
            ...present('output', optionalNullableString(body.output)),
            ...present('costUsd', optionalNumber(body.costUsd)),
            ...present('finishedAt', optionalNullableString(body.finishedAt)),
          }),
        );
      }

      const activityMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/activities$/);
      if (req.method === 'POST' && activityMatch) {
        const body = await readBody(req);
        return json(
          res,
          201,
          store.appendActivity({
            runId: decodeURIComponent(activityMatch[1] as string),
            kind: oneOf(
              body.kind,
              [
                'plan',
                'hypothesis',
                'tool',
                'file',
                'benchmark',
                'check',
                'decision',
                'output',
                'system',
              ],
              'kind',
            ) as ActivityKind,
            title: requiredString(body.title, 'title'),
            ...present('detail', optionalString(body.detail)),
            ...present('at', optionalString(body.at)),
          }),
        );
      }

      const requestApprovalMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/request-approval$/);
      if (req.method === 'POST' && requestApprovalMatch) {
        const body = await readBody(req);
        return json(
          res,
          200,
          store.requestApproval(
            decodeURIComponent(requestApprovalMatch[1] as string),
            optionalString(body.note),
          ),
        );
      }

      const approvalMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/approval$/);
      if (req.method === 'POST' && approvalMatch) {
        const body = await readBody(req);
        if (typeof body.approved !== 'boolean')
          throw new HttpError(400, 'approved must be boolean');
        return json(
          res,
          200,
          store.decideApproval(
            decodeURIComponent(approvalMatch[1] as string),
            body.approved,
            requiredString(body.actor, 'actor'),
            optionalString(body.note),
          ),
        );
      }

      return send(res, 404, 'not found');
    } catch (error) {
      const status =
        error instanceof HttpError
          ? error.status
          : /Unknown|pending approval/.test(String(error))
            ? 404
            : 500;
      return json(res, status, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(options.port ?? 0, '127.0.0.1', resolve);
    server.once('error', reject);
  });
  server.unref();
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : (options.port ?? 0);
  return {
    url: `http://127.0.0.1:${port}/?t=${token}`,
    token,
    store,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (
    !String(req.headers['content-type'] ?? '')
      .toLowerCase()
      .startsWith('application/json')
  ) {
    throw new HttpError(415, 'content-type must be application/json');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > BODY_LIMIT) throw new HttpError(413, 'request body too large');
    chunks.push(buffer);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('object required');
    return parsed as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'invalid JSON object');
  }
}

function setSecurityHeaders(res: ServerResponse): void {
  res.setHeader(
    'content-security-policy',
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  );
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('cache-control', 'no-store');
}

function send(res: ServerResponse, status: number, body: string): void {
  res.statusCode = status;
  res.end(body);
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, `${name} is required`);
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new HttpError(400, 'expected a string');
  return value.trim();
}

function optionalNullableString(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return value;
  return optionalString(value);
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new HttpError(400, 'expected a finite number');
  return value;
}

function optionalObject(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new HttpError(400, 'expected an object');
  return value as Record<string, unknown>;
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  name: string,
): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !allowed.includes(value as T))
    throw new HttpError(400, `${name} must be one of: ${allowed.join(', ')}`);
  return value as T;
}

function present<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return value === undefined ? {} : ({ [key]: value } as { [P in K]: V });
}

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Paxcli Fleet</title><style>
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif;background:#080b12;color:#edf2f7}*{box-sizing:border-box}body{margin:0}.shell{display:grid;grid-template-columns:250px 1fr;min-height:100vh}.side{border-right:1px solid #202637;padding:24px;background:#0d111b}.brand{font-weight:800;font-size:20px;margin-bottom:28px}.brand b{color:#67e8f9}.nav{color:#9aa6ba;font-size:14px}.nav div{padding:10px 12px;border-radius:8px;margin:4px 0}.nav .on{background:#172033;color:white}.zero{position:absolute;bottom:24px;width:202px;font-size:12px;color:#7f8a9e}.main{padding:28px;max-width:1400px;width:100%}.top{display:flex;justify-content:space-between;align-items:center}.pill{background:#12271f;color:#6ee7b7;border:1px solid #245b43;border-radius:999px;padding:6px 10px;font-size:12px}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:24px 0}.card,.panel{background:#0f1521;border:1px solid #20293a;border-radius:12px;padding:18px}.stat{font-size:26px;font-weight:750;margin-top:6px}.muted{color:#8d99ad}.grid{display:grid;grid-template-columns:1.5fr 1fr;gap:16px}.panel h2{font-size:15px;margin:0 0 14px}table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;padding:11px 8px;border-bottom:1px solid #1c2432;vertical-align:top}th{color:#78859a;font-weight:500}.status{font-size:11px;border-radius:99px;padding:4px 7px;background:#172033}.running{color:#67e8f9}.completed{color:#6ee7b7}.failed,.rejected,.stopped{color:#fca5a5}.waiting-approval{color:#fcd34d}.activity{padding:12px 0;border-bottom:1px solid #1c2432}.activity b{display:block;font-size:13px}.activity small{color:#778399}.detail{font-size:12px;color:#aab4c4;margin-top:4px;white-space:pre-wrap}.empty{padding:30px;text-align:center;color:#6f7a8e}.repo{cursor:pointer}.repo:hover{color:#67e8f9}@media(max-width:900px){.shell{grid-template-columns:1fr}.side{display:none}.stats{grid-template-columns:repeat(2,1fr)}.grid{grid-template-columns:1fr}.main{padding:16px}}
</style></head><body><div class="shell"><aside class="side"><div class="brand"><b>pax</b>cli fleet</div><div class="nav"><div class="on">Overview</div><div>Repositories</div><div>Agent runs</div><div>Approvals</div><div>Policies</div></div><div class="zero">Zero repository footprint<br>No config, logs, or receipts are written to connected repos.</div></aside><main class="main"><div class="top"><div><h1 style="margin:0;font-size:22px">Agent operations</h1><div class="muted">Live, verified work across connected repositories</div></div><span class="pill">● Live</span></div><section class="stats"><div class="card"><div class="muted">Repositories</div><div class="stat" id="repoCount">0</div></div><div class="card"><div class="muted">Active agents</div><div class="stat" id="activeCount">0</div></div><div class="card"><div class="muted">Waiting approval</div><div class="stat" id="approvalCount">0</div></div><div class="card"><div class="muted">Verified outcomes</div><div class="stat" id="verifiedCount">0</div></div></section><div class="grid"><section class="panel"><h2>Repositories and agent runs</h2><table><thead><tr><th>Repository</th><th>Agent</th><th>Current work</th><th>Status</th><th>Cost</th></tr></thead><tbody id="runs"></tbody></table><div class="empty" id="noRuns">Connect a repository and stream a run to see agent activity.</div></section><section class="panel"><h2>Live activity</h2><div id="activities"></div><div class="empty" id="noActivity">Agent plans, hypotheses, actions, checks, and decisions appear here. Private chain-of-thought is never displayed.</div></section></div></main></div><script>
const token='__TOKEN__';const esc=s=>{const n=document.createElement('span');n.textContent=s??'';return n.innerHTML};
async function refresh(){const r=await fetch('/api/state?t='+token);const d=await r.json();const repos=new Map(d.repositories.map(x=>[x.id,x]));const active=d.runs.filter(x=>['queued','running','waiting-approval'].includes(x.status));document.querySelector('#repoCount').textContent=d.repositories.length;document.querySelector('#activeCount').textContent=active.length;document.querySelector('#approvalCount').textContent=d.runs.filter(x=>x.approval.status==='pending').length;document.querySelector('#verifiedCount').textContent=d.runs.filter(x=>x.status==='completed').length;const rows=d.runs.sort((a,b)=>b.startedAt.localeCompare(a.startedAt)).map(x=>'<tr><td class="repo">'+esc(repos.get(x.repositoryId)?.name||x.repositoryId)+'</td><td>'+esc(x.agent)+(x.model?'<div class="muted">'+esc(x.model)+'</div>':'')+'</td><td><b>'+esc(x.request)+'</b><div class="muted">'+esc(x.stage)+'</div></td><td><span class="status '+x.status+'">'+esc(x.status)+'</span></td><td>$'+Number(x.costUsd).toFixed(2)+'</td></tr>').join('');document.querySelector('#runs').innerHTML=rows;document.querySelector('#noRuns').style.display=rows?'none':'block';const runMap=new Map(d.runs.map(x=>[x.id,x]));const acts=d.activities.slice(-30).reverse().map(a=>'<div class="activity"><b>'+esc(a.title)+'</b><small>'+esc(runMap.get(a.runId)?.agent||'agent')+' · '+new Date(a.at).toLocaleTimeString()+' · '+esc(a.kind)+'</small>'+(a.detail?'<div class="detail">'+esc(a.detail)+'</div>':'')+'</div>').join('');document.querySelector('#activities').innerHTML=acts;document.querySelector('#noActivity').style.display=acts?'none':'block'}
refresh();new EventSource('/api/events?t='+token).onmessage=refresh;setInterval(refresh,15000);
</script></body></html>`;

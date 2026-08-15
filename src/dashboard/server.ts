import { randomBytes } from 'node:crypto';
import { existsSync, watch } from 'node:fs';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { redactText } from '../proof/redact.js';
import { EventStore, runDir } from '../tree/store.js';

/**
 * Read-only decision dashboard. Dependency-free by design: one node:http
 * server, one inline HTML page, SSE for live updates by tailing events.jsonl.
 *
 * Security posture (read-only is not harmless — it shows diff reasons and
 * hypotheses): binds 127.0.0.1 only, requires a random session token, rejects
 * foreign Host headers (DNS-rebinding), sets a strict CSP, redacts secrets,
 * and shuts itself down after 30 minutes without a client.
 */

export interface DashboardHandle {
  url: string;
  close: () => void;
}

const IDLE_SHUTDOWN_MS = 30 * 60 * 1000;

export async function startDashboard(
  repoRoot: string,
  runIdValue: string,
  port = 0,
): Promise<DashboardHandle> {
  const token = randomBytes(16).toString('hex');
  let lastActivity = Date.now();

  const server = http.createServer(async (req, res) => {
    lastActivity = Date.now();
    const host = req.headers.host ?? '';
    if (!/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(host)) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }
    const url = new URL(req.url ?? '/', `http://${host}`);
    if (url.searchParams.get('t') !== token) {
      res.writeHead(401);
      res.end('missing or invalid token');
      return;
    }

    if (url.pathname === '/') {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy':
          "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'",
        'x-content-type-options': 'nosniff',
      });
      res.end(PAGE.replace('__TOKEN__', token).replace('__RUN__', runIdValue));
      return;
    }

    if (url.pathname === '/api/run') {
      const summary = await (await EventStore.open(repoRoot, runIdValue)).replay();
      const nodes = [...summary.nodes.values()].map((n) => ({
        id: n.id,
        status: n.status,
        grade: n.grade,
        hypothesis: redactText(n.hypothesis),
        reason: redactText(n.decisionReason ?? ''),
        score: n.score?.value ?? null,
        costUsd: n.agentRun?.costUsd ?? null,
      }));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          runId: summary.runId,
          finished: summary.finished,
          reason: summary.finishReason,
          baseline: summary.baseline?.value ?? null,
          metric: summary.baseline?.metric ?? null,
          bestNodeId: summary.bestNodeId,
          totalCostUsd: summary.totalCostUsd,
          nodes,
        }),
      );
      return;
    }

    if (url.pathname === '/api/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      const eventsPath = path.join(runDir(repoRoot, runIdValue), 'events.jsonl');
      let offset = 0;
      const push = async () => {
        try {
          const raw = await readFile(eventsPath, 'utf8');
          if (raw.length > offset) {
            const fresh = raw.slice(offset);
            offset = raw.length;
            for (const line of fresh.split('\n')) {
              if (line.trim()) res.write(`data: ${redactText(line.trim())}\n\n`);
            }
          }
        } catch {
          // file may rotate; ignore
        }
      };
      await push();
      const watcher = existsSync(eventsPath) ? watch(eventsPath, () => void push()) : null;
      const ping = setInterval(() => res.write(': ping\n\n'), 15000);
      req.on('close', () => {
        watcher?.close();
        clearInterval(ping);
      });
      return;
    }

    res.writeHead(404);
    res.end('not found');
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(port, '127.0.0.1', () => resolve());
    server.on('error', reject);
  });
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;

  const idleTimer = setInterval(() => {
    if (Date.now() - lastActivity > IDLE_SHUTDOWN_MS) {
      clearInterval(idleTimer);
      server.close();
    }
  }, 60_000);
  idleTimer.unref();
  server.unref();

  return {
    url: `http://127.0.0.1:${actualPort}/?t=${token}`,
    close: () => {
      clearInterval(idleTimer);
      server.close();
    },
  };
}

const PAGE = `<!doctype html>
<meta charset="utf-8">
<title>paxcli run</title>
<style>
  :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
  body { margin: 2rem auto; max-width: 60rem; padding: 0 1rem; line-height: 1.5; }
  h1 { font-size: 1.2rem; } .muted { opacity: .65; }
  .winner { border: 2px solid #16a34a; border-radius: 8px; padding: 1rem; margin: 1rem 0; }
  table { border-collapse: collapse; width: 100%; margin-top: 1rem; }
  td, th { text-align: left; padding: .4rem .6rem; border-bottom: 1px solid rgba(128,128,128,.3); vertical-align: top; }
  .accepted { color: #16a34a; } .rejected { color: #dc2626; } .running { color: #d97706; }
  code { font-size: .85em; }
</style>
<h1>paxcli · run <code>__RUN__</code> <span id="state" class="muted"></span></h1>
<div id="winner"></div>
<table><thead><tr><th></th><th>Hypothesis</th><th>Outcome</th></tr></thead><tbody id="rows"></tbody></table>
<p class="muted">Read-only view. Refreshes live; decisions happen in your terminal and your git review.</p>
<script>
const token = '__TOKEN__';
async function refresh() {
  const r = await fetch('/api/run?t=' + token);
  const d = await r.json();
  document.getElementById('state').textContent =
    (d.finished ? 'finished: ' + d.reason : 'in progress') + ' · $' + d.totalCostUsd.toFixed(2);
  const best = d.nodes.find(n => n.id === d.bestNodeId);
  document.getElementById('winner').innerHTML = best
    ? '<div class="winner"><strong>Current winner</strong> (' + (best.grade ?? 'ungraded') + ')<br>' +
      esc(best.hypothesis) + '<br><span class="muted">' + esc(best.reason) + '</span><br>' +
      'Apply with: <code>paxcli apply ' + best.id + '</code></div>'
    : '<p class="muted">No verified improvement yet.</p>';
  document.getElementById('rows').innerHTML = d.nodes.map(n =>
    '<tr><td class="' + n.status + '">' + ({accepted:'✓',rejected:'✗',failed:'⚠'}[n.status] ?? '…') + '</td>' +
    '<td>' + esc(n.hypothesis || '(pending)') + '</td>' +
    '<td class="muted">' + esc(n.reason || n.status) + '</td></tr>').join('');
}
function esc(s) { const d = document.createElement('span'); d.textContent = s ?? ''; return d.innerHTML; }
refresh();
new EventSource('/api/events?t=' + token).onmessage = () => refresh();
setInterval(refresh, 10000);
</script>`;

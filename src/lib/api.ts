import type { HistoryEntry, Project, ProjectSummary, ServerEvent } from '../../shared/types.ts';
import type { Op } from '../../shared/ops.ts';

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}

export const clientId = Math.random().toString(36).slice(2);

export const api = {
  health: () => req<{ ok: boolean; claudeSeenAt: string | null; editors: number; root?: string }>('/health'),
  list: () => req<ProjectSummary[]>('/projects'),
  get: (id: string) => req<Project>(`/projects/${id}`),
  create: (p: Partial<Project> & { from?: string }) => req<Project>('/projects', { method: 'POST', body: JSON.stringify(p) }),
  remove: (id: string) => req<{ ok: boolean }>(`/projects/${id}`, { method: 'DELETE' }),
  save: (project: Project, label: string, coalesce?: string) =>
    req<{ rev: number }>(`/projects/${project.id}`, { method: 'PUT', body: JSON.stringify({ project, label, source: 'user', clientId, coalesce }) }),
  ops: (id: string, ops: Op[], label: string) => req<{ project: Project; created: string[] }>(`/projects/${id}/ops`, { method: 'POST', body: JSON.stringify({ ops, label, source: 'user' }) }),
  undo: (id: string) => req<{ project: Project; moved: boolean }>(`/projects/${id}/undo`, { method: 'POST' }),
  redo: (id: string) => req<{ project: Project; moved: boolean }>(`/projects/${id}/redo`, { method: 'POST' }),
  history: (id: string) => req<{ history: HistoryEntry[]; cursor: number }>(`/projects/${id}/history`),
  select: (projectId: string, layerIds: string[], time: number) =>
    fetch('/api/selection', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId, layerIds, time }) }).catch(() => {}),
  renderResult: (requestId: string, frames: string[]) =>
    req(`/render-result/${requestId}`, { method: 'POST', body: JSON.stringify({ frames }) }),
  async upload(file: File): Promise<string> {
    const res = await fetch(`/api/assets?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? 'Upload failed');
    return data.url as string;
  },
};

export function subscribe(projectId: string | null, onEvent: (e: ServerEvent) => void): () => void {
  const es = new EventSource(`/api/events${projectId ? `?project=${encodeURIComponent(projectId)}` : ''}`);
  es.onmessage = (m) => {
    try { onEvent(JSON.parse(m.data) as ServerEvent); } catch { /* ignore */ }
  };
  return () => es.close();
}

export function timeAgo(iso: string | null): string {
  if (!iso) return 'never';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

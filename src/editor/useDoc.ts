import { useCallback, useEffect, useRef, useState } from 'react';
import type { HistoryEntry, Project, ServerEvent } from '../../shared/types.ts';
import { api, clientId, subscribe } from '../lib/api.ts';

export interface DocApi {
  project: Project | null;
  error: string | null;
  history: { history: HistoryEntry[]; cursor: number };
  claude: { status: string; at: string } | null;
  claudeSeenAt: string | null;
  /** Save a change as one undo step. Same coalesce key within ~1.5 s merges into one step. */
  commit: (next: Project, label: string, coalesce?: string) => void;
  /** Local-only update while dragging; follow with commit. */
  preview: (next: Project) => void;
  undo: () => void;
  redo: () => void;
  toast: string | null;
  notify: (msg: string) => void;
}

export function useDoc(id: string, onRender: (e: Extract<ServerEvent, { type: 'render' }>) => void): DocApi {
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<{ history: HistoryEntry[]; cursor: number }>({ history: [], cursor: 0 });
  const [claude, setClaude] = useState<{ status: string; at: string } | null>(null);
  const [claudeSeenAt, setClaudeSeenAt] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const renderRef = useRef(onRender);
  renderRef.current = onRender;

  const notify = useCallback((msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  useEffect(() => {
    let alive = true;
    setProject(null);
    setError(null);
    api.get(id).then((p) => alive && setProject(p), (e: Error) => alive && setError(e.message));
    api.history(id).then((h) => alive && setHistory(h), () => {});
    const off = subscribe(id, (e) => {
      if (e.type === 'hello') setClaudeSeenAt(e.claudeSeenAt);
      if (e.type === 'project' && e.project.id === id && e.clientId !== clientId) {
        setProject(e.project);
        if (e.source === 'claude') {
          setClaudeSeenAt(new Date().toISOString());
          notify(`Claude · ${e.label}`);
        }
      }
      if (e.type === 'history' && e.projectId === id) setHistory({ history: e.history, cursor: e.cursor });
      if (e.type === 'claude' && e.projectId === id) { setClaude({ status: e.status, at: e.at }); setClaudeSeenAt(e.at); }
      if (e.type === 'render' && e.projectId === id) renderRef.current(e);
    });
    return () => { alive = false; off(); };
  }, [id, notify]);

  const commit = useCallback((next: Project, label: string, coalesce?: string) => {
    setProject(next);
    queue.current = queue.current.then(() => api.save(next, label, coalesce)).catch((e: Error) => notify(`Save failed: ${e.message}`));
  }, [notify]);

  const travel = useCallback((dir: 'undo' | 'redo') => {
    queue.current = queue.current
      .then(() => api[dir](id))
      .then((r) => { if (r?.moved) setProject(r.project); else notify(`Nothing to ${dir}`); })
      .catch((e: Error) => notify(e.message));
  }, [id, notify]);

  return {
    project, error, history, claude, claudeSeenAt, commit, preview: setProject,
    undo: () => travel('undo'), redo: () => travel('redo'), toast, notify,
  };
}

import { useState } from 'react';
import { ACTIVE_STATUSES } from '../config';
import type { DownloadJob } from '../types';
import { DownloadCard, type DeliveryState } from './DownloadCard';
import { Icon } from './Icon';
interface Props {
  jobs: DownloadJob[];
  loading: boolean;
  error: string;
  reconnecting: boolean;
  deliveries: Record<string, DeliveryState>;
  onRefresh(): Promise<void>;
  onCancel(id: string): Promise<void>;
  onRetry(id: string): Promise<void>;
  onSave(job: DownloadJob): Promise<void>;
}
export function QueuePanel({ jobs, loading, error, reconnecting, deliveries, onRefresh, onCancel, onRetry, onSave }: Props) {
  const [filter, setFilter] = useState('all');
  const active = jobs.filter(job => ACTIVE_STATUSES.has(job.status));
  const completed = jobs.filter(job => ['completed', 'delivered'].includes(job.status));
  const visible = filter === 'active' ? active : filter === 'done' ? completed : jobs;
  return <aside className="queue-column" aria-labelledby="downloads-title"><section className="queue-panel panel"><div className="section-heading"><h2 id="downloads-title">Your downloads <span className="count-badge">{jobs.length}</span></h2><Icon name="download" size={19} /></div><div className="queue-filters" aria-label="Filter downloads">{[{ value: 'all', label: 'All', count: jobs.length }, { value: 'active', label: 'Active', count: active.length }, { value: 'done', label: 'Done', count: completed.length }].map(item => <button key={item.value} className={filter === item.value ? 'filter-active' : ''} type="button" aria-pressed={filter === item.value} onClick={() => setFilter(item.value)}>{item.label}{item.count > 0 && <span>{item.count}</span>}</button>)}</div>{reconnecting && <p className="reconnect-notice" role="status">Reconnecting to live progress… Downloads continue in the background.</p>}{error && <div className="queue-error" role="alert"><p>{error}</p><button className="text-button" type="button" onClick={() => void onRefresh()}>Try connecting again <Icon name="retry" size={14} /></button></div>}<div className="queue-content">{loading ? <p className="queue-loading"><span className="spinner" />Loading your downloads…</p> : visible.length ? visible.map(job => <DownloadCard key={job.id} job={job} delivery={deliveries[job.id]} onCancel={onCancel} onRetry={onRetry} onSave={onSave} />) : <div className="queue-empty"><div className="queue-illustration" aria-hidden="true"><span className="mini-file mini-back" /><span className="mini-file mini-front"><Icon name="download" size={25} /><i /><i /></span><span className="mini-check"><Icon name="check" size={13} /></span></div><h3>{filter === 'active' ? 'All clear.' : filter === 'done' ? 'The good stuff is coming.' : 'A fresh start.'}</h3><p>{filter === 'active' ? 'There are no downloads in progress.' : filter === 'done' ? 'Your finished downloads will appear here.' : 'Your downloads will live here.\nAdd a link to get things going.'}</p></div>}</div><div className="queue-footer"><span className={`status-dot ${active.length ? 'working' : ''}`} /><span>{active.length ? `${active.length} download${active.length === 1 ? '' : 's'} in progress` : 'Ready when you are'}</span></div></section><div className="little-note"><span className="note-icon"><Icon name="spark" size={20} /></span><p><strong>Good quality. Less waiting.</strong><br />GSD uses the source format when it can, and converts only when needed.</p></div></aside>;
}

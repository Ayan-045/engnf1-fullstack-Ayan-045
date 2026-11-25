import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  Check,
  FileUp,
  RotateCcw,
  Search,
  X,
} from 'lucide-react';
import { api, ApiClientError } from '../lib/api';
import { formatLocalDateTime } from '../lib/format';
import type {
  Ticket,
  TicketCategory,
  TicketEvent,
  TicketPriority,
  TicketStats,
  TicketStatus,
} from '../types';

const CATEGORIES: TicketCategory[] = [
  'DELIVERY',
  'BILLING',
  'TECHNICAL',
  'ACCOUNT',
  'GENERAL',
];

const PRIORITIES: TicketPriority[] = ['URGENT', 'HIGH', 'MEDIUM', 'LOW'];
const STATUSES: TicketStatus[] = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];

function getPriorityTextClass(priority: TicketPriority): string {
  switch (priority) {
    case 'URGENT':
      return 'text-red-700 font-semibold';
    case 'HIGH':
      return 'text-amber-700 font-semibold';
    case 'MEDIUM':
      return 'text-slate-700 font-medium';
    case 'LOW':
      return 'text-slate-500';
  }
}

function getStatusTextClass(status: TicketStatus): string {
  switch (status) {
    case 'OPEN':
      return 'text-blue-700 font-medium';
    case 'IN_PROGRESS':
      return 'text-amber-700 font-medium';
    case 'RESOLVED':
    case 'CLOSED':
      return 'text-emerald-700 font-medium';
  }
}

export function TriageView() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<TicketStats | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [events, setEvents] = useState<TicketEvent[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingEvents, setLoadingEvents] = useState(false);

  // Filters
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [reviewedFilter, setReviewedFilter] = useState('');

  // Optimistic update & rollback state
  const [rollbackNotice, setRollbackNotice] = useState<string | null>(null);
  const [saveBanner, setSaveBanner] = useState<string | null>(null);
  const [savingField, setSavingField] = useState(false);

  // Import modal
  const [importOpen, setImportOpen] = useState(false);
  const [importJson, setImportJson] = useState(
    JSON.stringify(
      [
        {
          externalId: `EXT-${Math.floor(2000 + Math.random() * 7000)}`,
          subject: 'My package has not arrived',
          body: 'Shipment tracking stalled in customs for 5 business days.',
          customerEmail: 'buyer@northwind.example',
        },
      ],
      null,
      2
    )
  );
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const fetchStats = useCallback(async () => {
    try {
      const s = await api.getStats();
      setStats(s);
    } catch {
      // Non-fatal stats error handled silently
    }
  }, []);

  const fetchTickets = useCallback(async () => {
    setLoadingList(true);
    try {
      const res = await api.getTickets({
        status: statusFilter,
        category: categoryFilter,
        priority: priorityFilter,
        isReviewed: reviewedFilter,
        q: query.trim(),
        limit: 100,
        offset: 0,
      });
      setTickets(res.tickets);
      setTotal(res.total);
      setSelectedId((prev) => {
        if (prev && res.tickets.some((t) => t.id === prev)) return prev;
        return res.tickets[0]?.id ?? null;
      });
    } catch (err) {
      setRollbackNotice(
        err instanceof ApiClientError
          ? err.message
          : 'Failed to load tickets from database.'
      );
    } finally {
      setLoadingList(false);
    }
  }, [statusFilter, categoryFilter, priorityFilter, reviewedFilter, query]);

  useEffect(() => {
    fetchTickets();
    fetchStats();
  }, [fetchTickets, fetchStats]);

  useEffect(() => {
    if (!selectedId) {
      setEvents([]);
      return;
    }
    let active = true;
    setLoadingEvents(true);
    api
      .getTicketDetail(selectedId)
      .then((res) => {
        if (!active) return;
        setEvents(res.events);
      })
      .catch(() => {
        if (!active) return;
        setEvents([]);
      })
      .finally(() => {
        if (active) setLoadingEvents(false);
      });
    return () => {
      active = false;
    };
  }, [selectedId]);

  const selectedTicket = tickets.find((t) => t.id === selectedId) ?? null;

  async function handleOptimisticPatch(
    ticket: Ticket,
    patch: {
      category?: TicketCategory;
      priority?: TicketPriority;
      status?: TicketStatus;
    }
  ) {
    setRollbackNotice(null);
    setSaveBanner(null);
    const snapshot = { ...ticket };

    // Optimistically apply new values + derived override/reviewed flags
    const optimistic: Ticket = {
      ...ticket,
      ...patch,
      isHumanOverride:
        patch.category !== undefined && patch.category !== ticket.category
          ? true
          : ticket.isHumanOverride,
      isReviewed:
        (patch.category !== undefined && patch.category !== ticket.category) ||
        (patch.status !== undefined && patch.status !== 'OPEN')
          ? true
          : ticket.isReviewed,
      updatedAt: new Date().toISOString(),
    };

    setTickets((prev) =>
      prev.map((item) => (item.id === ticket.id ? optimistic : item))
    );
    setSavingField(true);

    try {
      const res = await api.updateTicket(ticket.id, patch);
      setTickets((prev) =>
        prev.map((item) => (item.id === ticket.id ? res.ticket : item))
      );
      setEvents(res.events);
      setSaveBanner('Saved change and appended audit event.');
      fetchStats();
    } catch (err) {
      // Visible rollback to exact snapshot on API rejection
      setTickets((prev) =>
        prev.map((item) => (item.id === ticket.id ? snapshot : item))
      );
      const reason =
        err instanceof ApiClientError
          ? `${err.code}: ${err.message}`
          : 'Server rejected update.';
      setRollbackNotice(
        `Optimistic update rolled back for ${ticket.externalId} (${reason})`
      );
    } finally {
      setSavingField(false);
    }
  }

  async function handleImportSubmit(e: React.FormEvent) {
    e.preventDefault();
    setImportError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(importJson);
    } catch {
      setImportError('Input must be valid JSON.');
      return;
    }

    const list = Array.isArray(parsed) ? parsed : [parsed];
    setImporting(true);
    try {
      const result = await api.importTickets(list);
      setImportOpen(false);
      setSaveBanner(
        `Import complete: ${result.created} created, ${result.updated} updated, ${result.skipped} unchanged.`
      );
      await Promise.all([fetchTickets(), fetchStats()]);
    } catch (err) {
      setImportError(
        err instanceof ApiClientError
          ? err.message
          : 'Failed to import tickets.'
      );
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Workspace Header & Primary Action */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
            Ticket Triage Queue
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Deterministic classification with human-override protection and
            immutable audit logs.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setImportError(null);
            setImportOpen(true);
          }}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
        >
          <FileUp className="w-4 h-4" />
          <span>Import Tickets</span>
        </button>
      </div>

      {/* Stats Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 bg-white border border-slate-200 rounded-xl divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
        <div className="p-4 sm:p-5">
          <div className="text-xs font-medium text-slate-500">Total Tickets</div>
          <div className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums font-mono">
            {stats ? stats.totalTickets : '—'}
          </div>
        </div>
        <div className="p-4 sm:p-5">
          <div className="text-xs font-medium text-slate-500">Open Queue</div>
          <div className="mt-1 text-2xl font-semibold text-blue-700 tabular-nums font-mono">
            {stats ? stats.openTickets : '—'}
          </div>
        </div>
        <div className="p-4 sm:p-5">
          <div className="text-xs font-medium text-slate-500">
            Reviewed Tickets
          </div>
          <div className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums font-mono">
            {stats ? stats.reviewedTickets : '—'}
          </div>
        </div>
        <div className="p-4 sm:p-5">
          <div className="text-xs font-medium text-slate-500">
            Model Agreement Rate
          </div>
          <div className="mt-1 text-2xl font-semibold text-emerald-700 tabular-nums font-mono">
            {stats ? `${stats.modelAgreementRate}%` : '—'}
          </div>
        </div>
      </div>

      {/* Feedback / Rollback Banners */}
      {rollbackNotice && (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 p-3.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-900"
        >
          <div className="flex items-start gap-2.5">
            <RotateCcw className="w-4 h-4 shrink-0 mt-0.5 text-red-700" />
            <span>{rollbackNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setRollbackNotice(null)}
            aria-label="Dismiss rollback notice"
            className="text-red-700 hover:text-red-900"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {saveBanner && (
        <div className="flex items-center justify-between gap-3 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-900">
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 shrink-0 text-emerald-700" />
            <span>{saveBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setSaveBanner(null)}
            aria-label="Dismiss notification"
            className="text-emerald-700 hover:text-emerald-900"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Filter Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <div className="lg:col-span-2 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search ID, subject, body, or email..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
            />
          </div>

          <select
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-800 focus:outline-none focus:border-blue-600"
          >
            <option value="">All Statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter by category"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-800 focus:outline-none focus:border-blue-600"
          >
            <option value="">All Categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter by priority"
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-800 focus:outline-none focus:border-blue-600"
          >
            <option value="">All Priorities</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter by reviewed state"
            value={reviewedFilter}
            onChange={(e) => setReviewedFilter(e.target.value)}
            className="px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-800 focus:outline-none focus:border-blue-600"
          >
            <option value="">All Review States</option>
            <option value="false">Unreviewed</option>
            <option value="true">Reviewed</option>
          </select>
        </div>
      </div>

      {/* Main Split Pane: Queue List + Detail Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Queue List */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-700">
              Queue ({total})
            </span>
            <span className="text-xs text-slate-500">
              Local time · Escaped text rendering
            </span>
          </div>

          {loadingList ? (
            <div className="divide-y divide-slate-100">
              {[1, 2, 3, 4].map((n) => (
                <div key={n} className="p-4 space-y-2 animate-pulse">
                  <div className="h-3 bg-slate-100 rounded w-1/3" />
                  <div className="h-4 bg-slate-100 rounded w-3/4" />
                </div>
              ))}
            </div>
          ) : tickets.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm text-slate-600">
                No tickets match the active filters.
              </p>
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setStatusFilter('');
                  setCategoryFilter('');
                  setPriorityFilter('');
                  setReviewedFilter('');
                }}
                className="mt-3 px-3 py-1.5 text-xs font-medium text-blue-700 hover:underline"
              >
                Reset filters
              </button>
            </div>
          ) : (
            <div className="divide-y divide-slate-200 max-h-[680px] overflow-y-auto">
              {tickets.map((t) => {
                const isSelected = t.id === selectedId;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelectedId(t.id)}
                    className={`w-full text-left px-4 py-3.5 transition-colors block ${
                      isSelected ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex flex-wrap items-center gap-1.5 text-slate-500">
                        <span className="font-mono font-medium text-slate-800 tabular-nums">
                          {t.externalId}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{t.category}</span>
                        <span aria-hidden="true">·</span>
                        <span className={getPriorityTextClass(t.priority)}>
                          {t.priority}
                        </span>
                        {t.isHumanOverride && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-blue-700 font-medium">
                              Override
                            </span>
                          </>
                        )}
                      </div>
                      <span className={getStatusTextClass(t.status)}>
                        {t.status}
                      </span>
                    </div>

                    <div className="mt-1.5 text-sm font-medium text-slate-900 break-words">
                      {t.subject}
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 tabular-nums">
                      <span className="truncate max-w-[220px]">
                        {t.customerEmail}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{t.isReviewed ? 'Reviewed' : 'Pending review'}</span>
                      <span aria-hidden="true">·</span>
                      <span>{formatLocalDateTime(t.createdAt)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Detail Panel */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5">
          {!selectedTicket ? (
            <div className="py-12 text-center text-sm text-slate-500">
              Select a ticket from the queue to inspect its payload and audit
              history.
            </div>
          ) : (
            <div className="space-y-5">
              <div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 tabular-nums">
                  <span className="font-mono font-semibold text-slate-900">
                    {selectedTicket.externalId}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>Auto: {selectedTicket.autoCategory}</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {selectedTicket.isHumanOverride
                      ? 'Human Override Active'
                      : 'Classifier Synced'}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {selectedTicket.isReviewed ? 'Reviewed' : 'Unreviewed'}
                  </span>
                </div>

                {/* Safe JSX text interpolation (no HTML injection) */}
                <h2 className="mt-2 font-display text-lg font-semibold text-slate-900 break-words">
                  {selectedTicket.subject}
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  From {selectedTicket.customerEmail} · Created{' '}
                  {formatLocalDateTime(selectedTicket.createdAt)}
                </p>
              </div>

              <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-sm text-slate-800 whitespace-pre-wrap break-words font-sans">
                {selectedTicket.body}
              </div>

              {/* Optimistic Controls */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                <div>
                  <label
                    htmlFor="detail-category"
                    className="block text-xs font-medium text-slate-600 mb-1"
                  >
                    Category
                  </label>
                  <select
                    id="detail-category"
                    disabled={savingField}
                    value={selectedTicket.category}
                    onChange={(e) =>
                      handleOptimisticPatch(selectedTicket, {
                        category: e.target.value as TicketCategory,
                      })
                    }
                    className="w-full px-2.5 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-blue-600"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="detail-priority"
                    className="block text-xs font-medium text-slate-600 mb-1"
                  >
                    Priority
                  </label>
                  <select
                    id="detail-priority"
                    disabled={savingField}
                    value={selectedTicket.priority}
                    onChange={(e) =>
                      handleOptimisticPatch(selectedTicket, {
                        priority: e.target.value as TicketPriority,
                      })
                    }
                    className="w-full px-2.5 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-blue-600"
                  >
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="detail-status"
                    className="block text-xs font-medium text-slate-600 mb-1"
                  >
                    Status
                  </label>
                  <select
                    id="detail-status"
                    disabled={savingField}
                    value={selectedTicket.status}
                    onChange={(e) =>
                      handleOptimisticPatch(selectedTicket, {
                        status: e.target.value as TicketStatus,
                      })
                    }
                    className="w-full px-2.5 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-blue-600"
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Audit Trail */}
              <div className="pt-4 border-t border-slate-200">
                <h3 className="text-xs font-semibold text-slate-700 mb-3">
                  Audit History
                </h3>
                {loadingEvents ? (
                  <p className="text-xs text-slate-500">Loading events...</p>
                ) : events.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    No audit events recorded yet.
                  </p>
                ) : (
                  <div className="space-y-2.5 max-h-60 overflow-y-auto">
                    {events.map((ev) => (
                      <div
                        key={ev.id}
                        className="text-xs border border-slate-200 rounded-lg p-2.5 bg-slate-50/70"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-1 text-slate-500">
                          <span className="font-mono font-medium text-slate-800">
                            {ev.field}
                          </span>
                          <span className="tabular-nums">
                            {formatLocalDateTime(ev.createdAt)}
                          </span>
                        </div>
                        <div className="mt-1 text-slate-700 break-words">
                          {ev.oldValue ? `${ev.oldValue} -> ` : ''}
                          <span className="font-medium text-slate-900">
                            {ev.newValue}
                          </span>
                        </div>
                        <div className="mt-0.5 text-slate-500">
                          by {ev.actorEmail}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Import Modal */}
      {importOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Import Tickets"
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
        >
          <div className="w-full max-w-lg bg-white border border-slate-200 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-lg font-semibold text-slate-900">
                Import Tickets (Idempotent)
              </h2>
              <button
                type="button"
                onClick={() => setImportOpen(false)}
                className="text-slate-500 hover:text-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-slate-600 mb-3">
              Paste a ticket object or array. Existing{' '}
              <span className="font-mono">externalId</span> records update
              without overwriting human-overridden categories.
            </p>

            {importError && (
              <div className="mb-3 p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{importError}</span>
              </div>
            )}

            <form onSubmit={handleImportSubmit} className="space-y-4">
              <textarea
                rows={9}
                value={importJson}
                onChange={(e) => setImportJson(e.target.value)}
                className="w-full p-3 font-mono text-xs bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-blue-600"
              />
              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setImportOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg whitespace-nowrap"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={importing}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg disabled:opacity-50 whitespace-nowrap"
                >
                  {importing ? 'Importing...' : 'Run Import'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

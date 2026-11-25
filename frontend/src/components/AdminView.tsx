import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Plus } from 'lucide-react';
import { api, ApiClientError } from '../lib/api';
import { formatLocalTimeRange } from '../lib/format';
import type { AdminStats, Booking, Resource, ResourceType } from '../types';

export function AdminView() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [pendingBookings, setPendingBookings] = useState<Booking[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyBookingId, setBusyBookingId] = useState<number | null>(null);

  // Create resource form
  const [name, setName] = useState('');
  const [type, setType] = useState<ResourceType>('ROOM');
  const [location, setLocation] = useState('');
  const [capacity, setCapacity] = useState(4);
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, b, r] = await Promise.all([
        api.getAdminStats(),
        api.getBookings({ status: 'PENDING' }),
        api.getResources(),
      ]);
      setStats(s);
      setPendingBookings(b.bookings);
      setResources(r.resources);
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : 'Failed to load admin console.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  async function handleApprove(id: number) {
    setBusyBookingId(id);
    setError(null);
    try {
      await api.approveBooking(id);
      await loadAll();
    } catch (err) {
      setError(
        err instanceof ApiClientError ? err.message : 'Approval failed.'
      );
    } finally {
      setBusyBookingId(null);
    }
  }

  async function handleReject(id: number) {
    setBusyBookingId(id);
    setError(null);
    try {
      await api.rejectBooking(id);
      await loadAll();
    } catch (err) {
      setError(
        err instanceof ApiClientError ? err.message : 'Rejection failed.'
      );
    } finally {
      setBusyBookingId(null);
    }
  }

  async function handleToggleActive(resource: Resource) {
    setError(null);
    try {
      await api.updateResource(resource.id, { isActive: !resource.isActive });
      await loadAll();
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : 'Failed to update resource.'
      );
    }
  }

  async function handleCreateResource(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      await api.createResource({
        name,
        type,
        location,
        capacity,
        description,
        isActive: true,
      });
      setName('');
      setLocation('');
      setCapacity(4);
      setDescription('');
      await loadAll();
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : 'Failed to create resource.'
      );
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
          Admin Operations
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Booking approvals, resource activation controls, and fleet capacity
          overview.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-900 flex items-start gap-2"
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-700" />
          <span>{error}</span>
        </div>
      )}

      {/* Admin Stats Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 bg-white border border-slate-200 rounded-xl divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
        <div className="p-4 sm:p-5">
          <div className="text-xs font-medium text-slate-500">Total Users</div>
          <div className="mt-1 text-2xl font-semibold text-slate-900 font-mono tabular-nums">
            {stats ? stats.totalUsers : '—'}
          </div>
        </div>
        <div className="p-4 sm:p-5">
          <div className="text-xs font-medium text-slate-500">
            Active Resources
          </div>
          <div className="mt-1 text-2xl font-semibold text-slate-900 font-mono tabular-nums">
            {stats
              ? `${stats.activeResources}/${stats.totalResources}`
              : '—'}
          </div>
        </div>
        <div className="p-4 sm:p-5">
          <div className="text-xs font-medium text-slate-500">
            Pending Approvals
          </div>
          <div className="mt-1 text-2xl font-semibold text-amber-700 font-mono tabular-nums">
            {stats ? stats.pendingBookings : '—'}
          </div>
        </div>
        <div className="p-4 sm:p-5">
          <div className="text-xs font-medium text-slate-500">
            Approved Bookings
          </div>
          <div className="mt-1 text-2xl font-semibold text-emerald-700 font-mono tabular-nums">
            {stats ? stats.approvedBookings : '—'}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Pending Bookings Queue */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200">
            <h2 className="text-sm font-semibold text-slate-900">
              Pending Booking Requests ({pendingBookings.length})
            </h2>
          </div>

          {loading ? (
            <div className="p-5 text-sm text-slate-500">Loading...</div>
          ) : pendingBookings.length === 0 ? (
            <div className="p-6 text-sm text-slate-500">
              All booking requests have been reviewed.
            </div>
          ) : (
            <div className="divide-y divide-slate-200">
              {pendingBookings.map((b) => (
                <div
                  key={b.id}
                  className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                >
                  <div className="space-y-1">
                    <div className="text-xs text-slate-500">
                      <span className="font-mono font-medium text-slate-800">
                        #{b.id}
                      </span>{' '}
                      · {b.resourceName} · {b.userEmail}
                    </div>
                    <div className="text-sm font-medium text-slate-900">
                      {b.title}
                    </div>
                    <div className="text-xs text-slate-600 tabular-nums">
                      {formatLocalTimeRange(b.startTime, b.endTime)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={busyBookingId === b.id}
                      onClick={() => handleApprove(b.id)}
                      className="px-3 py-1.5 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg disabled:opacity-50 whitespace-nowrap"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      disabled={busyBookingId === b.id}
                      onClick={() => handleReject(b.id)}
                      className="px-3 py-1.5 text-xs font-medium text-red-700 bg-white border border-red-200 hover:bg-red-50 rounded-lg disabled:opacity-50 whitespace-nowrap"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Resource Management */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-slate-900 mb-3">
              Add Resource
            </h2>
            <form onSubmit={handleCreateResource} className="space-y-3">
              <input
                type="text"
                required
                minLength={2}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Resource name"
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-blue-600"
              />
              <div className="grid grid-cols-2 gap-3">
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as ResourceType)}
                  className="px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-blue-600"
                >
                  <option value="ROOM">ROOM</option>
                  <option value="LAB">LAB</option>
                  <option value="EQUIPMENT">EQUIPMENT</option>
                </select>
                <input
                  type="number"
                  min={1}
                  required
                  value={capacity}
                  onChange={(e) => setCapacity(Number(e.target.value))}
                  placeholder="Capacity"
                  className="px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-blue-600"
                />
              </div>
              <input
                type="text"
                required
                minLength={2}
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Building / Floor / Room"
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-blue-600"
              />
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Description"
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-blue-600"
              />
              <button
                type="submit"
                disabled={creating}
                className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg disabled:opacity-50 whitespace-nowrap"
              >
                <Plus className="w-4 h-4" />
                <span>{creating ? 'Creating...' : 'Create Resource'}</span>
              </button>
            </form>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200">
              <h2 className="text-sm font-semibold text-slate-900">
                Resource Status Controls
              </h2>
            </div>
            <div className="divide-y divide-slate-200">
              {resources.map((r) => (
                <div
                  key={r.id}
                  className="px-4 py-3 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-900 truncate">
                      {r.name}
                    </div>
                    <div className="text-xs text-slate-500">
                      {r.type} · {r.location}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleToggleActive(r)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg border whitespace-nowrap shrink-0 ${
                      r.isActive
                        ? 'text-emerald-700 border-emerald-200 bg-emerald-50 hover:bg-emerald-100'
                        : 'text-slate-700 border-slate-300 bg-slate-50 hover:bg-slate-100'
                    }`}
                  >
                    {r.isActive ? 'Active (Deactivate)' : 'Inactive (Activate)'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

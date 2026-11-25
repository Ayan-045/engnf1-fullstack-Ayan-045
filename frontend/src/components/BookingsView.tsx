import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { api, ApiClientError } from '../lib/api';
import {
  formatLocalTimeRange,
  formatUtcTimeOnly,
  getDurationMinutes,
} from '../lib/format';
import type { Booking, BookingStatus } from '../types';

function getBookingStatusClass(status: BookingStatus): string {
  switch (status) {
    case 'APPROVED':
      return 'text-emerald-700 font-semibold';
    case 'PENDING':
      return 'text-amber-700 font-semibold';
    case 'REJECTED':
      return 'text-red-700 font-semibold';
    case 'CANCELLED':
      return 'text-slate-500 font-medium';
  }
}

export function BookingsView({ refreshKey }: { refreshKey: number }) {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const loadBookings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getBookings({
        status: statusFilter || undefined,
        mine: true,
      });
      setBookings(res.bookings);
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : 'Failed to load bookings.'
      );
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    loadBookings();
  }, [loadBookings, refreshKey]);

  async function handleCancel(id: number) {
    setBusyId(id);
    setError(null);
    try {
      const res = await api.cancelBooking(id);
      setBookings((prev) =>
        prev.map((b) =>
          b.id === id ? { ...b, status: res.booking.status } : b
        )
      );
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : 'Could not cancel booking.'
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
            My Bookings
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Active and historical slot reservations displayed in your local
            timezone.
          </p>
        </div>

        <select
          aria-label="Filter bookings by status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-800 self-start focus:outline-none focus:border-blue-600"
        >
          <option value="">All Statuses</option>
          <option value="PENDING">PENDING</option>
          <option value="APPROVED">APPROVED</option>
          <option value="REJECTED">REJECTED</option>
          <option value="CANCELLED">CANCELLED</option>
        </select>
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

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-6 text-sm text-slate-500">Loading bookings...</div>
        ) : bookings.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-600">
            No bookings found. Visit Resources to reserve a 30-minute UTC slot.
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {bookings.map((b) => (
              <div
                key={b.id}
                className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="font-mono font-medium text-slate-800">
                      #{b.id}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{b.resourceName || `Resource #${b.resourceId}`}</span>
                    <span aria-hidden="true">·</span>
                    <span>{b.resourceType || 'RESOURCE'}</span>
                    <span aria-hidden="true">·</span>
                    <span className={getBookingStatusClass(b.status)}>
                      {b.status}
                    </span>
                  </div>

                  <h2 className="font-display text-base font-semibold text-slate-900">
                    {b.title}
                  </h2>

                  <div className="text-xs text-slate-600 tabular-nums">
                    {formatLocalTimeRange(b.startTime, b.endTime)} ·{' '}
                    <span className="font-mono text-slate-500">
                      {formatUtcTimeOnly(b.startTime)}–
                      {formatUtcTimeOnly(b.endTime)}
                    </span>{' '}
                    · {getDurationMinutes(b.startTime, b.endTime)} min
                  </div>
                </div>

                {(b.status === 'PENDING' || b.status === 'APPROVED') && (
                  <button
                    type="button"
                    disabled={busyId === b.id}
                    onClick={() => handleCancel(b.id)}
                    className="px-3.5 py-2 text-xs font-medium text-red-700 bg-white border border-red-200 hover:bg-red-50 rounded-lg transition-colors self-start sm:self-center disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    {busyId === b.id ? 'Cancelling...' : 'Cancel Booking'}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

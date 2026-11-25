import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CalendarClock, CheckCircle2 } from 'lucide-react';
import { api, ApiClientError } from '../lib/api';
import {
  formatLocalTimeRange,
  formatUtcTimeOnly,
} from '../lib/format';
import type { AvailabilitySlot, Resource, ResourceType } from '../types';

function getTodayUtcDate(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate() + 1).padStart(2, '0'); // Default tomorrow UTC for future slot convenience
  const tomorrow = new Date(Date.UTC(y, now.getUTCMonth(), now.getUTCDate() + 1));
  return tomorrow.toISOString().slice(0, 10);
}

function buildUtcGridOptions(dateStr: string) {
  const options: Array<{ utcIso: string; label: string }> = [];
  for (let hour = 0; hour < 24; hour += 1) {
    for (const min of [0, 30]) {
      const hh = String(hour).padStart(2, '0');
      const mm = String(min).padStart(2, '0');
      const iso = `${dateStr}T${hh}:${mm}:00.000Z`;
      const localDate = new Date(iso);
      const localLabel = new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      }).format(localDate);
      options.push({
        utcIso: iso,
        label: `${localLabel} local (${hh}:${mm} UTC)`,
      });
    }
  }
  return options;
}

export function ResourcesView({
  onBookingCreated,
}: {
  onBookingCreated: () => void;
}) {
  const [resources, setResources] = useState<Resource[]>([]);
  const [typeFilter, setTypeFilter] = useState<ResourceType | ''>('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const [selectedDate, setSelectedDate] = useState(getTodayUtcDate);
  const [slots, setSlots] = useState<AvailabilitySlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);

  // Booking form
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [startTimeIso, setStartTimeIso] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const gridOptions = useMemo(
    () => buildUtcGridOptions(selectedDate),
    [selectedDate]
  );

  useEffect(() => {
    if (gridOptions.length > 0) {
      // Pick 10:00 UTC by default if available
      const defaultOpt =
        gridOptions.find((o) => o.utcIso.includes('T10:00:00')) ??
        gridOptions[0];
      setStartTimeIso(defaultOpt.utcIso);
    }
  }, [gridOptions]);

  const loadResources = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getResources({ type: typeFilter });
      setResources(res.resources);
      setSelectedId((prev) => {
        if (prev && res.resources.some((r) => r.id === prev)) return prev;
        return res.resources.find((r) => r.isActive)?.id ?? res.resources[0]?.id ?? null;
      });
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : 'Failed to load resources.'
      );
    } finally {
      setLoading(false);
    }
  }, [typeFilter]);

  useEffect(() => {
    loadResources();
  }, [loadResources]);

  const loadAvailability = useCallback(async () => {
    if (!selectedId) return;
    setLoadingSlots(true);
    try {
      const res = await api.getResourceAvailability(selectedId, selectedDate);
      setSlots(res.bookings);
    } catch {
      setSlots([]);
    } finally {
      setLoadingSlots(false);
    }
  }, [selectedId, selectedDate]);

  useEffect(() => {
    loadAvailability();
  }, [loadAvailability]);

  const selectedResource = resources.find((r) => r.id === selectedId) ?? null;

  async function handleBook(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedResource) return;
    setError(null);
    setSuccessMsg(null);
    setSubmitting(true);
    try {
      const res = await api.createBooking({
        resourceId: selectedResource.id,
        title,
        notes,
        startTime: startTimeIso,
        durationMinutes,
      });
      setTitle('');
      setNotes('');
      setSuccessMsg(
        `Booking #${res.booking.id} submitted (${res.booking.status}) for ${selectedResource.name}.`
      );
      await loadAvailability();
      onBookingCreated();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError('Unable to create booking.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
            Resources & Slot Booking
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Reserve rooms, labs, and equipment on the 30-minute UTC grid (30–240
            min, max 3 active future bookings).
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start">
          {(['', 'ROOM', 'LAB', 'EQUIPMENT'] as const).map((t) => (
            <button
              key={t || 'ALL'}
              type="button"
              onClick={() => setTypeFilter(t)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                typeFilter === t
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {t || 'All'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Resource Directory */}
        <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {loading ? (
            [1, 2, 3, 4].map((n) => (
              <div
                key={n}
                className="h-36 bg-white border border-slate-200 rounded-xl p-5 animate-pulse"
              />
            ))
          ) : (
            resources.map((r) => {
              const isSelected = r.id === selectedId;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(r.id);
                    setError(null);
                    setSuccessMsg(null);
                  }}
                  className={`text-left bg-white border rounded-xl p-5 transition-colors ${
                    isSelected
                      ? 'border-blue-600 bg-blue-50/40'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                    <span className="font-mono font-medium text-slate-700">
                      {r.type}
                    </span>
                    <span
                      className={
                        r.isActive
                          ? 'text-emerald-700 font-medium'
                          : 'text-red-700 font-medium'
                      }
                    >
                      {r.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <h2 className="mt-2 font-display text-base font-semibold text-slate-900">
                    {r.name}
                  </h2>
                  <p className="mt-1 text-xs text-slate-600 line-clamp-2">
                    {r.description || 'Shared operations resource.'}
                  </p>
                  <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 tabular-nums">
                    <span>{r.location}</span>
                    <span>Cap: {r.capacity}</span>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Availability & Booking Form */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-5">
          {!selectedResource ? (
            <p className="text-sm text-slate-500">
              Select a resource to inspect availability and book a slot.
            </p>
          ) : (
            <>
              <div>
                <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                  <span>{selectedResource.type}</span>
                  <span
                    className={
                      selectedResource.isActive
                        ? 'text-emerald-700 font-medium'
                        : 'text-red-700 font-medium'
                    }
                  >
                    {selectedResource.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <h2 className="mt-1 font-display text-lg font-semibold text-slate-900">
                  {selectedResource.name}
                </h2>
                <p className="text-xs text-slate-500">
                  {selectedResource.location} · Capacity{' '}
                  {selectedResource.capacity}
                </p>
              </div>

              <div>
                <label
                  htmlFor="avail-date"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  UTC Schedule Date
                </label>
                <input
                  id="avail-date"
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-blue-600"
                />
              </div>

              <div>
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 mb-2">
                  <CalendarClock className="w-3.5 h-3.5 text-slate-500" />
                  <span>Reserved Windows ({selectedDate} UTC)</span>
                </div>
                {loadingSlots ? (
                  <p className="text-xs text-slate-500">Checking slots...</p>
                ) : slots.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    No active bookings on this UTC date. All 30-min slots open.
                  </p>
                ) : (
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {slots.map((s) => (
                      <div
                        key={s.id}
                        className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-slate-900">
                            {s.title}
                          </span>
                          <span
                            className={
                              s.status === 'APPROVED'
                                ? 'text-emerald-700 font-medium'
                                : 'text-amber-700 font-medium'
                            }
                          >
                            {s.status}
                          </span>
                        </div>
                        <div className="mt-1 text-slate-600 tabular-nums">
                          {formatLocalTimeRange(s.startTime, s.endTime)} ·{' '}
                          <span className="font-mono text-slate-500">
                            {formatUtcTimeOnly(s.startTime)}–
                            {formatUtcTimeOnly(s.endTime)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
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

              {successMsg && (
                <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-700" />
                  <span>{successMsg}</span>
                </div>
              )}

              <form
                onSubmit={handleBook}
                className="space-y-3.5 pt-3 border-t border-slate-200"
              >
                <div>
                  <label
                    htmlFor="booking-title"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Session Title
                  </label>
                  <input
                    id="booking-title"
                    type="text"
                    required
                    minLength={2}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Firmware bench validation"
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-blue-600"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="booking-start"
                      className="block text-xs font-medium text-slate-700 mb-1"
                    >
                      Start Slot (30m UTC Grid)
                    </label>
                    <select
                      id="booking-start"
                      value={startTimeIso}
                      onChange={(e) => setStartTimeIso(e.target.value)}
                      className="w-full px-2.5 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-blue-600"
                    >
                      {gridOptions.map((opt) => (
                        <option key={opt.utcIso} value={opt.utcIso}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="booking-duration"
                      className="block text-xs font-medium text-slate-700 mb-1"
                    >
                      Duration
                    </label>
                    <select
                      id="booking-duration"
                      value={durationMinutes}
                      onChange={(e) =>
                        setDurationMinutes(Number(e.target.value))
                      }
                      className="w-full px-2.5 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-blue-600"
                    >
                      {[30, 60, 90, 120, 150, 180, 210, 240].map((m) => (
                        <option key={m} value={m}>
                          {m} minutes
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="booking-notes"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Notes (optional)
                  </label>
                  <input
                    id="booking-notes"
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Equipment setup or attendee notes"
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-blue-600"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full px-4 py-2.5 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
                >
                  {submitting
                    ? 'Reserving Slot...'
                    : selectedResource.isActive
                      ? 'Reserve Slot'
                      : 'Attempt Reserve (Inactive)'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

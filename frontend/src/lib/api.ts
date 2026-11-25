import type {
  AdminStats,
  AvailabilitySlot,
  Booking,
  Resource,
  ResourceType,
  Ticket,
  TicketCategory,
  TicketEvent,
  TicketPriority,
  TicketStats,
  TicketStatus,
  User,
} from '../types';

export class ApiClientError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let inMemoryAuthToken: string | null = null;
let firebaseTokenProvider: (() => Promise<string | null>) | null = null;
let unauthorizedHandler: (() => void) | null = null;

export function setAuthToken(token: string | null) {
  inMemoryAuthToken = token;
}

export function setFirebaseTokenProvider(
  provider: (() => Promise<string | null>) | null
) {
  firebaseTokenProvider = provider;
}

export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler;
}

async function resolveToken(): Promise<string | null> {
  if (firebaseTokenProvider) {
    try {
      const fresh = await firebaseTokenProvider();
      if (fresh) {
        inMemoryAuthToken = fresh;
        return fresh;
      }
    } catch {
      // Fallback to cached token in memory
    }
  }
  return inMemoryAuthToken;
}

async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = await resolveToken();
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(path, {
    ...options,
    headers,
  });

  const text = await res.text();
  let json: unknown = {};
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = {};
    }
  }

  if (!res.ok) {
    const errObj = (json as { error?: { code?: string; message?: string } })
      ?.error;
    const isAuthCredentialEndpoint =
      path.startsWith('/api/auth/login') ||
      path.startsWith('/api/auth/register') ||
      path.startsWith('/api/auth/claim-admin');

    if (res.status === 401 && !isAuthCredentialEndpoint && unauthorizedHandler) {
      unauthorizedHandler();
    }

    throw new ApiClientError(
      res.status,
      errObj?.code || 'REQUEST_FAILED',
      errObj?.message || `Request failed with status ${res.status}`
    );
  }

  return json as T;
}

export const api = {
  getSetupStatus: () =>
    apiFetch<{ needsAdminSetup: boolean }>('/api/auth/setup-status'),

  claimAdmin: (payload: { email: string; name: string; password: string }) =>
    apiFetch<{ token: string; user: User }>('/api/auth/claim-admin', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  register: (payload: { email: string; name: string; password: string }) =>
    apiFetch<{ token: string; user: User }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  login: (payload: { email: string; password: string }) =>
    apiFetch<{ token: string; user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  exchangeFirebaseToken: (idToken: string) =>
    apiFetch<{ user: User }>('/api/auth/firebase', {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ idToken }),
    }),

  getMe: () => apiFetch<{ user: User }>('/api/auth/me'),

  logout: () =>
    apiFetch<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),

  getTickets: (params: {
    status?: string;
    category?: string;
    priority?: string;
    isReviewed?: string;
    q?: string;
    limit?: number;
    offset?: number;
  }) => {
    const sp = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== '') {
        sp.set(k, String(v));
      }
    });
    return apiFetch<{
      tickets: Ticket[];
      total: number;
      limit: number;
      offset: number;
    }>(`/api/tickets?${sp.toString()}`);
  },

  getTicketDetail: (id: number) =>
    apiFetch<{ ticket: Ticket; events: TicketEvent[] }>(`/api/tickets/${id}`),

  updateTicket: (
    id: number,
    payload: {
      category?: TicketCategory;
      priority?: TicketPriority;
      status?: TicketStatus;
    }
  ) =>
    apiFetch<{ ticket: Ticket; events: TicketEvent[] }>(`/api/tickets/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  importTickets: (
    tickets: Array<{
      externalId: string;
      subject: string;
      body: string;
      customerEmail: string;
    }>
  ) =>
    apiFetch<{
      created: number;
      updated: number;
      skipped: number;
      tickets: Ticket[];
    }>('/api/tickets/import', {
      method: 'POST',
      body: JSON.stringify({ tickets }),
    }),

  getStats: () => apiFetch<TicketStats>('/api/stats'),

  getResources: (params?: { type?: ResourceType | ''; activeOnly?: boolean }) => {
    const sp = new URLSearchParams();
    if (params?.type) sp.set('type', params.type);
    if (params?.activeOnly) sp.set('activeOnly', 'true');
    const qs = sp.toString();
    return apiFetch<{ resources: Resource[] }>(
      `/api/resources${qs ? `?${qs}` : ''}`
    );
  },

  getResourceAvailability: (id: number, date: string) =>
    apiFetch<{
      resource: Resource;
      windowStart: string;
      windowEnd: string;
      bookings: AvailabilitySlot[];
    }>(`/api/resources/${id}/availability?date=${encodeURIComponent(date)}`),

  createResource: (payload: {
    name: string;
    type: ResourceType;
    location: string;
    capacity: number;
    description: string;
    isActive: boolean;
  }) =>
    apiFetch<{ resource: Resource }>('/api/resources', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateResource: (
    id: number,
    payload: Partial<{
      name: string;
      type: ResourceType;
      location: string;
      capacity: number;
      description: string;
      isActive: boolean;
    }>
  ) =>
    apiFetch<{ resource: Resource }>(`/api/resources/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  getBookings: (params?: { status?: string; mine?: boolean }) => {
    const sp = new URLSearchParams();
    if (params?.status) sp.set('status', params.status);
    if (params?.mine) sp.set('mine', 'true');
    const qs = sp.toString();
    return apiFetch<{ bookings: Booking[] }>(
      `/api/bookings${qs ? `?${qs}` : ''}`
    );
  },

  createBooking: (payload: {
    resourceId: number;
    title: string;
    notes: string;
    startTime: string;
    durationMinutes: number;
  }) =>
    apiFetch<{ booking: Booking }>('/api/bookings', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  approveBooking: (id: number) =>
    apiFetch<{ booking: Booking }>(`/api/bookings/${id}/approve`, {
      method: 'POST',
    }),

  rejectBooking: (id: number) =>
    apiFetch<{ booking: Booking }>(`/api/bookings/${id}/reject`, {
      method: 'POST',
    }),

  cancelBooking: (id: number) =>
    apiFetch<{ booking: Booking }>(`/api/bookings/${id}/cancel`, {
      method: 'POST',
    }),

  getAdminStats: () => apiFetch<AdminStats>('/api/admin/stats'),
};

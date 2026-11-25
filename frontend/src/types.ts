export type UserRole = 'ADMIN' | 'USER';

export interface User {
  id: number;
  uid: string;
  email: string;
  name: string;
  role: UserRole;
}

export type TicketCategory =
  | 'DELIVERY'
  | 'BILLING'
  | 'TECHNICAL'
  | 'ACCOUNT'
  | 'GENERAL';

export type TicketPriority = 'URGENT' | 'HIGH' | 'MEDIUM' | 'LOW';
export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';

export interface Ticket {
  id: number;
  externalId: string;
  subject: string;
  body: string;
  customerEmail: string;
  autoCategory: TicketCategory;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  isHumanOverride: boolean;
  isReviewed: boolean;
  assignedToId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface TicketEvent {
  id: number;
  ticketId: number;
  actorId: number | null;
  actorEmail: string;
  field: string;
  oldValue: string | null;
  newValue: string;
  createdAt: string;
}

export interface TicketStats {
  totalTickets: number;
  openTickets: number;
  reviewedTickets: number;
  overrideCount: number;
  modelAgreementRate: number;
  byCategory: Record<string, number>;
  byPriority: Record<string, number>;
  byStatus: Record<string, number>;
}

export type ResourceType = 'ROOM' | 'LAB' | 'EQUIPMENT';

export interface Resource {
  id: number;
  name: string;
  type: ResourceType;
  location: string;
  capacity: number;
  description: string;
  isActive: boolean;
  createdAt: string;
}

export type BookingStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface Booking {
  id: number;
  resourceId: number;
  resourceName?: string;
  resourceType?: ResourceType;
  resourceLocation?: string;
  userId: number;
  userEmail?: string;
  userName?: string;
  title: string;
  notes: string;
  startTime: string;
  endTime: string;
  status: BookingStatus;
  reviewedById: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface AvailabilitySlot {
  id: number;
  title: string;
  startTime: string;
  endTime: string;
  status: BookingStatus;
}

export interface AdminStats {
  totalUsers: number;
  totalResources: number;
  activeResources: number;
  totalBookings: number;
  pendingBookings: number;
  approvedBookings: number;
  rejectedBookings: number;
  cancelledBookings: number;
  bookingsByResourceType: Record<string, number>;
  ticketStats: TicketStats;
}

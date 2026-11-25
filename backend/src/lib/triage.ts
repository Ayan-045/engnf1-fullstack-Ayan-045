export const TICKET_CATEGORIES = [
  'DELIVERY',
  'BILLING',
  'TECHNICAL',
  'ACCOUNT',
  'GENERAL',
] as const;

export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

export const TICKET_PRIORITIES = ['URGENT', 'HIGH', 'MEDIUM', 'LOW'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const TICKET_STATUSES = [
  'OPEN',
  'IN_PROGRESS',
  'RESOLVED',
  'CLOSED',
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export interface TriageClassification {
  autoCategory: TicketCategory;
  priority: TicketPriority;
}

const DELIVERY_KEYWORDS = [
  'package',
  'not arrived',
  'shipment',
  'shipping',
  'delivery',
  'delivered',
  'tracking',
  'courier',
  'lost in transit',
  'missing item',
  'parcel',
  'warehouse',
  'delayed order',
];

const BILLING_KEYWORDS = [
  'refund',
  'chargeback',
  'double charged',
  'overcharged',
  'invoice',
  'billing',
  'payment',
  'credit card',
  'charged twice',
  'subscription fee',
  'receipt',
];

const TECHNICAL_KEYWORDS = [
  'bug',
  'crash',
  'error 500',
  '500 error',
  'api',
  'timeout',
  'latency',
  'outage',
  'exception',
  'stack trace',
  'broken',
  'webhook',
  'ssl',
  'database',
];

const ACCOUNT_KEYWORDS = [
  'password',
  'login',
  '2fa',
  'mfa',
  'locked out',
  'sso',
  'permission',
  'access denied',
  'account',
  'role',
  'reset link',
];

const URGENT_KEYWORDS = [
  'outage',
  'production down',
  'data loss',
  'security breach',
  'unauthorized',
  'p0',
  'critical',
  'urgent',
  'emergency',
  'down since',
];

const HIGH_KEYWORDS = [
  'not arrived',
  'never arrived',
  'missing',
  'refund',
  'chargeback',
  'double charged',
  'overcharged',
  'locked out',
  'crash',
  'error 500',
  '500 error',
  'broken',
  'deadline',
  'failed',
];

const LOW_KEYWORDS = [
  'question',
  'curious',
  'feedback',
  'suggestion',
  'feature request',
  'how do i',
  'thank you',
  'minor',
];

function countMatches(text: string, keywords: string[]): number {
  let score = 0;
  for (const kw of keywords) {
    if (text.includes(kw)) {
      score += 1;
    }
  }
  return score;
}

export function classifyTicketDeterministic(
  subject: string,
  body: string
): TriageClassification {
  const combined = `${subject} ${body}`.toLowerCase();

  const scores: Array<{ category: TicketCategory; score: number }> = [
    { category: 'DELIVERY', score: countMatches(combined, DELIVERY_KEYWORDS) },
    { category: 'BILLING', score: countMatches(combined, BILLING_KEYWORDS) },
    { category: 'TECHNICAL', score: countMatches(combined, TECHNICAL_KEYWORDS) },
    { category: 'ACCOUNT', score: countMatches(combined, ACCOUNT_KEYWORDS) },
  ];

  scores.sort((a, b) => b.score - a.score);
  const autoCategory: TicketCategory =
    scores[0].score > 0 ? scores[0].category : 'GENERAL';

  let priority: TicketPriority = 'MEDIUM';
  if (countMatches(combined, URGENT_KEYWORDS) > 0) {
    priority = 'URGENT';
  } else if (
    countMatches(combined, HIGH_KEYWORDS) > 0 ||
    autoCategory === 'DELIVERY' ||
    autoCategory === 'BILLING'
  ) {
    // Delivery/billing issues like "My package has not arrived" or refund inquiries default to HIGH unless explicitly low-impact
    if (
      countMatches(combined, HIGH_KEYWORDS) > 0 ||
      combined.includes('package') ||
      combined.includes('refund') ||
      combined.includes('charged')
    ) {
      priority = 'HIGH';
    } else if (countMatches(combined, LOW_KEYWORDS) > 0) {
      priority = 'LOW';
    }
  } else if (countMatches(combined, LOW_KEYWORDS) > 0) {
    priority = 'LOW';
  }

  return { autoCategory, priority };
}

// ─────────────────────────────────────────────────────────────────────────────
// The wire contract between 212 Residential Services and the 212 Hub.
//
// WHY THIS PACKAGE EXISTS. The two systems are separate repos, separate Vercel
// projects and separate Firebase projects, and they talk over HTTP and nothing
// else. That separation is right. What it lacked was any way for the two ends
// to disagree loudly: 212RS declared the request and response shapes in
// src/lib/hub/*, the hub declared them again in each route handler, and nothing
// made them agree. Rename a field on one side and it breaks in production, at
// runtime, in front of a customer — not at build time, in front of a developer.
//
// So the shapes live here, once, and both repos import them. A rename is now a
// compile error on whichever side has not caught up.
//
// RULES FOR CHANGING THIS FILE.
//
//   1. ADD, do not rewrite. A deploy of one side always lands before the other,
//      so every change must be readable by BOTH the old and the new code for at
//      least one deploy. New fields are optional. Removing a field is a two-step
//      job across two releases: stop writing it, ship both sides, then remove.
//
//   2. It describes what is ON THE WIRE, not what either side wishes were on
//      it. If the hub returns a field, it belongs here even if it is ugly.
//
//   3. No runtime dependencies, ever. This is types and route constants. It is
//      installed into two apps and must never drag anything with it.
// ─────────────────────────────────────────────────────────────────────────────

/** The contract's own version, so a mismatch is diagnosable from a log line
 *  rather than from guessing which side is stale. */
export const CONTRACT_VERSION = '1.0.0';

/**
 * Every endpoint the hub exposes to 212RS.
 *
 * Named constants rather than string literals scattered through both codebases:
 * a typo in a path is otherwise a 404 discovered in production, and a rename is
 * otherwise a grep across two repos.
 */
export const RS_ENDPOINTS = {
  complianceCheck: '/api/integrations/rs/compliance/check',
  partiesMatchOrCreate: '/api/integrations/rs/parties/match-or-create',
  leads: '/api/integrations/rs/leads',
  timeEntries: '/api/integrations/rs/time-entries',
  quickbooksInvoice: '/api/integrations/rs/quickbooks/invoice',
  warrantyRollup: '/api/integrations/rs/warranty-rollup',
} as const;

export type RsEndpoint = typeof RS_ENDPOINTS[keyof typeof RS_ENDPOINTS];

/** Every failure the hub returns shares this shape. `code` is machine-readable
 *  and is what a caller should branch on; `error` is for a human reading a log. */
export interface HubErrorBody {
  error: string;
  code: string;
}

// ── Compliance ───────────────────────────────────────────────────────────────
// The blocking one. 212RS will not dispatch a trade partner until the hub
// confirms their licence and insurance, and a failure to reach the hub is
// treated as "no" rather than "probably fine" — see the client's fail-closed
// note. Do not add a field here that would let a caller skip that.

export interface ComplianceRequest {
  companyId: string;
  contactId?: string;
  /** So the hub can check the COI names the right certificate holder. */
  propertyId?: string;
  certHolder?: string;
}

export interface ComplianceVerdict {
  /** The only field a caller should gate dispatch on. It is licenceOk && coiOnFile
   *  today, but that is the hub's business and may become stricter. */
  allowed: boolean;
  licenceOk: boolean;
  coiOnFile: boolean;
  coiExpiresAt?: string;
  /** Present whenever `allowed` is false. Shown to the office, not the client. */
  blockedReason?: string;
  checkedAt: string;
}

// ── Parties ──────────────────────────────────────────────────────────────────
// The hub is the party master: it owns who a client is. 212RS cannot create an
// account without a hubContactId.

export interface PartyInput {
  name: string;
  /** E.164. The strongest signal available, because the caller proved they hold
   *  the number by answering an OTP on it. */
  phone: string;
  email?: string;
  addressLine1?: string;
  addressCity?: string;
  addressState?: string;
  addressZip?: string;
  addressUnit?: string;
}

export type MatchBasis = 'phone' | 'email' | 'none';

export interface PartyResolved {
  hubContactId: string;
  hubCompanyId?: string;
  /** True when an existing hub record was reused rather than one created. */
  matched: boolean;
  matchedOn: MatchBasis;
  /** The hub echoes the matched contact's name back on a match. Informational. */
  name?: string;
  /** Set when a NEW record was created but existing records share the address.
   *  Two people share an address all the time — a new owner, a roommate, the
   *  previous tenant — so the hub flags rather than binds. */
  possibleDuplicateOf?: string[];
}

/**
 * More than one contact matched and the hub refuses to guess.
 *
 * This is a SUCCESS response (HTTP 200) carrying a different shape, which is
 * why the endpoint's result is a union. 212RS previously widened its own type
 * inline to cope — `PartyResult & { ambiguous?: boolean }` — which is exactly
 * the kind of local patch this package exists to remove.
 */
export interface PartyAmbiguous {
  ambiguous: true;
  candidates: string[];
}

export type PartyResult = PartyResolved | PartyAmbiguous;

/** Narrow the union. Prefer this to checking `'ambiguous' in result` by hand. */
export const isPartyAmbiguous = (r: PartyResult): r is PartyAmbiguous =>
  (r as PartyAmbiguous).ambiguous === true;

// ── Leads ────────────────────────────────────────────────────────────────────
// Work 212RS found that belongs to the renovation business.

export interface LeadInput {
  hubContactId: string;
  title: string;
  address?: string;
  notes?: string;
  /** The originating 212RS request. The hub dedupes on it, so re-sending the
   *  same lead is safe and returns `existing: true`. */
  rsRequestId: string;
  photos?: string[];
}

export interface LeadResult {
  ok: boolean;
  leadId: string;
  /** True when this lead was already recorded and nothing new was written. */
  existing?: boolean;
}

// ── Time entries ─────────────────────────────────────────────────────────────
// Crew hours worked on 212RS jobs, pushed into the hub's time clock.

export interface TimeEntryInput {
  workerId: string;
  workerName?: string;
  clockInAt: string;
  clockOutAt: string;
  /** The 212RS visit. The hub dedupes on it. */
  rsVisitId: string;
  rsRequestId?: string;
  address?: string;
}

export interface TimeEntryResult {
  ok: boolean;
  timeEntryId: string;
  existing?: boolean;
}

// ── QuickBooks ───────────────────────────────────────────────────────────────
// 212RS does not hold QuickBooks credentials. The hub owns that connection and
// pushes on its behalf, which is why this is a seam rather than a library.

export interface QboInvoiceInput {
  customer: { displayName: string; email?: string; phone?: string };
  docNumber: string;
  lines: { description: string; amountCents: number }[];
  txnDate?: string;
  dueDate?: string;
  memo?: string;
}

export interface QboInvoiceResult {
  ok: boolean;
  qboCustomerId?: string;
  qboInvoiceId?: string;
}

// ── Warranty rollup ──────────────────────────────────────────────────────────
// 212RS reports back which renovation projects have generated callbacks, so the
// hub can see which jobs are still costing money after handover.

export interface WarrantyRollupProject {
  hubProjectId: string;
  callbacks: number;
  lastCallbackAt?: string;
  openCallbacks?: number;
}

export interface WarrantyRollupInput {
  projects: WarrantyRollupProject[];
  generatedAt?: string;
}

export interface WarrantyRollupResult {
  ok: boolean;
  /** How many projects the hub matched and updated. */
  written: number;
  /** hubProjectIds it did not recognise. Worth logging: it usually means a
   *  project was deleted in the hub while 212RS still references it. */
  unknown: string[];
}

// ── The endpoint map ─────────────────────────────────────────────────────────
/**
 * Request and response type for each endpoint, so a caller can be generic over
 * the seam without restating the pairing:
 *
 *   function call<E extends RsEndpoint>(e: E, body: RsRequest<E>): Promise<RsResponse<E>>
 */
export interface RsContract {
  [RS_ENDPOINTS.complianceCheck]: { request: ComplianceRequest; response: ComplianceVerdict };
  [RS_ENDPOINTS.partiesMatchOrCreate]: { request: PartyInput; response: PartyResult };
  [RS_ENDPOINTS.leads]: { request: LeadInput; response: LeadResult };
  [RS_ENDPOINTS.timeEntries]: { request: TimeEntryInput; response: TimeEntryResult };
  [RS_ENDPOINTS.quickbooksInvoice]: { request: QboInvoiceInput; response: QboInvoiceResult };
  [RS_ENDPOINTS.warrantyRollup]: { request: WarrantyRollupInput; response: WarrantyRollupResult };
}

export type RsRequest<E extends RsEndpoint> = RsContract[E]['request'];
export type RsResponse<E extends RsEndpoint> = RsContract[E]['response'];

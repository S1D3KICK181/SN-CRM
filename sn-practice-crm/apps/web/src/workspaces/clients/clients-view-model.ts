import type { ClientDto, ClientEntityType, ClientStatus } from '@sn/contracts';

export type ClientStatusTone = 'default' | 'success' | 'warning' | 'muted';

export interface ClientListItemViewModel {
  readonly id: string;
  readonly code: string;
  readonly displayName: string;
  readonly legalName: string | null;
  readonly subtitle: string;
  readonly initials: string;
  readonly status: ClientStatus;
  readonly statusLabel: string;
  readonly statusTone: ClientStatusTone;
  readonly panMasked: string;
  readonly gstinMasked: string;
  readonly email: string;
  readonly phone: string;
  readonly relationshipOwnerName: string;
  readonly activeAssignmentsCount: number;
  readonly activeAssignmentsLabel: string;
  readonly createdAtLabel: string;
  readonly updatedAtLabel: string;
}

export interface ClientContactViewModel {
  readonly id: string;
  readonly name: string;
  readonly designation: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly whatsapp: string | null;
  readonly isPrimary: boolean;
}

export interface ClientDetailViewModel extends ClientListItemViewModel {
  readonly notesLabel: string;
  readonly entityTypeLabel: string;
  /** The full PAN when the reader looks after the client, otherwise the masked one. */
  readonly panLabel: string;
  readonly gstinLabel: string;
  readonly tanLabel: string;
  readonly cinLlpinLabel: string;
  readonly udyamLabel: string;
  readonly iecLabel: string;
  readonly incorporationDateLabel: string;
  /** Address lines, then `City, State PIN`; empty when no address is on file. */
  readonly addressLines: readonly string[];
  readonly contacts: readonly ClientContactViewModel[];
  readonly canEdit: boolean;
  readonly canChangeOwnerOrStatus: boolean;
}

export const CLIENT_ENTITY_TYPE_LABELS: Readonly<Record<ClientEntityType, string>> = {
  individual: 'Individual',
  huf: 'HUF',
  proprietorship: 'Proprietorship',
  partnership: 'Partnership firm',
  llp: 'LLP',
  private_limited: 'Private limited company',
  public_limited: 'Public limited company',
  trust: 'Trust',
  society: 'Society',
  other: 'Other',
};

export const NOT_ADDED_LABEL = 'Not added';

/** Formats a YYYY-MM-DD calendar date as DD/MM/YYYY without any timezone shift. */
export function formatCalendarDate(value: string | null): string {
  if (!value) return NOT_ADDED_LABEL;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : NOT_ADDED_LABEL;
}

function addressLinesOf(dto: ClientDto): string[] {
  const lines = [normalizeText(dto.addressLine1), normalizeText(dto.addressLine2)].filter(
    (line): line is string => line !== null,
  );
  const place = [normalizeText(dto.city), normalizeText(dto.state)]
    .filter((part): part is string => part !== null)
    .join(', ');
  const pincode = normalizeText(dto.pincode);
  const cityLine = [place, pincode].filter((part) => part && part.length > 0).join(' ');
  return cityLine ? [...lines, cityLine] : lines;
}

export interface ClientDirectoryStats {
  readonly accessibleClients: number;
  readonly activeClients: number;
  readonly activeAssignments: number;
  readonly relationshipManaged: number;
}

const kolkataDateFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

/**
 * Format ISO timestamp into Indian standard DD/MM/YYYY in Asia/Kolkata.
 * Returns 'Not available' if the date is invalid or empty.
 */
export function formatClientDate(isoString: string): string {
  if (!isoString) {
    return 'Not available';
  }
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return 'Not available';
  }
  return kolkataDateFormatter.format(date);
}

/**
 * Helper to normalize empty or whitespace-only text into null.
 */
function normalizeText(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Derive 1-2 character uppercase initials from client display name.
 */
export function getClientInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    return 'NA';
  }
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const first = parts[0]?.[0] ?? '';
    const second = parts[1]?.[0] ?? '';
    return (first + second).toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

/**
 * Maps client status to human-readable label and visual tone token.
 */
export function toClientStatusDetails(status: ClientStatus): {
  label: string;
  tone: ClientStatusTone;
} {
  switch (status) {
    case 'active':
      return { label: 'Active', tone: 'success' };
    case 'on_hold':
      return { label: 'On Hold', tone: 'warning' };
    case 'archived':
      return { label: 'Archived', tone: 'muted' };
    default:
      return { label: status, tone: 'default' };
  }
}

/**
 * Projects a raw ClientDto into a UI-safe list item view model.
 * Enforces truthful null fallbacks for both null and whitespace-only fields:
 * - Contact fields: 'Not provided'
 * - Relationship owner: 'Unassigned'
 * - Masked tax IDs: 'Not available'
 * Subtitle falls back to client code when legalName is absent or whitespace.
 */
export function toClientListItemViewModel(dto: ClientDto): ClientListItemViewModel {
  const statusDetails = toClientStatusDetails(dto.status);
  const legalName = normalizeText(dto.legalName);
  const subtitle = legalName ?? dto.code;

  return {
    id: dto.id,
    code: dto.code,
    displayName: dto.displayName.trim() || dto.code,
    legalName,
    subtitle,
    initials: getClientInitials(dto.displayName),
    status: dto.status,
    statusLabel: statusDetails.label,
    statusTone: statusDetails.tone,
    panMasked: normalizeText(dto.panMasked) ?? 'Not available',
    gstinMasked: normalizeText(dto.gstinMasked) ?? 'Not available',
    email: normalizeText(dto.email) ?? 'Not provided',
    phone: normalizeText(dto.phone) ?? 'Not provided',
    relationshipOwnerName: normalizeText(dto.relationshipOwnerName) ?? 'Unassigned',
    activeAssignmentsCount: dto.activeAssignmentsCount,
    activeAssignmentsLabel: `${dto.activeAssignmentsCount} active`,
    createdAtLabel: formatClientDate(dto.createdAt),
    updatedAtLabel: formatClientDate(dto.updatedAt),
  };
}

/**
 * Projects a raw ClientDto into a UI-safe detail view model for the drawer.
 * Strips all unneeded raw internal metadata.
 */
export function toClientDetailViewModel(dto: ClientDto): ClientDetailViewModel {
  const base = toClientListItemViewModel(dto);
  const notes = normalizeText(dto.notes);

  return {
    ...base,
    notesLabel: notes ?? 'Not provided',
    entityTypeLabel: dto.entityType ? CLIENT_ENTITY_TYPE_LABELS[dto.entityType] : NOT_ADDED_LABEL,
    panLabel: normalizeText(dto.pan) ?? normalizeText(dto.panMasked) ?? NOT_ADDED_LABEL,
    gstinLabel: normalizeText(dto.gstin) ?? normalizeText(dto.gstinMasked) ?? NOT_ADDED_LABEL,
    tanLabel: normalizeText(dto.tan) ?? NOT_ADDED_LABEL,
    cinLlpinLabel: normalizeText(dto.cinLlpin) ?? NOT_ADDED_LABEL,
    udyamLabel: normalizeText(dto.udyamNumber) ?? NOT_ADDED_LABEL,
    iecLabel: normalizeText(dto.iec) ?? NOT_ADDED_LABEL,
    incorporationDateLabel: formatCalendarDate(dto.incorporationDate),
    addressLines: addressLinesOf(dto),
    contacts: dto.contacts.map((contact) => ({
      id: contact.id,
      name: contact.name,
      designation: normalizeText(contact.designation),
      email: normalizeText(contact.email),
      phone: normalizeText(contact.phone),
      whatsapp: normalizeText(contact.whatsapp),
      isPrimary: contact.isPrimary,
    })),
    canEdit: dto.canEdit,
    canChangeOwnerOrStatus: dto.canChangeOwnerOrStatus,
  };
}

/**
 * Computes pure directory statistics from accessible client items.
 * All figures derived strictly from live data; never fabricated.
 * relationshipManaged counts only nonblank relationship owner names.
 */
export function computeClientDirectoryStats(
  items: readonly ClientDto[],
): ClientDirectoryStats {
  const accessibleClients = items.length;
  let activeClients = 0;
  let activeAssignments = 0;
  let relationshipManaged = 0;

  for (const client of items) {
    if (client.status === 'active') {
      activeClients += 1;
    }
    activeAssignments += client.activeAssignmentsCount;
    if (client.relationshipOwnerName && client.relationshipOwnerName.trim().length > 0) {
      relationshipManaged += 1;
    }
  }

  return {
    accessibleClients,
    activeClients,
    activeAssignments,
    relationshipManaged,
  };
}

/**
 * Pure search matcher for client records.
 * Matches case-insensitively against:
 * - displayName
 * - legalName
 * - code (CL-xxxxxx)
 * - relationshipOwnerName
 * - panMasked (masked PAN only)
 * - gstinMasked (masked GSTIN only)
 *
 * Never performs raw PAN/GSTIN lookups or touches arbitrary runtime keys.
 */
export function matchesClientSearch(client: ClientDto, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) {
    return true;
  }

  if (client.displayName.toLowerCase().includes(q)) {
    return true;
  }
  if (client.code.toLowerCase().includes(q)) {
    return true;
  }
  if (client.legalName && client.legalName.toLowerCase().includes(q)) {
    return true;
  }
  if (client.relationshipOwnerName && client.relationshipOwnerName.toLowerCase().includes(q)) {
    return true;
  }
  if (client.panMasked && client.panMasked.toLowerCase().includes(q)) {
    return true;
  }
  if (client.gstinMasked && client.gstinMasked.toLowerCase().includes(q)) {
    return true;
  }

  return false;
}

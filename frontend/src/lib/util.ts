import { notifications } from '@mantine/notifications';
import type { CampaignStatus, StaffRole } from '../api/types';

export function formatDateTime(value: string | null | undefined, timeZone?: string): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone, timeZoneName: timeZone ? 'short' : undefined,
  }).format(new Date(value));
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
}

export function humanize(value: string | null | undefined): string {
  if (!value) return '—';
  const text = value.replace(/[_.]/g, ' ').toLowerCase();
  return (text.charAt(0).toUpperCase() + text.slice(1)).replace(/\b(hsg|hvac|ghl)\b/gi, (word) => word.toUpperCase());
}

const FRIENDLY_ERRORS: Array<[RegExp, string]> = [
  [/editions_division_industry_publication_week_key/, 'This industry already has an edition for that week. Open the existing edition or pick another week.'],
  [/tenants_ghl_location_id_key/, 'Another tenant already uses this GHL location ID.'],
  [/content_items_content_id_version_key/, 'That story version already exists. Reload the page and try again.'],
  [/violates check constraint ".*color/, 'Colors must be hex values like #14344F.'],
  [/permission denied|role does not allow/i, 'Your role does not allow this action.'],
  [/Failed to fetch|NetworkError/i, 'Could not reach the server. Check your connection and try again.'],
];

export function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return FRIENDLY_ERRORS.find(([pattern]) => pattern.test(message))?.[1] ?? message;
}

export function showError(error: unknown) {
  notifications.show({ color: 'red', title: 'That did not work', message: friendlyError(error) });
}

export function showSuccess(message: string) {
  notifications.show({ color: 'green', message });
}

export const STATUS_COLORS: Record<CampaignStatus, string> = {
  NOT_ELIGIBLE: 'gray',
  READY_TO_RENDER: 'gray',
  RENDERED: 'gray',
  CENTRAL_APPROVED: 'blue',
  AUTO_QUEUED: 'blue',
  CLIENT_REVIEW_PENDING: 'yellow',
  APPROVED_FOR_SEND: 'teal',
  SCHEDULED: 'indigo',
  SENDING: 'indigo',
  SENT: 'green',
  REVISION_REQUESTED: 'orange',
  REJECTED: 'red',
  HELD: 'orange',
  FAILED: 'red',
  CANCELED: 'gray',
};

export const canOperate = (role: StaffRole | null | undefined) => role === 'admin' || role === 'operator';
export const canEdit = (role: StaffRole | null | undefined) => role === 'admin' || role === 'editor';

export function downloadCsv(filename: string, rows: Array<Record<string, unknown>>) {
  if (!rows.length) return;
  const columns = Object.keys(rows[0]);
  const cell = (value: unknown) => {
    const text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    // Prefix formula-like values so spreadsheets do not execute them.
    const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const csv = [columns.join(','), ...rows.map((row) => columns.map((column) => cell(row[column])).join(','))].join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

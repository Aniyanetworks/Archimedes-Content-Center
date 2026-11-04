import type { CampaignStatus } from '../api/types';
import { humanize } from '../lib/util';

const DOT: Record<CampaignStatus, string> = {
  NOT_ELIGIBLE: 'var(--mantine-color-gray-5)',
  READY_TO_RENDER: 'var(--mantine-color-gray-5)',
  RENDERED: 'var(--mantine-color-gray-5)',
  CENTRAL_APPROVED: 'var(--status-scheduled)',
  AUTO_QUEUED: 'var(--status-scheduled)',
  CLIENT_REVIEW_PENDING: 'var(--status-review)',
  APPROVED_FOR_SEND: 'var(--status-scheduled)',
  SCHEDULED: 'var(--status-scheduled)',
  SENDING: 'var(--status-scheduled)',
  SENT: 'var(--status-sent)',
  REVISION_REQUESTED: 'var(--status-held)',
  REJECTED: 'var(--status-failed)',
  HELD: 'var(--status-held)',
  FAILED: 'var(--status-failed)',
  CANCELED: 'var(--mantine-color-gray-5)',
};

export function StatusBadge({ status }: { status: CampaignStatus }) {
  return (
    <span className="status-pill">
      <span className="status-dot" style={{ background: DOT[status] }} />
      {humanize(status)}
    </span>
  );
}

// Plain-English names and explanations for campaign statuses and the reasons shown under them.
import type { CampaignStatus } from '../api/types';
import { humanize } from './util';

export const CAMPAIGN_STATUS_TEXT: Record<CampaignStatus, { label: string; hint: string }> = {
  NOT_ELIGIBLE: { label: 'Not eligible', hint: 'Something is missing for this sub-account, so no newsletter is made. The reason is shown underneath. Fix it, then use Re-render.' },
  READY_TO_RENDER: { label: 'Preparing email', hint: 'The email is being built with this sub-account\'s design and branding. This usually takes a few minutes.' },
  RENDERED: { label: 'Email ready', hint: 'The email is built and about to move on to approval or sending.' },
  CENTRAL_APPROVED: { label: 'Approved by Archimedes', hint: 'Approved by the Archimedes team and moving on to the next step.' },
  AUTO_QUEUED: { label: 'Queued', hint: 'Waiting to be scheduled. No approval is needed for this sub-account.' },
  CLIENT_REVIEW_PENDING: { label: 'Waiting for owner approval', hint: 'The sub-account owner has been asked to approve this newsletter. If they do not answer by the deadline, it is held and not sent.' },
  APPROVED_FOR_SEND: { label: 'Ready to send', hint: 'Approved. It will be scheduled in GoHighLevel shortly before the send time.' },
  SCHEDULED: { label: 'Scheduled', hint: 'Scheduled in GoHighLevel and will go out at the send time.' },
  SENDING: { label: 'Sending', hint: 'GoHighLevel is sending it now.' },
  SENT: { label: 'Sent', hint: 'Sent. About 30 minutes later the app checks whether it reached inboxes.' },
  REVISION_REQUESTED: { label: 'Changes requested', hint: 'The sub-account owner asked for changes. Make them, then use Re-render.' },
  REJECTED: { label: 'Rejected', hint: 'This newsletter was rejected and will not be sent as it is. Fix the problem, then use Re-render.' },
  HELD: { label: 'On hold', hint: 'Stopped for now and will not be sent until someone uses Release hold. The reason is shown underneath.' },
  FAILED: { label: 'Failed', hint: 'Something went wrong while sending. The reason is shown underneath. Use Retry if it is offered.' },
  CANCELED: { label: 'Cancelled', hint: 'Will not be sent. Either staff cancelled it, or the sub-account owner chose to skip this edition. The next edition is not affected.' },
};

const REASON_TEXT: Record<string, string> = {
  automatic: 'No approval needed',
  dry_run: 'Practice mode, not really sent',
  approval_revoked: 'Approval withdrawn',
  edition_changed: 'The edition was changed',
  entitlement_inactive: 'Plan is not active',
  ghl_rejected: 'GoHighLevel refused it',
  ghl_reported_failed: 'GoHighLevel reported a failure',
  missing_brand_profile: 'Newsletter title missing',
  no_current_template: 'Design not available',
  no_reviewer_configured: 'No reviewer email set',
  no_template_selected: 'No design chosen',
  not_opted_in: 'Not opted in to the newsletter',
  operator_release: 'Released by staff',
  operator_retry: 'Retried by staff',
  operator_hold: 'Held by staff',
  operator_cancel: 'Cancelled by staff',
  'paused:embargo': 'Waiting for the embargo date',
  'paused:switch': 'Paused',
  plan_not_eligible: 'Plan does not include this edition',
  reconciled: 'Confirmed with GoHighLevel',
  retries_exhausted: 'Gave up after several tries',
  review_deadline_missed: 'Owner did not approve in time',
  send_window_passed: 'Send time has passed',
  template_not_entitled: 'Design not included in plan',
};

// Reasons can be a list ("a,b") or carry a detail ("ghl_state_x"). Unknown ones are made readable.
export function reasonText(reason: string | null | undefined): string {
  if (!reason) return '';
  return reason.split(',').map((part) => {
    const key = part.trim();
    if (REASON_TEXT[key]) return REASON_TEXT[key];
    if (key.startsWith('ghl_state_')) return `GoHighLevel status: ${humanize(key.slice('ghl_state_'.length))}`;
    return humanize(key);
  }).join(', ');
}

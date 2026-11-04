import { Badge } from '@mantine/core';
import type { CampaignStatus } from '../api/types';
import { humanize, STATUS_COLORS } from '../lib/util';

export function StatusBadge({ status }: { status: CampaignStatus }) {
  return (
    <Badge color={STATUS_COLORS[status]} variant="light" style={{ whiteSpace: 'nowrap' }}>
      {humanize(status)}
    </Badge>
  );
}

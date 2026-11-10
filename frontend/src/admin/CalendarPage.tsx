import { useMemo, useState, type CSSProperties } from 'react';
import { ActionIcon, Alert, Button, Center, Group, Loader, Modal, Paper, Select, Stack, Text, Title, Tooltip, UnstyledButton } from '@mantine/core';
import { IconArrowLeft, IconChevronLeft, IconChevronRight, IconEye, IconUser } from '@tabler/icons-react';
import { EmailPreview } from '../components/EmailPreview';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import type { CampaignRow } from '../api/types';
import { PageHeader } from '../components/PageHeader';
import { STATUS_DOT, StatusBadge } from '../components/StatusBadge';
import { CAMPAIGN_STATUS_TEXT } from '../lib/statusText';
import { humanize } from '../lib/util';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SHOWN_PER_DAY = 3;

// A date key in the viewer's own time zone, so a newsletter sits on the day it goes out for them.
const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

export function CalendarPage() {
  const today = new Date();
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [industry, setIndustry] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  // The grid runs Monday to Sunday, from the week the month starts to the week it ends.
  const days = useMemo(() => {
    const start = new Date(month);
    start.setDate(1 - ((start.getDay() + 6) % 7));
    const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    const end = new Date(last);
    end.setDate(last.getDate() + (6 - ((last.getDay() + 6) % 7)));
    const list: Date[] = [];
    for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) list.push(new Date(d));
    return list;
  }, [month]);

  const from = days[0].toISOString();
  const to = new Date(days[days.length - 1].getTime() + 86_400_000).toISOString();
  const campaigns = useQuery({ queryKey: ['calendar', from, to], queryFn: () => api.listCampaignsBetween(from, to) });

  const rows = (campaigns.data ?? []).filter((c) => !industry || c.industry === industry);
  const byDay = useMemo(() => {
    const map = new Map<string, CampaignRow[]>();
    for (const c of rows) {
      if (!c.scheduled_at) continue;
      const key = dayKey(new Date(c.scheduled_at));
      map.set(key, [...(map.get(key) ?? []), c]);
    }
    return map;
  }, [rows]);
  const industries = [...new Set((campaigns.data ?? []).map((c) => c.industry))].sort().map((i) => ({ value: i, label: humanize(i) }));
  const selectedRows = selected ? byDay.get(selected) ?? [] : [];
  const monthName = month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const shift = (n: number) => { setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1)); setSelected(null); };
  // Choosing a day with newsletters opens its full list in a popup; empty days do nothing.
  const pick = (key: string, count: number) => { if (count > 0) setSelected(key); };
  const navigate = useNavigate();
  // Inside the popup, a newsletter can be previewed without leaving the calendar.
  const [previewing, setPreviewing] = useState<CampaignRow | null>(null);
  const preview = useQuery({ queryKey: ['campaign-html', previewing?.id], queryFn: () => api.getCampaignHtml(previewing!.id), enabled: !!previewing });
  const close = () => { setSelected(null); setPreviewing(null); };

  return (
    <Stack>
      <PageHeader title="Newsletter Schedule" description="When each sub-account's newsletter goes out. Click a newsletter to open it, or a day to see all of that day's newsletters." />
      {campaigns.error && <Alert color="red">{(campaigns.error as Error).message}</Alert>}

      <Paper withBorder p="md">
        <Group justify="space-between" mb="md" wrap="wrap" gap="sm">
          <Group gap="xs">
            <ActionIcon variant="default" size="lg" aria-label="Previous month" onClick={() => shift(-1)}><IconChevronLeft size={18} /></ActionIcon>
            <Title order={4} miw={170} ta="center">{monthName}</Title>
            <ActionIcon variant="default" size="lg" aria-label="Next month" onClick={() => shift(1)}><IconChevronRight size={18} /></ActionIcon>
            <Button variant="subtle" size="xs" onClick={() => setMonth(new Date(today.getFullYear(), today.getMonth(), 1))}>Today</Button>
          </Group>
          <Group gap="sm">
            <Text size="sm" c="dimmed">{rows.length} newsletter{rows.length === 1 ? '' : 's'}</Text>
            <Select size="sm" w={190} placeholder="All industries" aria-label="Filter by industry" clearable value={industry} onChange={setIndustry} data={industries} />
          </Group>
        </Group>

        <div className="calendar-grid" role="grid" aria-label={monthName}>
          {WEEKDAYS.map((d) => <div key={d} className="calendar-weekday" role="columnheader">{d}</div>)}
          {days.map((d) => {
            const key = dayKey(d);
            const entries = byDay.get(key) ?? [];
            const outside = d.getMonth() !== month.getMonth();
            return (
              <div key={key} role="gridcell" tabIndex={entries.length ? 0 : -1} className="calendar-day" data-outside={outside} data-today={key === dayKey(today)}
                data-busy={entries.length > 0} aria-label={`${d.toDateString()}: ${entries.length} newsletters`}
                onClick={() => pick(key, entries.length)}
                onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pick(key, entries.length); } }}>
                <div className="calendar-day-head">
                  <span className="calendar-date">{d.getDate()}</span>
                  {entries.length > 0 && <span className="calendar-count">{entries.length}</span>}
                </div>
                {entries.slice(0, SHOWN_PER_DAY).map((c) => (
                  <Tooltip key={c.id} label={`${time(c.scheduled_at!)} · ${c.tenant_name} · ${CAMPAIGN_STATUS_TEXT[c.status].label} · Click to open`} withArrow openDelay={300}>
                    <Link to={`/admin/campaigns/${c.edition_id}`} className="calendar-entry" style={{ '--entry-color': STATUS_DOT[c.status] } as CSSProperties}
                      onClick={(e) => e.stopPropagation()}>
                      <span className="status-dot" style={{ background: STATUS_DOT[c.status] }} />
                      <span className="calendar-entry-time">{time(c.scheduled_at!)}</span>
                      <span className="calendar-entry-name">{c.tenant_name}</span>
                    </Link>
                  </Tooltip>
                ))}
                {entries.length > SHOWN_PER_DAY && (
                  <UnstyledButton className="calendar-more" onClick={(e) => { e.stopPropagation(); pick(key, entries.length); }}>
                    +{entries.length - SHOWN_PER_DAY} more
                  </UnstyledButton>
                )}
              </div>
            );
          })}
        </div>

        <Group gap="md" mt="sm" wrap="wrap">
          {(['CLIENT_REVIEW_PENDING', 'APPROVED_FOR_SEND', 'SCHEDULED', 'SENT', 'HELD', 'FAILED'] as const).map((s) => (
            <Group key={s} gap={6}><span className="status-dot" style={{ background: STATUS_DOT[s] }} /><Text size="xs" c="dimmed">{CAMPAIGN_STATUS_TEXT[s].label}</Text></Group>
          ))}
        </Group>
      </Paper>

      <Modal opened={selected !== null} onClose={close} centered radius="md" size={previewing ? 'xl' : 'lg'}
        title={previewing ? (
          <Group gap="sm" wrap="nowrap">
            <Tooltip label="Back to the day's list">
              <ActionIcon variant="default" size="lg" aria-label="Back to the day's list" onClick={() => setPreviewing(null)}><IconArrowLeft size={18} /></ActionIcon>
            </Tooltip>
            <div style={{ minWidth: 0 }}>
              <Text fw={700} size="lg" truncate>{previewing.tenant_name}</Text>
              <Text size="sm" c="dimmed" truncate>{time(previewing.scheduled_at!)} · {previewing.edition_subject}</Text>
            </div>
          </Group>
        ) : selected && (
          <div>
            <Text fw={700} size="lg">{new Date(`${selected}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</Text>
            <Text size="sm" c="dimmed">{selectedRows.length} newsletter{selectedRows.length === 1 ? '' : 's'} on this day</Text>
          </div>
        )}>
        {previewing ? (
          <Stack gap="sm">
            <Group justify="space-between" wrap="wrap" gap="xs">
              <StatusBadge status={previewing.status} />
              <Group gap="xs">
                <Button variant="default" size="xs" leftSection={<IconUser size={14} />} onClick={() => navigate(`/admin/sub-accounts/${previewing.tenant_id}`)}>Open sub-account</Button>
                <Button size="xs" rightSection={<IconChevronRight size={14} />} onClick={() => navigate(`/admin/campaigns/${previewing.edition_id}`)}>Open campaign</Button>
              </Group>
            </Group>
            {preview.isLoading ? <Center h={300}><Loader /></Center>
              : preview.error ? <Alert color="red">{(preview.error as Error).message}</Alert>
              : <EmailPreview html={preview.data} height={560} />}
            <Text size="xs" c="dimmed">This is exactly what {previewing.tenant_name} will receive, with their own logo and details.</Text>
          </Stack>
        ) : (
          <Stack gap="xs">
            {selectedRows.map((c) => (
              <div key={c.id} role="button" tabIndex={0} className="calendar-card" style={{ '--entry-color': STATUS_DOT[c.status] } as CSSProperties}
                onClick={() => setPreviewing(c)} aria-label={`Preview ${c.tenant_name} newsletter`}
                onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setPreviewing(c); } }}>
                <div className="calendar-card-time">{time(c.scheduled_at!)}</div>
                <div className="calendar-card-body">
                  <Text fw={600} size="sm" truncate>{c.tenant_name}</Text>
                  <Text size="xs" c="dimmed" truncate>{c.edition_subject}</Text>
                </div>
                <StatusBadge status={c.status} />
                <Group gap={2} wrap="nowrap">
                  <Tooltip label="Preview">
                    <ActionIcon variant="subtle" color="gray" aria-label={`Preview ${c.tenant_name}`} onClick={(e) => { e.stopPropagation(); setPreviewing(c); }}>
                      <IconEye size={16} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label="Open sub-account">
                    <ActionIcon variant="subtle" color="gray" aria-label={`Open ${c.tenant_name} sub-account`}
                      onClick={(e) => { e.stopPropagation(); navigate(`/admin/sub-accounts/${c.tenant_id}`); }}>
                      <IconUser size={16} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label="Open campaign">
                    <ActionIcon variant="subtle" color="gray" aria-label={`Open ${c.tenant_name} campaign`}
                      onClick={(e) => { e.stopPropagation(); navigate(`/admin/campaigns/${c.edition_id}`); }}>
                      <IconChevronRight size={16} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              </div>
            ))}
            <Text size="xs" c="dimmed" mt={4}>Click a newsletter to preview it. Times are in your own time zone; each one goes out at its sub-account's chosen local time.</Text>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}

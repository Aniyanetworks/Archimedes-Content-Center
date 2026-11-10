import { useMemo, useState } from 'react';
import { ActionIcon, Alert, Anchor, Button, Group, Paper, Select, Stack, Table, Text, Title, Tooltip, UnstyledButton } from '@mantine/core';
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { CampaignRow } from '../api/types';
import { hintLabel } from '../components/HintLabel';
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
  const [selected, setSelected] = useState<string | null>(dayKey(today));

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

  return (
    <Stack>
      <PageHeader title="Calendar" description="When each sub-account's newsletter goes out. Click a day to see its list." />
      {campaigns.error && <Alert color="red">{(campaigns.error as Error).message}</Alert>}

      <Paper withBorder p="md">
        <Group justify="space-between" mb="md" wrap="wrap" gap="sm">
          <Group gap="xs">
            <ActionIcon variant="default" size="lg" aria-label="Previous month" onClick={() => shift(-1)}><IconChevronLeft size={18} /></ActionIcon>
            <Title order={4} miw={170} ta="center">{monthName}</Title>
            <ActionIcon variant="default" size="lg" aria-label="Next month" onClick={() => shift(1)}><IconChevronRight size={18} /></ActionIcon>
            <Button variant="subtle" size="xs" onClick={() => { setMonth(new Date(today.getFullYear(), today.getMonth(), 1)); setSelected(dayKey(today)); }}>Today</Button>
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
              <UnstyledButton key={key} role="gridcell" className="calendar-day" data-outside={outside} data-today={key === dayKey(today)} data-selected={key === selected}
                aria-label={`${d.toDateString()}: ${entries.length} newsletters`} onClick={() => setSelected(key)}>
                <span className="calendar-date">{d.getDate()}</span>
                {entries.slice(0, SHOWN_PER_DAY).map((c) => (
                  <Tooltip key={c.id} label={`${time(c.scheduled_at!)} · ${c.tenant_name} · ${CAMPAIGN_STATUS_TEXT[c.status].label}`} withArrow>
                    <span className="calendar-entry">
                      <span className="status-dot" style={{ background: STATUS_DOT[c.status] }} />
                      <span className="calendar-entry-name">{c.tenant_name}</span>
                    </span>
                  </Tooltip>
                ))}
                {entries.length > SHOWN_PER_DAY && <span className="calendar-more">+{entries.length - SHOWN_PER_DAY} more</span>}
              </UnstyledButton>
            );
          })}
        </div>

        <Group gap="md" mt="sm" wrap="wrap">
          {(['CLIENT_REVIEW_PENDING', 'APPROVED_FOR_SEND', 'SCHEDULED', 'SENT', 'HELD', 'FAILED'] as const).map((s) => (
            <Group key={s} gap={6}><span className="status-dot" style={{ background: STATUS_DOT[s] }} /><Text size="xs" c="dimmed">{CAMPAIGN_STATUS_TEXT[s].label}</Text></Group>
          ))}
        </Group>
      </Paper>

      {selected && (
        <Paper withBorder p="md">
          <Title order={5} mb="sm">{hintLabel(new Date(`${selected}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }), 'Times are shown in your own time zone. Each newsletter goes out at its sub-account\'s chosen local time.')}</Title>
          {selectedRows.length === 0 ? (
            <Text size="sm" c="dimmed">No newsletters on this day.</Text>
          ) : (
            <Table.ScrollContainer minWidth={560}>
              <Table verticalSpacing="xs">
                <Table.Thead><Table.Tr><Table.Th>Time</Table.Th><Table.Th>Sub-account</Table.Th><Table.Th>Campaign</Table.Th><Table.Th>Status</Table.Th></Table.Tr></Table.Thead>
                <Table.Tbody>
                  {selectedRows.map((c) => (
                    <Table.Tr key={c.id}>
                      <Table.Td style={{ whiteSpace: 'nowrap' }}>{time(c.scheduled_at!)}</Table.Td>
                      <Table.Td><Anchor component={Link} to={`/admin/sub-accounts/${c.tenant_id}`} size="sm" fw={600}>{c.tenant_name}</Anchor></Table.Td>
                      <Table.Td><Anchor component={Link} to={`/admin/campaigns/${c.edition_id}`} size="sm">{c.edition_subject}</Anchor></Table.Td>
                      <Table.Td><StatusBadge status={c.status} /></Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
        </Paper>
      )}
    </Stack>
  );
}

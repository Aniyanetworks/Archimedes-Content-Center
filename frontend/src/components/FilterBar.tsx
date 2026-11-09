import { Button, CloseButton, Group, ScrollArea, Select, Text, TextInput, UnstyledButton } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import type { ReactNode } from 'react';

export interface FilterSelect {
  key: string;
  placeholder: string;
  value: string | null;
  onChange: (value: string | null) => void;
  data: Array<{ value: string; label: string }>;
}

interface Props {
  search: string;
  onSearch: (value: string) => void;
  searchPlaceholder: string;
  // Status tabs with counts. Tabs with no items are hidden, except the selected one.
  // A tab without a count is always shown.
  tabs: Array<{ value: string; label: string; count?: number }>;
  tabsLabel?: string;
  tab: string | null;
  onTab: (value: string | null) => void;
  selects: FilterSelect[];
  total: number;
  shown: number;
  noun: [string, string];
  onClear: () => void;
  // An action shown at the right end of the tabs row, such as a page-level button.
  tabsRight?: ReactNode;
}

// The toolbar above a list: status tabs, then search and a few compact filters.
export function FilterBar({ search, onSearch, searchPlaceholder, tabs, tabsLabel, tab, onTab, selects, total, shown, noun, onClear, tabsRight }: Props) {
  const filtering = !!search.trim() || !!tab || selects.some((s) => s.value);
  const visibleTabs = tabs.filter((t) => t.count === undefined || t.count > 0 || t.value === tab);
  return (
    <div className="filter-bar">
      <Group gap="sm" wrap="nowrap" justify="space-between" align="center">
        <ScrollArea type="never" style={{ minWidth: 0, flex: 1 }}>
          <Group gap={4} wrap="nowrap" className="filter-tabs" role="tablist" aria-label={tabsLabel ?? "Filter by status"}>
            <UnstyledButton role="tab" aria-selected={!tab} data-active={!tab} className="filter-tab" onClick={() => onTab(null)}>
              All <span className="filter-count">{total}</span>
            </UnstyledButton>
            {visibleTabs.map((t) => (
              <UnstyledButton key={t.value} role="tab" aria-selected={tab === t.value} data-active={tab === t.value} className="filter-tab" onClick={() => onTab(tab === t.value ? null : t.value)}>
                {t.label}{t.count !== undefined && <span className="filter-count">{t.count}</span>}
              </UnstyledButton>
            ))}
          </Group>
        </ScrollArea>
        {tabsRight}
      </Group>
      <Group gap="xs" mt="sm" wrap="wrap" align="center">
        <TextInput
          className="filter-search"
          size="sm"
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          leftSection={<IconSearch size={16} />}
          rightSection={search ? <CloseButton size="sm" aria-label="Clear search" onClick={() => onSearch('')} /> : null}
          value={search}
          onChange={(e) => onSearch(e.currentTarget.value)}
        />
        {selects.map((s) => (
          <Select
            key={s.key}
            className="filter-select"
            size="sm"
            placeholder={s.placeholder}
            aria-label={s.placeholder}
            clearable
            searchable={s.data.length > 8}
            value={s.value}
            onChange={s.onChange}
            data={s.data}
          />
        ))}
        <Group gap="xs" ml="auto" wrap="nowrap">
          <Text size="sm" c="dimmed">{filtering ? `${shown} of ${total} ${noun[1]}` : `${total} ${total === 1 ? noun[0] : noun[1]}`}</Text>
          {filtering && <Button size="compact-sm" variant="subtle" onClick={onClear}>Clear</Button>}
        </Group>
      </Group>
    </div>
  );
}

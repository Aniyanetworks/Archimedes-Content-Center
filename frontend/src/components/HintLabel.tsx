import type { ReactNode } from 'react';
import { Tooltip } from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';

// A field label with an info icon. The details show on hover, keyboard focus or tap,
// so forms stay short and every input box lines up.
export function hintLabel(label: ReactNode, hint: ReactNode) {
  return (
    <span className="hint-label">
      {label}
      <Tooltip label={hint} multiline w={280} withArrow events={{ hover: true, focus: true, touch: true }}>
        <span className="hint-icon" tabIndex={0} role="img" aria-label={typeof hint === 'string' ? hint : 'More information'}>
          <IconInfoCircle size={15} stroke={1.75} />
        </span>
      </Tooltip>
    </span>
  );
}

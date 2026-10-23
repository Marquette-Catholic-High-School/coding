// Every status indicator in the app is a Badge from this file (style guide §4 "Status badges").

import { Badge, Text, Tooltip, type BadgeProps, type MantineColor } from '@mantine/core';
import type { LanguageKind, Role, SubmissionStatus } from '@codeclass/shared';
import { IconClockExclamation, IconEyeOff } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { LanguageIcon } from './LanguageIcon';

/** Spread into every status badge so it never shrinks/clips. */
export const BADGE_NO_SHRINK = { miw: 'max-content', style: { flexShrink: 0 } } as const;

const STATUS: Record<SubmissionStatus, { label: string; color: MantineColor; tip: string }> = {
  not_started: { label: 'Not started', color: 'gray', tip: "Hasn't opened the assignment yet." },
  in_progress: { label: 'In progress', color: 'orange', tip: 'Working on it — not handed in yet.' },
  submitted: { label: 'Submitted', color: 'blue', tip: 'Handed in and waiting to be graded.' },
  graded: { label: 'Graded', color: 'teal', tip: 'The teacher has graded this work.' },
};

export function SubmissionStatusBadge({ status, size = 'sm' }: { status: SubmissionStatus; size?: BadgeProps['size'] }) {
  const s = STATUS[status];
  return (
    <Tooltip label={s.tip}>
      <Badge variant="light" size={size} color={s.color} {...BADGE_NO_SHRINK}>
        {s.label}
      </Badge>
    </Tooltip>
  );
}

/** The only filled badge in the app — identical everywhere. */
export function LateBadge({ missing }: { missing?: boolean }) {
  return (
    <Badge color="red" variant="filled" leftSection={<IconClockExclamation size={12} />} {...BADGE_NO_SHRINK}>
      {missing ? 'Missing' : 'Late'}
    </Badge>
  );
}

export function DraftBadge() {
  return (
    <Tooltip label="Students can't see this assignment yet.">
      <Badge variant="light" color="gray" leftSection={<IconEyeOff size={12} />} {...BADGE_NO_SHRINK}>
        Draft
      </Badge>
    </Tooltip>
  );
}

/** Outline type badge with the language's icon (brand for pseudocode, indigo for packs). */
export function LanguageBadge({ kind, name }: { kind: LanguageKind; name: string }) {
  return (
    <Badge
      variant="outline"
      color={kind === 'pseudocode' ? 'brand' : 'indigo'}
      leftSection={<LanguageIcon kind={kind} size={12} />}
      tt="none"
      {...BADGE_NO_SHRINK}
    >
      {name}
    </Badge>
  );
}

/** "3 late", "2 to grade" — renders nothing for 0. */
export function CountBadge({ count, label, color, icon }: { count: number; label: string; color: MantineColor; icon?: ReactNode }) {
  if (!count) return null;
  return (
    <Badge variant="light" size="md" color={color} leftSection={icon} {...BADGE_NO_SHRINK}>
      {count} {label}
    </Badge>
  );
}

export function CodeChip({ children }: { children: ReactNode }) {
  return (
    <Badge variant="default" tt="none" ff="monospace" {...BADGE_NO_SHRINK}>
      {children}
    </Badge>
  );
}

const ROLE_COLOR: Record<Role, MantineColor> = { admin: 'grape', teacher: 'brand', student: 'blue' };

export function RoleBadge({ role }: { role: Role }) {
  return (
    <Badge variant="light" size="sm" color={ROLE_COLOR[role]} {...BADGE_NO_SHRINK}>
      {role}
    </Badge>
  );
}

/** Score band color for fills (Progress, RingProgress): ≥90 teal · ≥70 lime · ≥50 yellow · <50 red · null gray. */
export function scoreColor(percent: number | null | undefined): MantineColor {
  if (percent == null) return 'gray';
  if (percent >= 90) return 'teal';
  if (percent >= 70) return 'lime';
  if (percent >= 50) return 'yellow';
  return 'red';
}

/** CSS var for score text (≥ 4.5:1 contrast in both schemes). */
export function scoreTextColor(percent: number | null | undefined): string {
  if (percent == null) return 'var(--mantine-color-dimmed)';
  if (percent >= 90) return 'var(--score-text-high)';
  if (percent >= 70) return 'var(--score-text-good)';
  if (percent >= 50) return 'var(--score-text-fair)';
  return 'var(--score-text-low)';
}

/** "85%" in the score band's text color, or a dimmed dash. */
export function ScoreText({ percent, size = 'sm' }: { percent: number | null | undefined; size?: string }) {
  return (
    <Text size={size} fw={600} style={{ color: scoreTextColor(percent) }} span>
      {percent == null ? '—' : `${Math.round(percent)}%`}
    </Text>
  );
}

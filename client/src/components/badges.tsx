// Every status indicator in the app is a Badge from this file (style guide §4 "Status badges").

import { Badge, Text, Tooltip, type BadgeProps, type MantineColor } from '@mantine/core';
import {
  SOLUTION_VISIBILITY_LABELS,
  type InviteOutcome,
  type LanguageKind,
  type Role,
  type SolutionVisibility,
  type SubmissionStatus,
} from '@codeclass/shared';
import {
  IconArchive,
  IconBulb,
  IconCalendarDue,
  IconCalendarOff,
  IconCheck,
  IconCircleOff,
  IconClockExclamation,
  IconCopy,
  IconCopyCheck,
  IconEyeOff,
  IconKey,
  IconLock,
  IconMail,
  IconMailForward,
  IconMailOff,
  IconRobot,
  IconUserCheck,
  IconUserOff,
} from '@tabler/icons-react';
import dayjs from 'dayjs';
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

/**
 * "Due in 3 days" with the exact date in a tooltip; orange when under 48 hours remain, unless the work is `done`.
 * Pass `allowLate` (teacher views) to add the late-work rule to the tooltip.
 */
export function DueBadge({ dueAt, allowLate, done = false }: { dueAt: string | null; allowLate?: boolean; done?: boolean }) {
  if (!dueAt) {
    return (
      <Badge variant="light" color="gray" tt="none" leftSection={<IconCalendarOff size={12} />} {...BADGE_NO_SHRINK}>
        No due date
      </Badge>
    );
  }
  const due = dayjs(dueAt);
  const hoursLeft = due.diff(dayjs(), 'hour', true);
  const soon = !done && hoursLeft > 0 && hoursLeft < 48;
  const lateRule = allowLate === undefined ? '' : allowLate ? ' · late work accepted' : ' · no late work';
  return (
    <Tooltip label={`${due.format('ddd D MMM YYYY, h:mm A')}${lateRule}`}>
      <Badge variant="light" color={soon ? 'orange' : 'gray'} tt="none" leftSection={<IconCalendarDue size={12} />} {...BADGE_NO_SHRINK}>
        Due {due.fromNow()}
      </Badge>
    </Tooltip>
  );
}

/** Teacher views: the assignment has a solution, and when students may see it. */
export function SolutionBadge({ visibility }: { visibility: SolutionVisibility }) {
  const { label, description } = SOLUTION_VISIBILITY_LABELS[visibility];
  return (
    <Tooltip label={description} multiline maw={300}>
      <Badge
        variant="light"
        color={visibility === 'hidden' ? 'gray' : 'blue'}
        tt="none"
        leftSection={<IconBulb size={12} />}
        {...BADGE_NO_SHRINK}
      >
        Solution: {label}
      </Badge>
    </Tooltip>
  );
}

/** Teacher views: the student's code is the same program as the teacher's solution (`useSameProgram`). */
export function SolutionMatchBadge({ size = 'sm' }: { size?: BadgeProps['size'] }) {
  return (
    <Tooltip label="Same program as your solution — spacing, indentation, blank lines and comments don't count." multiline maw={300}>
      <Badge variant="light" size={size} color="teal" leftSection={<IconCopyCheck size={12} />} {...BADGE_NO_SHRINK}>
        Matches solution
      </Badge>
    </Tooltip>
  );
}

/** Next to a grade that autograde set and the teacher hasn't changed (`Submission.autoGraded`). */
export function AutoGradedBadge() {
  return (
    <Tooltip label="Set by autograde. Change it to grade it yourself.">
      <Badge variant="light" size="xs" color="brand" leftSection={<IconRobot size={12} />} {...BADGE_NO_SHRINK}>
        Auto
      </Badge>
    </Tooltip>
  );
}

export function ArchivedBadge() {
  return (
    <Tooltip label="Hidden from dashboards and closed to new students. All work is kept.">
      <Badge variant="light" color="gray" leftSection={<IconArchive size={12} />} {...BADGE_NO_SHRINK}>
        Archived
      </Badge>
    </Tooltip>
  );
}

export function JoiningOffBadge() {
  return (
    <Tooltip label="Students can't join with the class code or link. Turn joining on in Settings." multiline maw={300}>
      <Badge variant="light" color="gray" leftSection={<IconLock size={12} />} {...BADGE_NO_SHRINK}>
        Joining off
      </Badge>
    </Tooltip>
  );
}

/** The account still has the temporary password it was given (`mustChangePassword`). */
export function TemporaryPasswordBadge() {
  return (
    <Tooltip label="Still using the temporary password you gave them. They'll choose their own after signing in." multiline maw={300}>
      <Badge variant="light" color="grape" size="sm" leftSection={<IconKey size={12} />} {...BADGE_NO_SHRINK}>
        Temp password
      </Badge>
    </Tooltip>
  );
}

const INVITE_OUTCOME: Record<InviteOutcome, { label: string; color: MantineColor; icon: ReactNode; tip: string }> = {
  enrolled: {
    label: 'Added now',
    color: 'teal',
    icon: <IconUserCheck size={12} />,
    tip: 'A student account already uses this email, so they are added to the class right away.',
  },
  invited: {
    label: 'Joins when they sign up',
    color: 'grape',
    icon: <IconMailForward size={12} />,
    tip: 'No account uses this email yet. They join the class as soon as they sign up with it, or add it to their account.',
  },
  already_enrolled: { label: 'Already in class', color: 'gray', icon: <IconCheck size={12} />, tip: 'This student is already in the class.' },
  already_invited: { label: 'Already invited', color: 'gray', icon: <IconMail size={12} />, tip: "This email is already on the class's invite list." },
  not_a_student: {
    label: 'Teacher account — skipped',
    color: 'orange',
    icon: <IconUserOff size={12} />,
    tip: "This email belongs to a teacher or admin account, so it can't be added as a student.",
  },
  invalid: { label: 'Not an email', color: 'red', icon: <IconMailOff size={12} />, tip: "This isn't an email address, so the row is skipped." },
  duplicate: { label: 'Duplicate', color: 'gray', icon: <IconCopy size={12} />, tip: 'This email appears earlier in the list, so the row is skipped.' },
};

/** What importing one spreadsheet row does (Students tab → "Import from spreadsheet"). */
export function InviteOutcomeBadge({ outcome }: { outcome: InviteOutcome }) {
  const o = INVITE_OUTCOME[outcome];
  return (
    <Tooltip label={o.tip} multiline maw={300}>
      <Badge variant="light" size="sm" color={o.color} tt="none" leftSection={o.icon} {...BADGE_NO_SHRINK}>
        {o.label}
      </Badge>
    </Tooltip>
  );
}

/** A language an admin (or its owner) switched off. */
export function LanguageDisabledBadge() {
  return (
    <Tooltip
      multiline
      maw={300}
      label="Switched off: it can't be chosen for new classes, assignments or projects. Existing assignments keep working."
    >
      <Badge variant="light" color="gray" leftSection={<IconCircleOff size={12} />} {...BADGE_NO_SHRINK}>
        Disabled
      </Badge>
    </Tooltip>
  );
}

/** Stands in for LanguageBadge when the language is no longer installed or visible; shows its raw id. */
export function UnavailableLanguageBadge({ languageId }: { languageId: string }) {
  return (
    <Tooltip label="This language isn't available any more.">
      <Badge variant="outline" color="gray" tt="none" {...BADGE_NO_SHRINK}>
        {languageId}
      </Badge>
    </Tooltip>
  );
}

/** Catalog pack that is already installed. */
export function InstalledBadge() {
  return (
    <Badge variant="light" color="teal" leftSection={<IconCheck size={12} />} {...BADGE_NO_SHRINK}>
      Installed
    </Badge>
  );
}

/** Pseudocode construct the class hasn't learned yet (switched off in the language builder). */
export function NotLearnedBadge() {
  return (
    <Badge variant="light" color="gray" size="sm" leftSection={<IconLock size={12} />} {...BADGE_NO_SHRINK}>
      Not learned yet
    </Badge>
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

/** Count in a `Tabs.Tab` rightSection — renders nothing for 0. */
export function TabCountBadge({ count }: { count: number }) {
  if (!count) return null;
  return (
    <Badge size="xs" variant="light" circle>
      {count}
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

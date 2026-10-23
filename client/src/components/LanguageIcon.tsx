import type { LanguageKind } from '@codeclass/shared';
import {
  IconBrandHtml5,
  IconBrandJavascript,
  IconBrandPython,
  IconBrandTypescript,
  IconDatabase,
  IconMoonStars,
  IconWriting,
} from '@tabler/icons-react';

const ICONS = {
  python: IconBrandPython,
  javascript: IconBrandJavascript,
  typescript: IconBrandTypescript,
  lua: IconMoonStars,
  sql: IconDatabase,
  web: IconBrandHtml5,
  pseudocode: IconWriting,
} satisfies Record<LanguageKind, unknown>;

export function LanguageIcon({ kind, size = 16, stroke }: { kind: LanguageKind; size?: number; stroke?: number }) {
  const Icon = ICONS[kind] ?? IconWriting;
  return <Icon size={size} stroke={stroke} />;
}

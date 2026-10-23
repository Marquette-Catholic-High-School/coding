import type { LanguageResponse } from '@codeclass/shared';
import { useParams } from 'react-router';
import { useLanguage } from '../../api/languages';
import { NotFoundCard } from '../../components/NotFoundCard';
import { QueryState } from '../../components/QueryState';
import { usePageTitle } from '../../hooks/usePageTitle';
import { PackSettings } from './PackSettings';
import { PseudocodeBuilder } from './PseudocodeBuilder';

function renderLanguage({ language }: LanguageResponse) {
  return language.kind === 'pseudocode' ? (
    <PseudocodeBuilder key={language.id} language={language} />
  ) : (
    <PackSettings key={language.id} language={language} />
  );
}

/** /languages/:languageId — the pseudocode builder, or the settings page of an installed pack. */
export function LanguagePage() {
  const { languageId } = useParams();
  const query = useLanguage(languageId);
  usePageTitle(query.data?.language.name ?? 'Language');

  // Once loaded, keep the page (and any unsaved edits) on screen even if a background refetch fails —
  // e.g. while offline, or for the moment between deleting the language and leaving the page.
  if (query.data) return renderLanguage(query.data);
  return (
    <QueryState
      query={query}
      notFound={
        <NotFoundCard title="We couldn't find that language" description="It may have been uninstalled or deleted." />
      }
    >
      {renderLanguage}
    </QueryState>
  );
}

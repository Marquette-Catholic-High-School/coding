import { useDownloadReport } from '../../api/reports';
import { saveBlob } from '../../api/download';
import { notifyError, notifySuccess } from '../../components/notify';
import { browserSettings, reportPath, reportQuery, type DayRange, type ReportTarget } from './reportParams';

/** Used when the server doesn't suggest a name. */
const FALLBACK_FILENAME = 'CodeClass report.pdf';

/**
 * Downloads a report PDF for the chosen dates (written in this browser's time zone, on its region's paper) and saves
 * it. `onSaved` runs once the file is saved; nothing is saved if the component unmounts first (e.g. its dialog closed).
 */
export function useReportDownload() {
  const mutation = useDownloadReport();
  const download = (target: ReportTarget, range: DayRange, onSaved?: () => void) =>
    mutation.mutate(reportPath(target, reportQuery(range, browserSettings())), {
      onSuccess: ({ blob, filename }) => {
        const name = filename ?? FALLBACK_FILENAME;
        saveBlob(blob, name);
        notifySuccess('Report downloaded', `Look for “${name}” in your downloads.`);
        onSaved?.();
      },
      onError: (err) => notifyError(err, "Couldn't download the report"),
    });
  return { download, isPending: mutation.isPending };
}

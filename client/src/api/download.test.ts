import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountChangedError, api, ApiError, NetworkError, queryClient, queryKeys, setSessionProblemListener } from './client';
import { filenameFromContentDisposition, saveBlob } from './download';

describe('filenameFromContentDisposition', () => {
  it("prefers filename* (UTF-8) over filename, in either order", () => {
    const ascii = 'Zoe Ng - student report - 2026-10-27.pdf';
    const utf8 = "UTF-8''Zo%C3%AB%20Ng%20-%20student%20report%20-%202026-10-27.pdf";
    expect(filenameFromContentDisposition(`attachment; filename="${ascii}"; filename*=${utf8}`)).toBe(
      'Zoë Ng - student report - 2026-10-27.pdf',
    );
    expect(filenameFromContentDisposition(`attachment; filename*=${utf8}; filename="${ascii}"`)).toBe(
      'Zoë Ng - student report - 2026-10-27.pdf',
    );
  });

  it('reads filename* with any charset case, a language tag, and ISO-8859-1', () => {
    expect(filenameFromContentDisposition("attachment; filename*=utf-8'en'%E2%82%AC%20rates.pdf")).toBe('€ rates.pdf');
    expect(filenameFromContentDisposition("attachment; FILENAME*=UTF-8''a%20b.pdf")).toBe('a b.pdf');
    expect(filenameFromContentDisposition("attachment; filename*=iso-8859-1'de'M%FCller.pdf")).toBe('Müller.pdf');
  });

  it('falls back to filename when filename* is unreadable', () => {
    expect(filenameFromContentDisposition("attachment; filename*=UTF-8''%E2%82; filename=\"plain.pdf\"")).toBe('plain.pdf');
    expect(filenameFromContentDisposition("attachment; filename*=KOI8-R''%C1.pdf; filename=plain.pdf")).toBe('plain.pdf');
    expect(filenameFromContentDisposition('attachment; filename*=no-quotes.pdf; filename=plain.pdf')).toBe('plain.pdf');
  });

  it('reads quoted filenames with escapes and semicolons, and unquoted ones', () => {
    expect(filenameFromContentDisposition('attachment; filename="Class \\"A\\"; period 3.pdf"')).toBe('Class "A"; period 3.pdf');
    expect(filenameFromContentDisposition('attachment; filename=report.pdf')).toBe('report.pdf');
    expect(filenameFromContentDisposition('attachment;filename=report.pdf ; size=1234')).toBe('report.pdf');
    expect(filenameFromContentDisposition('attachment; FileName = "Spaced.pdf"')).toBe('Spaced.pdf');
    expect(filenameFromContentDisposition('filename=no-type.pdf')).toBe('no-type.pdf');
  });

  it("doesn't take a filename hidden inside another parameter's quoted value", () => {
    expect(filenameFromContentDisposition('attachment; note="x; filename=evil.exe"; filename="good.pdf"')).toBe('good.pdf');
  });

  it('drops folders and control characters, and gives null when there is no name', () => {
    expect(filenameFromContentDisposition('attachment; filename="../../etc/passwd"')).toBe('passwd');
    expect(filenameFromContentDisposition("attachment; filename*=UTF-8''..%5C..%5Cwin.ini")).toBe('win.ini');
    expect(filenameFromContentDisposition("attachment; filename*=UTF-8''a%0Ab.pdf")).toBe('ab.pdf');
    expect(filenameFromContentDisposition('attachment; filename=""')).toBeNull();
    expect(filenameFromContentDisposition('attachment; filename="../"')).toBeNull();
    expect(filenameFromContentDisposition('attachment')).toBeNull();
    expect(filenameFromContentDisposition('inline')).toBeNull();
    expect(filenameFromContentDisposition('')).toBeNull();
    expect(filenameFromContentDisposition(null)).toBeNull();
    expect(filenameFromContentDisposition(undefined)).toBeNull();
  });
});

describe('saveBlob', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('clicks a temporary download link for an object URL, then revokes the URL', () => {
    vi.useFakeTimers();
    const link = { href: '', download: '', rel: '', style: { display: '' }, click: vi.fn(), remove: vi.fn() };
    const appendChild = vi.fn();
    vi.stubGlobal('document', { createElement: vi.fn(() => link), body: { appendChild } });
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:report');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);

    const blob = new Blob(['%PDF-1.7'], { type: 'application/pdf' });
    saveBlob(blob, 'Year 8 - class report.pdf');

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(link).toMatchObject({ href: 'blob:report', download: 'Year 8 - class report.pdf' });
    expect(appendChild).toHaveBeenCalledWith(link);
    expect(link.click).toHaveBeenCalledTimes(1);
    expect(link.remove).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:report');
  });
});

function pdf(headers: Record<string, string> = {}): Response {
  return new Response(new Blob(['%PDF-1.7 test']), { status: 200, headers: { 'Content-Type': 'application/pdf', ...headers } });
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('api.download', () => {
  const doc = { cookie: '' };
  const fetchMock = vi.fn<typeof fetch>();
  const problem = vi.fn();
  const sent = (call: number) => fetchMock.mock.calls[call]!;

  beforeEach(() => {
    doc.cookie = 'cc_csrf=token-1';
    fetchMock.mockReset();
    problem.mockReset();
    vi.stubGlobal('document', doc);
    vi.stubGlobal('fetch', fetchMock);
    setSessionProblemListener(problem);
    queryClient.setQueryData(queryKeys.me, { user: { id: 7 } });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    setSessionProblemListener(null);
    queryClient.clear();
  });

  it('GETs the file with the usual headers and returns it with its suggested name', async () => {
    fetchMock.mockResolvedValueOnce(
      pdf({ 'Content-Disposition': `attachment; filename="Year 8 - class report.pdf"; filename*=UTF-8''Year%208%20%E2%80%94%20report.pdf` }),
    );
    const file = await api.download('/reports/classes/3?paper=a4');
    expect(sent(0)[0]).toBe('/api/reports/classes/3?paper=a4');
    expect(sent(0)[1]).toMatchObject({ method: 'GET', credentials: 'same-origin' });
    expect(sent(0)[1]!.headers).toEqual({ 'x-codeclass': '1', 'x-codeclass-token': 'token-1', 'x-codeclass-user': '7' });
    expect(file.filename).toBe('Year 8 — report.pdf');
    expect(await file.blob.text()).toBe('%PDF-1.7 test');
  });

  it('gives a null name when the server suggests none', async () => {
    fetchMock.mockResolvedValueOnce(pdf());
    expect((await api.download('/reports/school')).filename).toBeNull();
  });

  it("turns a JSON error into the usual ApiError, with the server's message and field errors", async () => {
    fetchMock.mockResolvedValueOnce(json(404, { error: { message: 'Class not found' } }));
    const notFound = await api.download('/reports/classes/99').catch((e: unknown) => e);
    expect(notFound).toBeInstanceOf(ApiError);
    expect(notFound).toMatchObject({ status: 404, message: 'Class not found' });

    fetchMock.mockResolvedValueOnce(json(400, { error: { message: 'Check the dates', fieldErrors: { to: 'The start date must be on or before the end date' } } }));
    await expect(api.download('/reports/school?from=x')).rejects.toMatchObject({
      status: 400,
      fieldErrors: { to: 'The start date must be on or before the end date' },
    });
    expect(problem).not.toHaveBeenCalled();
  });

  it('copes with an error that has no JSON body', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>Bad gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } }));
    await expect(api.download('/reports/school')).rejects.toMatchObject({ status: 502, message: 'Request failed (502)' });
  });

  it('retries once after a csrf refusal', async () => {
    fetchMock.mockImplementationOnce(async () => {
      doc.cookie = 'cc_csrf=fresh';
      return json(403, { error: { message: 'Reload the page', code: 'csrf' } });
    });
    fetchMock.mockResolvedValueOnce(pdf({ 'Content-Disposition': 'attachment; filename=r.pdf' }));
    await expect(api.download('/reports/students/5')).resolves.toMatchObject({ filename: 'r.pdf' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((sent(1)[1]!.headers as Record<string, string>)['x-codeclass-token']).toBe('fresh');
  });

  it('rechecks the session when the tab shows another account or was signed out', async () => {
    fetchMock.mockResolvedValueOnce(json(409, { error: { message: 'Different account', code: 'account-changed' } }));
    await expect(api.download('/reports/school')).rejects.toBeInstanceOf(AccountChangedError);
    expect(problem).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValueOnce(json(401, { error: { message: 'Please sign in' } }));
    await expect(api.download('/reports/school')).rejects.toBeInstanceOf(ApiError);
    expect(problem).toHaveBeenCalledTimes(2);
  });

  it("says the server can't be reached when fetch fails", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(api.download('/reports/school')).rejects.toBeInstanceOf(NetworkError);
  });
});

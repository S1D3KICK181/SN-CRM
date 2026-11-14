// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildCsv, csvField, csvFileName, downloadCsv, formatCsvDate, formatCsvRupees } from './csv';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('csvField', () => {
  it('makes text that Excel would run as a formula plain text, but leaves numbers alone', () => {
    expect(csvField('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvField('+91 98200')).toBe("'+91 98200");
    expect(csvField('@sum')).toBe("'@sum");
    expect(csvField('-cmd')).toBe("'-cmd");
    expect(csvField('1234.50')).toBe('1234.50');
    expect(csvField('-12.00')).toBe('-12.00');
    expect(csvField('Aster Foods')).toBe('Aster Foods');
  });

  it('leaves plain text and numbers as they are and empty for null', () => {
    expect(csvField('Aster Foods')).toBe('Aster Foods');
    expect(csvField(42)).toBe('42');
    expect(csvField(0)).toBe('0');
    expect(csvField(null)).toBe('');
  });

  it('quotes a field with a comma, a quote or a line break, and doubles the quotes', () => {
    expect(csvField('Kedia, Holdings')).toBe('"Kedia, Holdings"');
    expect(csvField('The "Big" client')).toBe('"The ""Big"" client"');
    expect(csvField('line one\nline two')).toBe('"line one\nline two"');
    expect(csvField('line one\r\nline two')).toBe('"line one\r\nline two"');
  });

  it('does not quote a field with only a space, an apostrophe or an ampersand', () => {
    expect(csvField("Sharma & Sons' office")).toBe("Sharma & Sons' office");
  });

  it('writes a number that is not finite as empty', () => {
    expect(csvField(Number.NaN)).toBe('');
    expect(csvField(Number.POSITIVE_INFINITY)).toBe('');
  });
});

describe('buildCsv', () => {
  it('starts with a byte order mark, writes the header first and ends every row with CRLF', () => {
    const csv = buildCsv(['Client', 'Billed'], [['Aster Foods', '1180000.00'], ['Kedia, Holdings', 0]]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1)).toBe('Client,Billed\r\nAster Foods,1180000.00\r\n"Kedia, Holdings",0\r\n');
  });

  it('keeps the header alone when there are no rows', () => {
    expect(buildCsv(['A', 'B'], [])).toBe('﻿A,B\r\n');
  });
});

describe('formatCsvRupees', () => {
  it.each([
    [0, '0.00'],
    [5, '0.05'],
    [100, '1.00'],
    [123456, '1234.56'],
    [1180000, '11800.00'],
    [12345678901, '123456789.01'],
    [-250, '-2.50'],
  ])('writes %i paise as %s', (paise, expected) => {
    expect(formatCsvRupees(paise)).toBe(expected);
  });
});

describe('formatCsvDate', () => {
  it('writes a plain date as DD/MM/YYYY', () => {
    expect(formatCsvDate('2026-11-09')).toBe('09/11/2026');
  });

  it('reads a timestamp on the Kolkata calendar', () => {
    expect(formatCsvDate('2026-11-09T20:00:00.000Z')).toBe('10/11/2026');
    expect(formatCsvDate('2026-11-09T10:00:00.000Z')).toBe('09/11/2026');
  });

  it('writes an unreadable value as empty', () => {
    expect(formatCsvDate('yesterday')).toBe('');
  });
});

describe('csvFileName', () => {
  it('stamps a month with its year and month and a day or week with its first date', () => {
    expect(csvFileName('fees', 'by-client', { kind: 'month', start: '2026-11-01' })).toBe('fees-by-client_2026-11.csv');
    expect(csvFileName('work', 'by-service', { kind: 'day', start: '2026-11-10' })).toBe('work-by-service_2026-11-10.csv');
    expect(csvFileName('work', 'by-service', { kind: 'week', start: '2026-11-09' })).toBe('work-by-service_2026-11-09.csv');
  });
});

describe('downloadCsv', () => {
  it('downloads the file through a Blob and a temporary link that is removed afterwards', async () => {
    let blob: Blob | undefined;
    const createObjectURL = vi.fn((value: Blob) => {
      blob = value;
      return 'blob:report-1';
    });
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const clicks: Array<{ href: string; download: string; connected: boolean }> = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push({ href: this.href, download: this.download, connected: this.isConnected });
    });

    downloadCsv('fees-by-client_2026-11.csv', buildCsv(['Client'], [['Aster Foods']]));

    // The address is released only after the click has been handled
    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(clicks).toEqual([{ href: 'blob:report-1', download: 'fees-by-client_2026-11.csv', connected: true }]);
    expect(document.querySelector('a[download]')).toBeNull();
    expect(blob?.type).toBe('text/csv;charset=utf-8');
    // The file really begins with the UTF-8 byte order mark: EF BB BF
    const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob as Blob);
    });
    const bytes = new Uint8Array(buffer);
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:report-1');
  });
});

export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function isYearMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function resolveYearMonth(value: string): { from: string; to: string } {
  const year = Number.parseInt(value.slice(0, 4), 10);
  const month = Number.parseInt(value.slice(5, 7), 10);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, '0');

  return {
    from: `${year}-${pad(month)}-01`,
    to: `${year}-${pad(month)}-${pad(lastDay)}`,
  };
}

export function resolveDate(input: string): string {
  if (input === 'today') {
    return new Date().toISOString().slice(0, 10);
  }

  if (input === 'yesterday') {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 1);

    return d.toISOString().slice(0, 10);
  }

  if (!isIsoDate(input)) {
    throw new Error(
      `invalid date "${input}" — expected YYYY-MM-DD, "today", or "yesterday"`,
    );
  }

  return input;
}

export async function listAll<T extends { id: string }>(
  page: (startingAfter?: string) => Promise<{ data: T[]; has_more: boolean }>,
  maxPages = 20,
): Promise<T[]> {
  const out: T[] = [];
  let startingAfter: string | undefined;
  for (let i = 0; i < maxPages; i++) {
    const res = await page(startingAfter);
    out.push(...res.data);
    if (!res.has_more || res.data.length === 0) break;
    startingAfter = res.data[res.data.length - 1].id;
  }
  return out;
}
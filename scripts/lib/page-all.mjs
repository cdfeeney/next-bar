/**
 * Read every page of an offset-paginated dataset, or refuse.
 *
 * This exists as its own module for the same reason the HTTP transport does: the
 * SLA lane lived inside a CLI that runs a sweep at import, so nothing could
 * import it to test it, and its single capped request was indistinguishable from
 * a complete answer. A full page IS a truncated answer until a short page proves
 * otherwise -- the same rule the cell lanes apply to a saturated response, in
 * the one lane that never got it.
 *
 * @param {object} options
 * @param {(offset: number) => Promise<any[]>} options.fetchPage reads one page
 * @param {number} options.pageSize rows requested per page
 * @param {number} options.maxRows refuse rather than truncate past this many
 * @param {string} options.label named in the refusal, so the operator knows which read
 * @returns {Promise<any[]>} every row
 * @throws {Error} when the source is still returning full pages at `maxRows`
 */
export async function pageAll({ fetchPage, pageSize, maxRows, label }) {
  if (!Number.isFinite(pageSize) || pageSize <= 0) {
    throw new Error(`${label}: pageSize must be a positive number`);
  }
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await fetchPage(offset);
    rows.push(...page);
    // A short page is the only proof the source is exhausted.
    if (page.length < pageSize) return rows;
    if (offset + pageSize >= maxRows) {
      // Never report a number we already know is short.
      throw new Error(
        `${label} hit the ${maxRows}-row ceiling and is still returning full pages; ` +
          'narrow the region or raise the ceiling rather than reporting a truncated set as complete',
      );
    }
  }
}

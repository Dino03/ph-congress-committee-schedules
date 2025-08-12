// -------- House via public API (list endpoint) with retries --------
let house = [];
try {
  const payload = { page: 0, limit: 150, congress: '19', filter: '' };
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Referer: 'https://www.congress.gov.ph/',
    Origin: 'https://www.congress.gov.ph',
    'x-hrep-website-backend': 'cc8bd00d-9b88-4fee-aafe-311c574fcdc1',
    'Accept-Language': 'en-US,en;q=0.9',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:141.0) Gecko/20100101 Firefox/141.0',
    'X-Requested-With': 'XMLHttpRequest',
    'Sec-Fetch-Site': 'cross-site',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Dest': 'empty'
  };

  const delays = [500, 1500, 3500];
  let apiResp = null;
  let lastErr = null;

  for (let i = 0; i < delays.length; i++) {
    try {
      apiResp = await postJson(HOUSE_API, payload, headers);
      await appendDebug(`House attempt ${i + 1} succeeded`);
      break;
    } catch (e) {
      lastErr = e;
      await appendDebug(`House attempt ${i + 1} failed: ${e?.message || e}`);
      if (i < delays.length - 1) {
        await appendDebug(`House retrying after ${delays[i]}ms...`);
        await new Promise((r) => setTimeout(r, delays[i]));
      }
    }
  }

  if (!apiResp) {
    await appendDebug('House API failed after all retries.');
    throw lastErr || new Error('House API failed after retries');
  }

  await fs.writeFile(
    path.join(OUTPUT_DIR, 'house_api_debug.json'),
    JSON.stringify(apiResp, null, 2),
    'utf-8'
  );

  const rows = Array.isArray(apiResp?.data?.rows) ? apiResp.data.rows : [];
  await appendDebug(`House parsed rows=${rows.length}`);

  const decode = (s) =>
    norm(s)
      .replaceAll('&amp;', '&')
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&quot;', '"')
      .replaceAll('&#39;', "'");

  const mapped = rows
    .map((it) => {
      const date = norm(it.date || '');
      const time = parseClock(norm(it.time || ''));
      const committee = norm(it.comm_name || '');
      const subject = decode(it.agenda || '');
      const venue = decode(it.venue || '');
      if (date && time && committee) {
        return { date, time, committee, subject, venue, source: 'House API (list)' };
      }
      return null;
    })
    .filter(Boolean);

  const seen = new Set();
  house = mapped.filter((r) => {
    const k = `${r.date}|${r.time}|${r.committee}`.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  if (house.length === 0) {
    await appendDebug('House produced 0 rows after mapping/dedup.');
  }
} catch (e) {
  await appendDebug(`House error: ${e?.message || e}`);
  console.error('House API fetch failed:', e.message || e);
}

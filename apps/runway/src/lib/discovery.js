// Pure mapper: a discovery-ledger row (queued candidate) → job insert fields.
// Used when the user Accepts a discovery from the inbox. Kept pure so the
// smoke test can assert the mapping without a database.
export function discoveryToJob(d) {
  const arr = (x) => (Array.isArray(x) ? x : []);
  return {
    company: d.company || d.board || '',
    title: d.title || '',
    url: d.url || null,
    location: d.location || null,
    remote_type: d.remote_type || 'unknown',
    seniority: d.seniority || 'unknown',
    comp_min: d.comp_min ?? null,
    comp_max: d.comp_max ?? null,
    raw_description: d.raw_description || null,
    requirements: arr(d.requirements),
    flags: arr(d.flags),
    fit_score: d.fit_score ?? null,
    fit_rationale: d.fit_rationale || null,
    fit_breakdown: d.fit_breakdown ?? null,
    status: 'saved',
    source: 'scan',
  };
}

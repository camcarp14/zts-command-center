// Starter packs — curated companies grouped by vertical, each VERIFIED against
// its live public feed (Greenhouse / Lever / Ashby) at build time so a pack
// never watches a dead board. "Add pack" bulk-watches all of them at once.
// Extend freely: the watch flow dedupes, so re-adding a pack is harmless.
export const COMPANY_PACKS = [
  {
    id: 'healthcare',
    label: 'Healthcare & health tech',
    blurb: 'Digital health, care delivery, and health-tech platforms — your healthcare-heavy background travels straight here.',
    companies: [
      { name: 'Oscar Health', provider: 'greenhouse', board: 'oscar' },
      { name: 'Included Health', provider: 'lever', board: 'includedhealth' },
      { name: 'Cedar', provider: 'ashby', board: 'cedar' },
      { name: 'Ro', provider: 'lever', board: 'ro' },
      { name: 'Headway', provider: 'ashby', board: 'headway' },
      { name: 'Maven Clinic', provider: 'greenhouse', board: 'mavenclinic' },
      { name: 'Omada Health', provider: 'greenhouse', board: 'omadahealth' },
      { name: 'Carrot Fertility', provider: 'greenhouse', board: 'carrotfertility' },
      { name: 'Cohere Health', provider: 'greenhouse', board: 'coherehealth' },
      { name: 'Aledade', provider: 'lever', board: 'aledade' },
      { name: 'Commure', provider: 'ashby', board: 'commure' },
    ],
  },
  {
    id: 'agencies',
    label: 'Marketing & media agencies',
    blurb: 'Performance-marketing and media agencies that live and breathe paid search — closest to your current seat.',
    companies: [
      { name: 'Wpromote', provider: 'lever', board: 'wpromote' },
      { name: 'Jellyfish', provider: 'ashby', board: 'jellyfish' },
      { name: 'Power Digital', provider: 'greenhouse', board: 'powerdigitalmarketing' },
      { name: 'Brainlabs', provider: 'greenhouse', board: 'brainlabs' },
      { name: 'Code3', provider: 'greenhouse', board: 'code3' },
    ],
  },
  {
    id: 'saas',
    label: 'SaaS & tech',
    blurb: 'Growth and performance-marketing orgs at product companies — usually the best comp jump from agency-side.',
    companies: [
      { name: 'Figma', provider: 'greenhouse', board: 'figma' },
      { name: 'Duolingo', provider: 'greenhouse', board: 'duolingo' },
      { name: 'Notion', provider: 'ashby', board: 'notion' },
      { name: 'Webflow', provider: 'greenhouse', board: 'webflow' },
      { name: 'Airtable', provider: 'greenhouse', board: 'airtable' },
      { name: 'Ramp', provider: 'ashby', board: 'ramp' },
      { name: 'Brex', provider: 'greenhouse', board: 'brex' },
      { name: 'Gusto', provider: 'greenhouse', board: 'gusto' },
      { name: 'Instacart', provider: 'greenhouse', board: 'instacart' },
      { name: 'Reddit', provider: 'greenhouse', board: 'reddit' },
      { name: 'Pinterest', provider: 'greenhouse', board: 'pinterest' },
      { name: 'Discord', provider: 'greenhouse', board: 'discord' },
      { name: 'Databricks', provider: 'greenhouse', board: 'databricks' },
      { name: 'Vercel', provider: 'greenhouse', board: 'vercel' },
      { name: 'Attentive', provider: 'greenhouse', board: 'attentive' },
      { name: 'Klaviyo', provider: 'greenhouse', board: 'klaviyo' },
      { name: 'Amplitude', provider: 'greenhouse', board: 'amplitude' },
      { name: 'Miro', provider: 'ashby', board: 'miro' },
      { name: 'Calendly', provider: 'greenhouse', board: 'calendly' },
    ],
  },
  {
    id: 'dtc',
    label: 'DTC & retail',
    blurb: 'Consumer brands with big paid-acquisition budgets — performance marketing is core to the business.',
    companies: [
      { name: 'Glossier', provider: 'greenhouse', board: 'glossier' },
      { name: 'Faire', provider: 'greenhouse', board: 'faire' },
      { name: 'Thrive Market', provider: 'greenhouse', board: 'thrivemarket' },
      { name: 'Ritual', provider: 'greenhouse', board: 'ritual' },
    ],
  },
  {
    id: 'fintech',
    label: 'Fintech',
    blurb: 'Consumer and B2B fintech — heavy paid-search spend and strong comp bands.',
    companies: [
      { name: 'Affirm', provider: 'greenhouse', board: 'affirm' },
      { name: 'Chime', provider: 'greenhouse', board: 'chime' },
      { name: 'Plaid', provider: 'ashby', board: 'plaid' },
      { name: 'Wealthfront', provider: 'lever', board: 'wealthfront' },
      { name: 'Robinhood', provider: 'greenhouse', board: 'robinhood' },
      { name: 'SoFi', provider: 'greenhouse', board: 'sofi' },
      { name: 'Marqeta', provider: 'greenhouse', board: 'marqeta' },
      { name: 'Mercury', provider: 'greenhouse', board: 'mercury' },
    ],
  },
];

export const PACK_BY_ID = Object.fromEntries(COMPANY_PACKS.map((p) => [p.id, p]));
export const packCompanyCount = (pack) => pack.companies.length;
export const allPackCompanies = () => COMPANY_PACKS.flatMap((p) => p.companies);

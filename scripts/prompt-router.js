/**
 * Free-text prompt router.
 *
 * Turns an arbitrary string into an executable intent for the prompt worker.
 *
 * Supported intents:
 * - { type: 'explicit_issue_keys', issueKeys: ['CRM-123', ...] }
 * - { type: 'crm_no_pr', queue: 'CRM' }
 * - { type: 'unknown' }
 */

function extractIssueKeys(text) {
  const s = String(text || '');
  const keys = new Set();

  // URLs like https://st.yandex-team.ru/CRM-123
  for (const m of s.matchAll(/st\.yandex-team\.ru\/([A-Z]+-\d+)/gi)) {
    keys.add(String(m[1]).toUpperCase());
  }
  // Bare keys like CRM-123
  for (const m of s.matchAll(/\b([A-Z]+-\d+)\b/gi)) {
    keys.add(String(m[1]).toUpperCase());
  }

  return Array.from(keys);
}

function looksLikeCrmNoPr(text) {
  const s = String(text || '').toLowerCase();

  const hasCrm = s.includes('crm') || s.includes('црм');
  const hasPlan = s.includes('plan') || s.includes('plans') || s.includes('план') || s.includes('планы') || s.includes('сплан');
  const hasNoPr = s.includes('no pr') || s.includes('without pr') || s.includes('без pr') || s.includes('без пр') || s.includes('нет pr') || s.includes('нет пр');
  const hasArcanum = s.includes('arcanum') || s.includes('арканум') || s.includes('аркан');

  // Accept a few common phrasings:
  // - "generate plans for CRM tasks without PRs"
  // - "CRM без PR в Аркануме"
  // - "CRM tasks no PR pushed to arcanum"
  if (!hasCrm) return false;
  if (hasNoPr && (hasPlan || s.includes('generate') || s.includes('сгенер'))) return true;
  if (hasNoPr && hasArcanum) return true;
  // Also accept "CRM tasks without PR" even if "plan" is omitted.
  if (hasNoPr) return true;
  return false;
}

function routePrompt(promptText) {
  const prompt = String(promptText || '').trim();
  const issueKeys = extractIssueKeys(prompt);
  if (issueKeys.length > 0) {
    return { type: 'explicit_issue_keys', issueKeys, raw: prompt };
  }

  if (looksLikeCrmNoPr(prompt)) {
    return { type: 'crm_no_pr', queue: 'CRM', raw: prompt };
  }

  return { type: 'unknown', raw: prompt };
}

module.exports = {
  extractIssueKeys,
  routePrompt,
};



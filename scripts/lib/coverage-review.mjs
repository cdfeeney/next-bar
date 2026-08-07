import { BAR_TYPES } from './coverage-search.mjs';
import { SAME_LOCATION_METERS, streetKey } from './coverage-identity.mjs';

/** Same house number and street, tolerating abbreviation differences. */
function sameStreet(left, right) {
  const a = streetKey(left);
  const b = streetKey(right);
  return Boolean(a && b && a === b);
}

/**
 * Review scope per borough. The review used to hardcode Manhattan's city list
 * and reject everything else outright, which silently rejected every Brooklyn
 * license lead. Scope is now supplied by the caller; an unscoped review does
 * not reject on geography at all, because rejecting-by-default is exactly the
 * failure this replaces.
 */
export const BOROUGH_SCOPES = Object.freeze({
  manhattan: {
    county: 'New York',
    cities: ['new york', 'manhattan', 'roosevelt island'],
  },
  brooklyn: {
    county: 'Kings',
    cities: ['brooklyn'],
  },
  queens: {
    county: 'Queens',
    cities: ['queens', 'long island city', 'astoria', 'flushing', 'jamaica'],
  },
  bronx: {
    county: 'Bronx',
    cities: ['bronx'],
  },
  'staten island': {
    county: 'Richmond',
    cities: ['staten island'],
  },
});

/** Resolve a scope from a borough name or an NY county name. */
export function resolveScope({ borough, county } = {}) {
  if (borough) {
    const scope = BOROUGH_SCOPES[String(borough).trim().toLowerCase()];
    if (scope) return scope;
  }
  if (county) {
    const wanted = String(county).trim().toLowerCase();
    const found = Object.values(BOROUGH_SCOPES).find(
      (scope) => scope.county.toLowerCase() === wanted,
    );
    if (found) return found;
  }
  return null;
}

const PUBLIC_BAR_NAME_RE =
  /\b(bar|pub|tavern|saloon|lounge|rooftop|biergarten|beer|brew|taproom|wine|winery|cocktails?|nightclub|speakeasy|drinks|hops)\b/i;

const NON_NIGHTLIFE_NAME_RE =
  /\b(?:juice|salad|sushi|noodle|dessert|granola|oxygen|coffee|espresso|taco|burger)\s+bar\b|\braw bar\b|\bbarber\b|\bbeauty salon\b|\bnail salon\b|\bliquor store\b|\bwine store\b|\bsports club\b|\btennis club\b|\bgolf club\b/i;

const NON_STANDALONE_LICENSE_RE =
  /^(?:additional bar(?:\b.*)?|temporary retail|liquor store|grocery store|wholesale liquor|catering establishment)$/i;

const PRIVATE_CLUB_NAME_RE =
  /\b(?:faculty|harvard|yale|university|republican|whist|tennis|golf|anglers|colony|harmonie|knickerbocker|penn club|nippon club|cosmopolitan club|tower club|dining club)\b/i;

const NAME_STOPWORDS = new Set([
  'and',
  'bar',
  'club',
  'company',
  'corp',
  'corporation',
  'inc',
  'llc',
  'new',
  'nyc',
  'restaurant',
  'the',
  'york',
]);

function nameTokens(value) {
  return new Set(
    String(value ?? '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter((token) => token.length > 1 && !NAME_STOPWORDS.has(token)),
  );
}

export function reviewNameSimilarity(left, right) {
  const a = nameTokens(left);
  const b = nameTokens(right);
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const token of a) if (b.has(token)) overlap += 1;
  return overlap / Math.max(a.size, b.size);
}

function licenseDescriptions(candidate) {
  return (candidate.licenseMatches ?? []).map((match) => match.description ?? '');
}

export function adversarialReview(candidate, catalogMatches = [], options = {}) {
  const scope = resolveScope(options);
  const reasons = [];
  // Two rows that BOTH carry a Place ID and disagree are two venues, whatever
  // their names say. Without this guard `nameExact` alone re-introduced the
  // multi-location bug here, in the review driver, after it had been removed
  // from the sweep.
  const duplicate = catalogMatches.find((match) => {
    if (match.placeIdMatch) return true;
    // Differing Place IDs never force a duplicate here. Google reissues ids on
    // re-claims, so the signal is uninformative rather than negative, and a
    // wrong duplicate silently deletes a real bar. The reissue case is routed
    // to lookup below instead of being decided automatically — this must agree
    // with resolveIdentity(), which returns 'ambiguous' for the same input.
    if (candidate.placeId && match.placeId && match.placeId !== candidate.placeId) return false;
    // An exact name alone is not identity — catalogMatches admits rows up to
    // 60m away, which spans a whole block. Require the address to agree, or the
    // rows to be close enough that a different storefront is implausible. This
    // is what resolveIdentity does; the two must not diverge, because a wrong
    // duplicate here silently deletes a real bar.
    // Address availability decides how much distance is allowed to say, and it
    // must be read the same way resolveIdentity reads it:
    //   both parse    -> the addresses decide; proximity cannot override them
    //   neither parses-> distance is the only evidence there is
    //   one parses    -> asymmetric, so nothing is comparable; not a duplicate
    // The asymmetric case is the one that matters: a candidate with no address
    // beside a catalog row that has one used to fall through to a bare distance
    // test and suppress a real venue.
    const candidateStreet = streetKey(candidate.address);
    const matchStreet = streetKey(match.address);
    if (candidateStreet && matchStreet) {
      return candidateStreet === matchStreet && (match.nameExact || match.nameSimilarity >= 0.5);
    }
    if (candidateStreet || matchStreet) return false;
    return match.distanceMeters <= 25 && (match.nameExact || match.nameSimilarity >= 0.5);
  });
  if (duplicate) {
    return {
      decision: 'duplicate',
      reasons: [`probable production match: ${duplicate.name} (${duplicate.distanceMeters}m)`],
    };
  }

  // Same name, same street, metres apart, but a different Place ID. One venue
  // re-listed, or two venues in one building — Google's id cannot tell us, so
  // a human decides rather than the sweep guessing toward silent suppression.
  const reissueCandidate = catalogMatches.find(
    (match) =>
      candidate.placeId &&
      match.placeId &&
      match.placeId !== candidate.placeId &&
      match.nameExact &&
      match.distanceMeters <= SAME_LOCATION_METERS &&
      sameStreet(candidate.address, match.address),
  );
  if (reissueCandidate) {
    return {
      decision: 'lookup',
      reasons: [
        `same name and street as production row ${reissueCandidate.name} (${reissueCandidate.distanceMeters}m) but a different Place ID — confirm one venue or two`,
      ],
    };
  }

  const evidenceNames = [
    candidate.name ?? '',
    ...(candidate.sourceNames ?? []),
    ...(candidate.requestedNames ?? []),
    ...(candidate.licenseMatches ?? []).flatMap((match) => [match.dba ?? '', match.legalName ?? '']),
  ];
  if (evidenceNames.some((name) => NON_NIGHTLIFE_NAME_RE.test(name))) {
    return { decision: 'reject', reasons: ['name indicates a non-nightlife use of “bar”'] };
  }

  const descriptions = licenseDescriptions(candidate);
  const primaryType = candidate.primaryType ?? '';
  const publicBarTypes = [primaryType, ...(candidate.googleTypes ?? [])].filter((type) =>
    BAR_TYPES.has(type),
  );
  const hasPublicBarType = publicBarTypes.length > 0;
  const hasBarName = evidenceNames.some((name) => PUBLIC_BAR_NAME_RE.test(name));
  if (candidate.placeId) {
    if (hasPublicBarType) {
      // A liquor license is recall evidence, never the thing that carries an
      // accept. It is deliberately absent from this list: a venue whose only
      // corroboration is an SLA row has no PUBLIC evidence that it operates as
      // a bar, so it belongs in lookup for a human to confirm.
      if (
        (candidate.ratings ?? 0) >= 5 ||
        candidate.website ||
        (candidate.requestedNames ?? []).length > 0
      ) {
        reasons.push(`public Google venue with bar type: ${publicBarTypes[0]}`);
        if (descriptions.length > 0) reasons.push('supporting SLA on-premises license');
        return { decision: 'accept', reasons };
      }
      return {
        decision: 'lookup',
        reasons: [`Google bar type has too little public evidence: ${publicBarTypes[0]}`],
      };
    }
    if (
      hasBarName &&
      !['liquor_store', 'wine_store', 'grocery_store', 'supermarket', 'wholesaler'].includes(primaryType)
    ) {
      return {
        decision: 'lookup',
        reasons: [`public hybrid venue needs bar-service confirmation: ${primaryType || 'unknown'}`],
      };
    }
    if (
      (candidate.requestedNames ?? []).length > 0 &&
      !['liquor_store', 'wine_store', 'grocery_store', 'supermarket', 'wholesaler'].includes(primaryType)
    ) {
      return {
        decision: 'lookup',
        reasons: [`operational public venue came from an explicit external bar seed: ${primaryType || 'unknown'}`],
      };
    }
    return {
      decision: 'reject',
      reasons: [`Google primary type does not establish a bar: ${primaryType || 'unknown'}`],
    };
  }

  // Geography is only a rejection when the caller declared the scope being
  // reviewed. Unscoped, an out-of-area row is simply not evidence against the
  // venue — the previous unconditional Manhattan test rejected every Brooklyn
  // license lead on sight.
  if (scope) {
    const licenseCities = (candidate.licenseMatches ?? [])
      .map((match) => String(match.city ?? '').trim().toLowerCase())
      .filter(Boolean);
    const licenseCounties = (candidate.licenseMatches ?? [])
      .map((match) => String(match.county ?? '').trim().toLowerCase())
      .filter(Boolean);
    // County is authoritative and the city list is only a hint: NYC has far
    // more postal localities than boroughs. Requiring BOTH to be out of scope
    // stops a valid lead in an unlisted locality (Bayside, Elmhurst, Jackson
    // Heights) from being rejected as "outside Queens County".
    const cityOutOfScope =
      licenseCities.length > 0 && licenseCities.every((city) => !scope.cities.includes(city));
    const countyOutOfScope =
      licenseCounties.length > 0 &&
      licenseCounties.every((county) => county !== scope.county.toLowerCase());
    const outOfScope =
      licenseCounties.length > 0 ? countyOutOfScope : cityOutOfScope;
    if (outOfScope) {
      return {
        decision: 'reject',
        reasons: [`license premises is outside ${scope.county} County`],
      };
    }
  }
  if (descriptions.some((description) => NON_STANDALONE_LICENSE_RE.test(description))) {
    return {
      decision: 'reject',
      reasons: ['license class is not a standalone on-premises nightlife venue'],
    };
  }
  if (
    descriptions.some((description) => /^club$/i.test(description)) ||
    PRIVATE_CLUB_NAME_RE.test(candidate.name ?? '')
  ) {
    return { decision: 'reject', reasons: ['private/member club rather than a public bar'] };
  }
  if (/ferry boats tavern/i.test(candidate.name ?? '')) {
    return { decision: 'reject', reasons: ['vessel concession license, not a fixed public bar'] };
  }

  if (hasBarName && descriptions.length > 0) {
    return {
      decision: 'lookup',
      reasons: ['active on-premises license lead lacks a verified public venue identity'],
    };
  }
  return { decision: 'reject', reasons: ['insufficient evidence of a public bar'] };
}

export function isNonNightlifeName(name) {
  return NON_NIGHTLIFE_NAME_RE.test(name ?? '');
}

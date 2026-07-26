const ROOT_KEYS = [
  'cycle',
  'objective',
  'bottleneck',
  'metrics',
  'active_bets',
  'kill_criterion',
  'modules',
  'history',
  'approval_queue',
];

const METRIC_KEYS = [
  'wau',
  'max_neighborhood_wau',
  'claimed_venues',
  'self_maintaining_venues',
  'revenue',
  'operator_hours_available',
];

const KILL_CRITERION_KEYS = [
  'deadline',
  'wau_threshold',
  'venue_threshold',
  'tripped',
];

const MODULE_KEYS = [
  'growth',
  'tech',
  'venue_sales',
  'hiring',
  'finance',
  'exit',
];

const MODULE_STATES = new Set(['active', 'dormant']);

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, expectedKeys, objectPath, errors) {
  if (!isPlainObject(value)) {
    errors.push(objectPath + ' must be an object');
    return false;
  }

  const actualKeys = Object.keys(value);
  for (const key of expectedKeys) {
    if (!Object.hasOwn(value, key)) {
      errors.push(objectPath + '.' + key + ' is required');
    }
  }

  for (const key of actualKeys) {
    if (!expectedKeys.includes(key)) {
      errors.push(objectPath + '.' + key + ' is not allowed');
    }
  }

  return true;
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function isNonNegativeFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function validateNullableCount(value, valuePath, errors) {
  if (value !== null && !isNonNegativeInteger(value)) {
    errors.push(valuePath + ' must be null or a non-negative integer');
  }
}

/**
 * Validate the durable CEO state without adding a JSON-schema dependency.
 *
 * Arrays whose future entry contracts have not yet been defined are validated
 * as arrays only. Their item schemas belong to the future orchestrator slice.
 */
export function validateCeoState(state) {
  const errors = [];

  if (!hasExactKeys(state, ROOT_KEYS, 'state', errors)) {
    return { valid: false, errors };
  }

  if (!isNonNegativeInteger(state.cycle)) {
    errors.push('state.cycle must be a non-negative integer');
  }
  if (typeof state.objective !== 'string' || state.objective.length === 0) {
    errors.push('state.objective must be a non-empty string');
  }
  if (typeof state.bottleneck !== 'string' || state.bottleneck.length === 0) {
    errors.push('state.bottleneck must be a non-empty string');
  }

  if (hasExactKeys(state.metrics, METRIC_KEYS, 'state.metrics', errors)) {
    validateNullableCount(state.metrics.wau, 'state.metrics.wau', errors);
    validateNullableCount(
      state.metrics.max_neighborhood_wau,
      'state.metrics.max_neighborhood_wau',
      errors,
    );

    for (const key of ['claimed_venues', 'self_maintaining_venues']) {
      if (!isNonNegativeInteger(state.metrics[key])) {
        errors.push('state.metrics.' + key + ' must be a non-negative integer');
      }
    }

    for (const key of ['revenue', 'operator_hours_available']) {
      if (!isNonNegativeFiniteNumber(state.metrics[key])) {
        errors.push(
          'state.metrics.' + key + ' must be a non-negative finite number',
        );
      }
    }
  }

  for (const key of ['active_bets', 'history', 'approval_queue']) {
    if (!Array.isArray(state[key])) {
      errors.push('state.' + key + ' must be an array');
    }
  }

  if (
    hasExactKeys(
      state.kill_criterion,
      KILL_CRITERION_KEYS,
      'state.kill_criterion',
      errors,
    )
  ) {
    if (
      typeof state.kill_criterion.deadline !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(state.kill_criterion.deadline)
    ) {
      errors.push('state.kill_criterion.deadline must use YYYY-MM-DD');
    }
    if (!isNonNegativeInteger(state.kill_criterion.wau_threshold)) {
      errors.push(
        'state.kill_criterion.wau_threshold must be a non-negative integer',
      );
    }
    if (!isNonNegativeInteger(state.kill_criterion.venue_threshold)) {
      errors.push(
        'state.kill_criterion.venue_threshold must be a non-negative integer',
      );
    }
    if (typeof state.kill_criterion.tripped !== 'boolean') {
      errors.push('state.kill_criterion.tripped must be a boolean');
    }
  }

  if (hasExactKeys(state.modules, MODULE_KEYS, 'state.modules', errors)) {
    for (const key of MODULE_KEYS) {
      if (!MODULE_STATES.has(state.modules[key])) {
        errors.push(
          'state.modules.' +
            key +
            ' must be one of: ' +
            [...MODULE_STATES].join(', '),
        );
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export function assertValidCeoState(state) {
  const result = validateCeoState(state);
  if (!result.valid) {
    throw new TypeError(
      '[ceo-state] Invalid state:\n- ' + result.errors.join('\n- '),
    );
  }
}

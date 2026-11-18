import type {
  ClassificationPolicy,
  CompatibilityPerspective,
  ContractArea,
  Effect,
  PerspectiveClassification,
  Role,
  Strength,
} from '@zainkhan-bit/contractguard-core';

const cell = (
  classification: PerspectiveClassification['classification'],
  basis: PerspectiveClassification['basis'],
  tableCell: string,
): PerspectiveClassification => ({ classification, basis, tableCell });

/**
 * The §10.3 table. Incomparable is classified "as narrows" for acceptance roles and "as widens"
 * for guarantee roles: whichever direction can hurt the role is assumed.
 */
export function classifyByTable(
  input: { readonly role: Role; readonly effect: Effect; readonly strength: Strength },
  policy: ClassificationPolicy,
): PerspectiveClassification {
  const { role, effect, strength } = input;
  const where = `${role}/${effect}/${strength}`;
  if (effect === 'equivalent') return cell('informational', 'contract-guaranteed', where);
  if (effect === 'unknown') return cell('undetermined', 'indeterminate', where);

  if (role === 'acceptance') {
    if (effect === 'widens') return cell('non-breaking', 'contract-guaranteed', where);
    // narrows or incomparable
    switch (strength) {
      case 'structural':
      case 'enumerated':
      case 'additive':
        return cell('breaking', 'contract-guaranteed', where);
      case 'value-space':
        return policy.constraintTightening === 'breaking'
          ? cell('breaking', 'policy-dependent', `${where} (constraintTightening: breaking)`)
          : cell('potentially-breaking', 'policy-dependent', where);
      case 'behavioral':
        return cell('potentially-breaking', 'consumer-dependent', where);
    }
  }
  // guarantee
  if (effect === 'narrows') return cell('non-breaking', 'contract-guaranteed', where);
  switch (strength) {
    case 'structural':
      return cell('breaking', 'contract-guaranteed', where);
    case 'enumerated':
    case 'value-space':
    case 'behavioral':
      return cell('potentially-breaking', 'consumer-dependent', where);
    case 'additive':
      return policy.strictResponseValidation
        ? cell('potentially-breaking', 'policy-dependent', `${where} (strictResponseValidation)`)
        : cell('non-breaking', 'contract-guaranteed', where);
  }
}

/** Default v1 perspective: can existing consumers keep working against the candidate provider? */
export const PROVIDER_BACKWARD: CompatibilityPerspective = Object.freeze({
  id: 'provider-backward',
  title: 'Provider backward compatibility',
  description:
    'Existing consumers written against the base contract keep working against a provider that implements the candidate.',
  roleOf(area: ContractArea): Role {
    return area === 'response' ? 'guarantee' : 'acceptance';
  },
  classify: classifyByTable,
});

/**
 * Consumer-forward (internal in v1, used for metamorphic tests): can consumers written against the
 * candidate talk to a provider that still implements the base? Same table, roles swapped.
 */
export const CONSUMER_FORWARD: CompatibilityPerspective = Object.freeze({
  id: 'consumer-forward',
  title: 'Consumer forward compatibility',
  description:
    'Consumers written against the candidate contract keep working against a provider that implements the base.',
  roleOf(area: ContractArea): Role {
    return area === 'response' ? 'acceptance' : 'guarantee';
  },
  classify: classifyByTable,
});

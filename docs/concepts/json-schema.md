# Supported OpenAPI and JSON Schema

- **OpenAPI 3.0.x and 3.1.x**, YAML or JSON, split across files with `$ref`. A 3.0 → 3.1 migration is compared
  semantically (`nullable: true` and `type: [string, "null"]` are equal).
- Documents are validated against the official OpenAPI schemas before comparison.

## Schemas

| Analysed precisely                                                                                | Notes                                                                             |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `type` (with `integer ⊂ number`), `nullable`, `enum`, `const`                                     |                                                                                   |
| `minimum`, `maximum`, `exclusive*`, `multipleOf`                                                  | exact decimals; integer bounds normalized (`exclusiveMaximum: 10` = `maximum: 9`) |
| `minLength`, `maxLength`, `minItems`, `maxItems`, `minProperties`, `maxProperties`, `uniqueItems` |                                                                                   |
| `properties`, `required`, `additionalProperties`, `items`                                         | `readOnly`/`writeOnly` respected per direction                                    |
| `allOf`                                                                                           | merged where possible                                                             |
| `anyOf`, `oneOf`, `discriminator`                                                                 | branches matched by discriminator value, `$ref` target or structure               |
| `pattern`                                                                                         | added/removed precisely; a changed pattern is _undetermined_                      |
| `format`                                                                                          | known relations (e.g. `int32` ⊂ `int64`); others _undetermined_                   |
| recursive schemas                                                                                 | compared coinductively, with a budget                                             |

Not analysed in 1.0 (changes are reported as _undetermined_, never ignored): `not`, `if`/`then`/`else`,
`patternProperties`, `propertyNames`, `unevaluated*`, `prefixItems`, `contains`, `dependentSchemas`,
`dependentRequired`, `$dynamicRef`.

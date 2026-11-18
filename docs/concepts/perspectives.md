# Compatibility perspectives

"Is this change breaking?" depends on who you ask. ContractGuard answers it from one explicit point of view, the
**perspective**, and prints it on every report.

## Provider-backward (the default)

> Can **existing consumers**, written against the base version, keep working against a provider that implements the
> candidate?

Data flows in two directions, so the rule differs by direction:

| Part of the contract                                                 | Role                                      | Must not…  | Example of a breaking change                                                         |
| -------------------------------------------------------------------- | ----------------------------------------- | ---------- | ------------------------------------------------------------------------------------ |
| Operations, request parameters, request bodies, credentials, servers | **acceptance**: what the provider accepts | **narrow** | a new required property, a removed enum value, a lower `maximum`                     |
| Responses                                                            | **guarantee**: what the provider promises | **widen**  | a new response enum value consumers do not handle, a property that can now be `null` |

Narrowing what you return, or widening what you accept, is safe for existing consumers.

## Effects and how strong they are

Each change is described by its **effect** on the set of valid values (narrows, widens, equivalent, incomparable,
unknown) and the **kind** of constraint involved:

- _structural_: types, required properties, removed operations
- _enumerated_: enum values, allowed status codes
- _value-space_: bounds, lengths, patterns, formats
- _additive_: new optional properties
- _behavioral_: defaults and other semantics the schema only hints at

The combination decides the [classification](/concepts/classification). A narrowed _structure_ in a request is
breaking for certain; a narrowed _value space_ (`maximum: 100 → 50`) is _potentially breaking_, because it only breaks
consumers that actually send values between 51 and 100.

## Consumer-forward (after 1.0)

The opposite question, "can a consumer updated to the candidate still talk to the old provider?", swaps the roles.
It is designed but not yet selectable; see the roadmap.
